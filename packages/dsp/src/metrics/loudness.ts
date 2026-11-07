/**
 * Purpose: ITU-R BS.1770 integrated loudness for the F18 A/B loudness match.
 * The player never normalizes audio: this measurement only supplies the gain
 * that makes the processed lane comparable with the original.
 *
 * K-weighting (two cascaded biquads, Float64):
 *   high shelf H_s(z) then RLB high-pass H_h(z), applied in that order.
 *   48 kHz uses the exact BS.1770 coefficients; every other rate is derived
 *   from the analog prototypes with the bilinear transform (libebur128
 *   parameters), never interpolated.
 *
 * Blocks and gates:
 *   block = 400 ms, hop = 100 ms (75% overlap), complete blocks only
 *   L_j   = -0.691 + 10 log10(mean(square(block_j)))
 *   absolute gate: keep L_j > -70 LUFS
 *   relative gate: keep absolute survivors with
 *                  L_j > (-0.691 + 10 log10(mean(mean-square of absolute
 *                  survivors))) - 10 LU
 *   integrated = -0.691 + 10 log10(mean(mean-square of blocks kept by both))
 *   silence (or no complete block) -> integrated -Infinity.
 *
 * Reference: ITU-R BS.1770-4, "Algorithms to measure audio programme
 * loudness and true-peak audio level" (2015); libebur128's bilinear
 * coefficient derivation for non-48 kHz rates. EBU R128 supplies the
 * 400 ms / 75% block convention and the -70 / -10 LU gates.
 *
 * Complexity: O(N) time, O(blockLength) extra memory; the input is never
 * mutated. Filtering and accumulation are Float64 throughout.
 *
 * Edge cases: empty input -> RangeError; non-finite sample -> TypeError;
 * sampleRateHz non-finite or outside (0, 96000] -> RangeError. A non-empty
 * input shorter than one block returns zero blocks and -Infinity. Blocks
 * exactly at a gate are excluded (strict >). `loudnessGainDb` returns 0 for
 * non-finite input and clamps to [-24, +24] dB.
 */

const BLOCK_SECONDS = 0.4;
const HOP_SECONDS = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = 10;
const OFFSET_DB = -0.691;
const MAX_SAMPLE_RATE_HZ = 96_000;
const MAX_GAIN_DB = 24;

interface BiquadCoefficients {
  readonly b: readonly number[];
  readonly a: readonly number[];
}

export interface LoudnessParams {
  readonly sampleRateHz: number;
}

export interface LoudnessBlock {
  readonly startSample: number;
  readonly durationSeconds: number;
  readonly loudnessLufs: number;
  /** True when the block passed the -70 LUFS absolute gate. */
  readonly absoluteGated: boolean;
  /** True when the block passed both the absolute and relative gates. */
  readonly relativeGated: boolean;
}

export interface LoudnessResult {
  readonly integratedLufs: number;
  readonly blocks: readonly LoudnessBlock[];
  readonly blockDurationSeconds: number;
  readonly blockHopSeconds: number;
}

const SHELF_48K: BiquadCoefficients = {
  b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
  a: [1, -1.69065929318241, 0.73248077421585],
};

const HIGHPASS_48K: BiquadCoefficients = {
  b: [1, -2, 1],
  a: [1, -1.99004745483398, 0.99007225036621],
};

function assertSampleRate(sampleRateHz: number): void {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0 || sampleRateHz > MAX_SAMPLE_RATE_HZ) {
    throw new RangeError(
      `kWeightingCoefficients: sampleRateHz must be finite in (0, ${MAX_SAMPLE_RATE_HZ}]`,
    );
  }
}

export function kWeightingCoefficients(sampleRateHz: number): {
  readonly shelf: { readonly b: readonly number[]; readonly a: readonly number[] };
  readonly highpass: { readonly b: readonly number[]; readonly a: readonly number[] };
} {
  assertSampleRate(sampleRateHz);
  if (sampleRateHz === 48_000) {
    return { shelf: SHELF_48K, highpass: HIGHPASS_48K };
  }

  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRateHz);
  const shelfGain = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const vh = 10 ** (shelfGain / 20);
  const vb = vh ** 0.4996667741545416;
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf: BiquadCoefficients = {
    b: [
      (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
      (2 * (shelfK * shelfK - vh)) / shelfA0,
      (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    ],
    a: [
      1,
      (2 * (shelfK * shelfK - 1)) / shelfA0,
      (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
    ],
  };

  const highpassK = Math.tan((Math.PI * 38.13547087602444) / sampleRateHz);
  const highpassQ = 0.5003270373238773;
  const highpassA0 = 1 + highpassK / highpassQ + highpassK * highpassK;
  const highpass: BiquadCoefficients = {
    b: [1, -2, 1],
    a: [
      1,
      (2 * (highpassK * highpassK - 1)) / highpassA0,
      (1 - highpassK / highpassQ + highpassK * highpassK) / highpassA0,
    ],
  };
  return { shelf, highpass };
}

interface FilterState {
  z1: number;
  z2: number;
}

function stepBiquad(input: number, coefficients: BiquadCoefficients, state: FilterState): number {
  const b0 = coefficients.b[0] ?? 0;
  const b1 = coefficients.b[1] ?? 0;
  const b2 = coefficients.b[2] ?? 0;
  const a1 = coefficients.a[1] ?? 0;
  const a2 = coefficients.a[2] ?? 0;
  const output = b0 * input + state.z1;
  state.z1 = b1 * input - a1 * output + state.z2;
  state.z2 = b2 * input - a2 * output;
  return output;
}

function blockLoudness(meanSquare: number): number {
  return meanSquare > 0 ? OFFSET_DB + 10 * Math.log10(meanSquare) : Number.NEGATIVE_INFINITY;
}

export function measureLoudness(samples: Float32Array, params: LoudnessParams): LoudnessResult {
  const { sampleRateHz } = params;
  assertSampleRate(sampleRateHz);
  if (samples.length === 0) {
    throw new RangeError("measureLoudness: samples must not be empty");
  }
  for (let index = 0; index < samples.length; index += 1) {
    if (!Number.isFinite(samples[index])) {
      throw new TypeError(`measureLoudness: sample ${index} is not finite`);
    }
  }

  const coefficients = kWeightingCoefficients(sampleRateHz);
  const blockLength = Math.round(BLOCK_SECONDS * sampleRateHz);
  const hop = Math.round(HOP_SECONDS * sampleRateHz);
  const blockCount =
    samples.length >= blockLength ? Math.floor((samples.length - blockLength) / hop) + 1 : 0;

  const shelfState: FilterState = { z1: 0, z2: 0 };
  const highpassState: FilterState = { z1: 0, z2: 0 };
  const ring = new Float64Array(blockLength);
  const meanSquares = new Float64Array(blockCount);
  let ringSum = 0;
  let nextBlockEnd = blockLength;
  let blockIndex = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const input = samples[index] ?? 0;
    const shelf = stepBiquad(input, coefficients.shelf, shelfState);
    const weighted = stepBiquad(shelf, coefficients.highpass, highpassState);
    const square = weighted * weighted;
    const slot = index % blockLength;
    ringSum += square - (index >= blockLength ? (ring[slot] ?? 0) : 0);
    ring[slot] = square;

    if (index + 1 === nextBlockEnd && blockIndex < blockCount) {
      meanSquares[blockIndex] = ringSum / blockLength;
      blockIndex += 1;
      nextBlockEnd += hop;
    }
  }

  const loudness = new Float64Array(blockCount);
  let absoluteCount = 0;
  let absoluteSum = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const value = blockLoudness(meanSquares[index] ?? 0);
    loudness[index] = value;
    if (value > ABSOLUTE_GATE_LUFS) {
      absoluteCount += 1;
      absoluteSum += meanSquares[index] ?? 0;
    }
  }

  const absolute = new Uint8Array(blockCount);
  const relative = new Uint8Array(blockCount);
  let relativeSum = 0;
  let relativeCount = 0;
  if (absoluteCount > 0) {
    const ungatedMean = absoluteSum / absoluteCount;
    const relativeThreshold = OFFSET_DB + 10 * Math.log10(ungatedMean) - RELATIVE_GATE_LU;
    for (let index = 0; index < blockCount; index += 1) {
      if ((loudness[index] ?? Number.NEGATIVE_INFINITY) > ABSOLUTE_GATE_LUFS) {
        absolute[index] = 1;
        if ((loudness[index] ?? Number.NEGATIVE_INFINITY) > relativeThreshold) {
          relative[index] = 1;
          relativeSum += meanSquares[index] ?? 0;
          relativeCount += 1;
        }
      }
    }
  }

  const integratedLufs =
    relativeCount > 0
      ? OFFSET_DB + 10 * Math.log10(relativeSum / relativeCount)
      : Number.NEGATIVE_INFINITY;

  const blocks: LoudnessBlock[] = [];
  for (let index = 0; index < blockCount; index += 1) {
    blocks.push({
      startSample: index * hop,
      durationSeconds: BLOCK_SECONDS,
      loudnessLufs: loudness[index] ?? Number.NEGATIVE_INFINITY,
      absoluteGated: absolute[index] === 1,
      relativeGated: relative[index] === 1,
    });
  }

  return {
    integratedLufs,
    blocks,
    blockDurationSeconds: BLOCK_SECONDS,
    blockHopSeconds: HOP_SECONDS,
  };
}

export function loudnessGainDb(originalLufs: number, processedLufs: number): number {
  if (!Number.isFinite(originalLufs) || !Number.isFinite(processedLufs)) {
    return 0;
  }
  return Math.min(MAX_GAIN_DB, Math.max(-MAX_GAIN_DB, originalLufs - processedLufs));
}
