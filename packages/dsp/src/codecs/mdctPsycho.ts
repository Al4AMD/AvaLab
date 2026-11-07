/**
 * Purpose: F13 masking-aware MDCT toy codec. It keeps the Wave-4 transform
 * and Huffman container but replaces the flat quantizer step with a per-band
 * step limited by the simultaneous-masking threshold. Masking may make a band
 * coarser; the requested bitrate remains a cap, so masking never spends bits
 * the budget cannot afford.
 *
 * Formulas (per frame, 25 Bark bands):
 *   sGlobal = GM · 2^(−bitsPerSecond/sampleRateHz)   (GM = legacy
 *             geometric mean of nonzero |C_k|; an all-zero frame uses 1)
 *   sMask_i = sqrt(12 · P_ref · 10^((T_i − refSplDb)/10) / n_i)
 *   s_i     = n_i > 0 ? max(sMask_i, sGlobal) : sGlobal
 *   q_k     = clip(round(C_k / s_{b(k)}), −32768, 32767)
 * with T_i from `maskingThresholdDb`, P_ref measured through the same MDCT
 * from one second of a 1 kHz full-scale sine, and b(k) the band of bin k.
 *
 * Accounting:
 *   entropyBits  = Huffman bit length of the quantized index stream
 *   sideInfoBits = frameCount · 25 · 16 (one 16-bit step per band per frame)
 *   totalBits    = entropyBits + sideInfoBits
 *   bitrateKbps  = totalBits · sampleRateHz / sampleCount / 1000
 *   compressedSizeBytes = ceil(entropyBits / 8)  (payload only)
 * Masked bins are bins in a band where sMask > sGlobal. Empty bands are not
 * counted as masked.
 *
 * Limitations: stationary per-frame model, no temporal masking, no
 * tonal/noise distinction, no transform-gain correction. It is a teaching
 * approximation, not an MP3/AAC-compliant encoder.
 *
 * References: Princen & Bradley (1986) and Malvar (1990) for the MDCT; the
 * masking formulas are documented in `psychoacoustics/` and
 * docs/ALGORITHMS.md. The container/Huffman path is inherited from
 * `mdctCodec.ts`.
 *
 * Complexity: O(sampleRate) once per (rate, frame) for P_ref (cached), then
 * O(sampleCount·hop) MDCT + O(frameCount·bandCount²) masking + O(M·L)
 * Huffman per call.
 *
 * Edge cases: empty input → empty arrays/zero stats; silence → finite stats,
 * maskedFraction 0, no NaN; non-Float32 or non-finite samples → TypeError;
 * non-positive rates/bits or invalid reference level → RangeError;
 * frameLengthSamples delegates to `mdct` except where hop is needed first,
 * where the same even-integer-≥-4 rule is mirrored.
 */

import { bandAthDb } from "../psychoacoustics/ath.js";
import { barkToHz, hzToBark } from "../psychoacoustics/bark.js";
import {
  bandLevelsDb,
  maskingThresholdDb,
  maskStepForBand,
  PSYCHO_BAND_COUNT,
  signalToMaskRatioDb,
} from "../psychoacoustics/masking.js";
import { imdct, mdct } from "../timestretch/mdct.js";
import { type HuffmanCodebook, huffmanDecode, huffmanEncode } from "./huffman.js";
import type {
  MdctCodecDecodeParams,
  MdctCodecEncoded,
  MdctCodecEncodeParams,
  MdctCodecStats,
} from "./mdctCodec.js";

export const PSYCHO_REFERENCE_SPL_DB = 94;
export const PSYCHO_SIDE_INFO_BITS_PER_BAND = 16;

/** Parameters of `encodeMdctPsycho`. */
export interface MdctPsychoParams extends MdctCodecEncodeParams {
  /** Reference level for a full-scale sine in dB SPL (default 94). */
  readonly referenceSplDb?: number;
}

/** One band's analysis and quantization state in a frame. */
export interface MdctPsychoBandStat {
  readonly bandIndex: number;
  readonly lowHz: number;
  readonly highHz: number;
  readonly binCount: number;
  readonly levelDb: number;
  readonly thresholdDb: number;
  readonly smrDb: number;
  readonly step: number;
  readonly masked: boolean;
}

/** Per-frame analysis and bit accounting. */
export interface MdctPsychoFrameStat {
  readonly frameIndex: number;
  readonly bands: readonly MdctPsychoBandStat[];
  readonly entropyBits: number;
  readonly sideInfoBits: number;
  readonly totalBits: number;
  readonly maskedFraction: number;
}

/** Psychoacoustic container: the legacy fields plus per-band side information. */
export interface MdctPsychoEncoded extends MdctCodecEncoded {
  readonly bandEdgesHz: Float64Array;
  readonly bandSteps: Float64Array[];
  readonly frameStats: readonly MdctPsychoFrameStat[];
  stats: MdctCodecStats & {
    readonly entropyBits: number;
    readonly sideInfoBits: number;
    readonly totalBits: number;
    readonly maskedFraction: number;
  };
}

const referencePowerCache = new Map<string, number>();

function assertFrameLength(frameLengthSamples: number, label: string): void {
  if (
    !Number.isInteger(frameLengthSamples) ||
    frameLengthSamples < 4 ||
    frameLengthSamples % 2 !== 0
  ) {
    throw new RangeError(
      `${label}: frameLengthSamples must be an even integer >= 4 (got ${frameLengthSamples})`,
    );
  }
}

function assertRate(rate: number, label: string): void {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`${label}: sampleRateHz must be finite and > 0 (got ${rate})`);
  }
}

function assertBits(bits: number, label: string): void {
  if (!Number.isFinite(bits) || bits <= 0) {
    throw new RangeError(`${label}: bitsPerSecond must be finite and > 0 (got ${bits})`);
  }
}

/**
 * Measure P_ref through the same MDCT frame/window from one second of a
 * 1 kHz full-scale sine: mean over frames of sum(C_k²)/hop. Cached because
 * the value depends only on (sampleRateHz, frameLengthSamples).
 */
export function measureReferencePower(sampleRateHz: number, frameLengthSamples: number): number {
  assertRate(sampleRateHz, "measureReferencePower");
  assertFrameLength(frameLengthSamples, "measureReferencePower");
  const key = `${sampleRateHz}\u0000${frameLengthSamples}`;
  const cached = referencePowerCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const sampleCount = Math.round(sampleRateHz);
  const samples = new Float64Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 1000 * index) / sampleRateHz);
  }
  const transform = mdct(samples, { frameLengthSamples });
  const hop = transform.hopLengthSamples;
  let totalPower = 0;
  for (const frame of transform.coefficients) {
    let framePower = 0;
    for (let k = 0; k < hop; k += 1) {
      const coefficient = frame[k] ?? 0;
      framePower += coefficient * coefficient;
    }
    totalPower += framePower;
  }
  const power =
    transform.coefficients.length === 0 ? 0 : totalPower / transform.coefficients.length / hop;
  referencePowerCache.set(key, power);
  return power;
}

// ponytail: 6-line zigzag/unzigzag duplicated from mdctCodec.ts (module-private
// there); share a module if a third quantized-index codec appears.
function zigzag(value: number): number {
  return value < 0 ? -2 * value - 1 : 2 * value;
}

function binToBand(
  bin: number,
  binCount: number,
  sampleRateHz: number,
  edges: Float64Array,
): number {
  const centerHz = ((bin + 0.5) * sampleRateHz) / (2 * binCount);
  let band = 0;
  while (
    band < PSYCHO_BAND_COUNT - 1 &&
    centerHz >= (edges[band + 1] ?? Number.POSITIVE_INFINITY)
  ) {
    band += 1;
  }
  return band;
}

function bandCentersBark(edges: Float64Array): Float64Array {
  const centers = new Float64Array(PSYCHO_BAND_COUNT);
  for (let band = 0; band < PSYCHO_BAND_COUNT; band += 1) {
    const low = edges[band] ?? 0;
    const high = edges[band + 1] ?? low;
    centers[band] = hzToBark(Math.sqrt(low * high));
  }
  return centers;
}

function nonZeroGeometricMean(frame: Float64Array): number {
  let logSum = 0;
  let count = 0;
  for (let k = 0; k < frame.length; k += 1) {
    const value = Math.abs(frame[k] ?? 0);
    if (value !== 0) {
      logSum += Math.log(value);
      count += 1;
    }
  }
  return count === 0 ? 1 : Math.exp(logSum / count);
}

/**
 * Encode through the masking-aware MDCT toy codec. The legacy container
 * fields stay compatible; `bandSteps` carries the per-frame side information.
 */
export function encodeMdctPsycho(
  samples: Float32Array,
  params: MdctPsychoParams,
): MdctPsychoEncoded {
  if (!(samples instanceof Float32Array)) {
    throw new TypeError("encodeMdctPsycho: samples must be a Float32Array");
  }
  const { sampleRateHz, frameLengthSamples, bitsPerSecond } = params;
  const referenceSplDb = params.referenceSplDb ?? PSYCHO_REFERENCE_SPL_DB;
  assertRate(sampleRateHz, "encodeMdctPsycho");
  assertBits(bitsPerSecond, "encodeMdctPsycho");
  if (!Number.isFinite(referenceSplDb)) {
    throw new RangeError(`encodeMdctPsycho: referenceSplDb must be finite (got ${referenceSplDb})`);
  }
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample === undefined || !Number.isFinite(sample)) {
      throw new TypeError(`encodeMdctPsycho: samples[${index}] is not finite`);
    }
  }

  const transform = mdct(new Float64Array(samples), { frameLengthSamples });
  const hop = transform.hopLengthSamples;
  const frameCount = transform.coefficients.length;
  const coefficientCount = frameCount * hop;
  const edges = new Float64Array(PSYCHO_BAND_COUNT + 1);
  for (let band = 0; band <= PSYCHO_BAND_COUNT; band += 1) {
    edges[band] = barkToHz((band * 25) / PSYCHO_BAND_COUNT, sampleRateHz);
  }
  const ath = bandAthDb(edges);
  const centersBark = bandCentersBark(edges);
  const referencePower = measureReferencePower(sampleRateHz, frameLengthSamples);
  const stepFactor = 2 ** -(bitsPerSecond / sampleRateHz);
  const binBands = new Int32Array(hop);
  for (let bin = 0; bin < hop; bin += 1) {
    binBands[bin] = binToBand(bin, hop, sampleRateHz, edges);
  }

  const coefficients: Float64Array[] = [];
  const steps = new Float64Array(frameCount);
  const bandSteps: Float64Array[] = [];
  const frameStats: MdctPsychoFrameStat[] = [];
  const lowBytes = new Uint8Array(coefficientCount);
  const highBytes = new Uint8Array(coefficientCount);
  let maskedBinTotal = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameC = transform.coefficients[frame];
    if (frameC === undefined) {
      throw new TypeError(`encodeMdctPsycho: coefficients[${frame}] read out of bounds`);
    }
    const globalStep = nonZeroGeometricMean(frameC) * stepFactor;
    steps[frame] = globalStep;
    const { levelsDb, binCounts } = bandLevelsDb(
      frameC,
      edges,
      referenceSplDb,
      referencePower,
      sampleRateHz,
    );
    const thresholdsDb = maskingThresholdDb(levelsDb, centersBark, ath);
    const smrDb = signalToMaskRatioDb(levelsDb, thresholdsDb);
    const frameBandSteps = new Float64Array(PSYCHO_BAND_COUNT);
    const bands: MdctPsychoBandStat[] = [];
    let maskedBins = 0;
    for (let band = 0; band < PSYCHO_BAND_COUNT; band += 1) {
      const binCount = binCounts[band] ?? 0;
      const thresholdDb = thresholdsDb[band] ?? Number.NEGATIVE_INFINITY;
      const maskStep = maskStepForBand(thresholdDb, referenceSplDb, referencePower, binCount);
      const bandStep = binCount === 0 ? globalStep : Math.max(maskStep, globalStep);
      const masked = binCount > 0 && maskStep > globalStep;
      frameBandSteps[band] = bandStep;
      if (masked) {
        maskedBins += binCount;
      }
      bands.push({
        bandIndex: band,
        lowHz: edges[band] ?? 0,
        highHz: edges[band + 1] ?? 0,
        binCount,
        levelDb: levelsDb[band] ?? Number.NEGATIVE_INFINITY,
        thresholdDb,
        smrDb: smrDb[band] ?? Number.NEGATIVE_INFINITY,
        step: bandStep,
        masked,
      });
    }
    bandSteps.push(frameBandSteps);
    maskedBinTotal += maskedBins;
    const base = frame * hop;
    const frameQ = new Float64Array(hop);
    for (let k = 0; k < hop; k += 1) {
      const band = binBands[k] ?? 0;
      const step = frameBandSteps[band] ?? globalStep;
      const coefficient = frameC[k] ?? 0;
      let q = coefficient === 0 ? 0 : Math.round(coefficient / step);
      q = q > 32767 ? 32767 : q < -32768 ? -32768 : q;
      frameQ[k] = q;
      const unsigned = zigzag(q);
      lowBytes[base + k] = unsigned & 0xff;
      highBytes[base + k] = unsigned >>> 8;
    }
    coefficients.push(frameQ);
    frameStats.push({
      frameIndex: frame,
      bands,
      entropyBits: 0,
      sideInfoBits: PSYCHO_BAND_COUNT * PSYCHO_SIDE_INFO_BITS_PER_BAND,
      totalBits: PSYCHO_BAND_COUNT * PSYCHO_SIDE_INFO_BITS_PER_BAND,
      maskedFraction: hop === 0 ? 0 : maskedBins / hop,
    });
  }

  const combined = new Uint8Array(2 * coefficientCount);
  combined.set(lowBytes, 0);
  combined.set(highBytes, coefficientCount);
  const packed = huffmanEncode(combined);
  const entropyBits = packed.bitLength;
  const sideInfoBits = frameCount * PSYCHO_BAND_COUNT * PSYCHO_SIDE_INFO_BITS_PER_BAND;
  const totalBits = entropyBits + sideInfoBits;
  const sampleCount = samples.length;
  const maskedFraction = coefficientCount === 0 ? 0 : maskedBinTotal / coefficientCount;
  const codeLengths = packed.codebook.codeLengths;
  for (let frame = 0; frame < frameStats.length; frame += 1) {
    const previous = frameStats[frame];
    if (previous === undefined) {
      continue;
    }
    let frameEntropyBits = 0;
    const base = frame * hop;
    for (let k = 0; k < hop; k += 1) {
      frameEntropyBits +=
        (codeLengths[lowBytes[base + k] ?? 0] ?? 0) + (codeLengths[highBytes[base + k] ?? 0] ?? 0);
    }
    frameStats[frame] = {
      ...previous,
      entropyBits: frameEntropyBits,
      sideInfoBits: PSYCHO_BAND_COUNT * PSYCHO_SIDE_INFO_BITS_PER_BAND,
      totalBits: frameEntropyBits + PSYCHO_BAND_COUNT * PSYCHO_SIDE_INFO_BITS_PER_BAND,
      maskedFraction: previous.maskedFraction,
    };
  }

  return {
    coefficients,
    steps,
    bandEdgesHz: edges,
    bandSteps,
    frameStats,
    bitsTotal: entropyBits,
    bitLength: entropyBits,
    bits: packed.bits,
    codebook: { codeLengths: packed.codebook.codeLengths },
    stats: {
      bitsPerSample: sampleCount === 0 ? 0 : totalBits / sampleCount,
      bitrateKbps: sampleCount === 0 ? 0 : (totalBits * sampleRateHz) / sampleCount / 1000,
      compressedSizeBytes: (entropyBits + 7) >> 3,
      entropyBits,
      sideInfoBits,
      totalBits,
      maskedFraction,
    },
  };
}

/**
 * Decode a psychoacoustic container: un-zigzag the shared Huffman stream,
 * multiply each coefficient by its band step, then run the TDAC IMDCT.
 */
export function decodeMdctPsycho(
  encoded: MdctPsychoEncoded,
  params: MdctCodecDecodeParams,
): Float32Array {
  if (!(encoded.bits instanceof Uint8Array)) {
    throw new TypeError("decodeMdctPsycho: encoded.bits must be a Uint8Array");
  }
  if (!(encoded.codebook?.codeLengths instanceof Uint8Array)) {
    throw new TypeError("decodeMdctPsycho: encoded.codebook.codeLengths must be a Uint8Array");
  }
  if (!Array.isArray(encoded.coefficients)) {
    throw new TypeError("decodeMdctPsycho: encoded.coefficients must be an array");
  }
  if (!(encoded.steps instanceof Float64Array)) {
    throw new TypeError("decodeMdctPsycho: encoded.steps must be a Float64Array");
  }
  if (
    !Array.isArray(encoded.bandSteps) ||
    encoded.bandSteps.some((frame) => !(frame instanceof Float64Array))
  ) {
    throw new TypeError("decodeMdctPsycho: encoded.bandSteps must be an array of Float64Array");
  }
  if (!(encoded.bandEdgesHz instanceof Float64Array) || encoded.bandEdgesHz.length < 2) {
    throw new TypeError("decodeMdctPsycho: encoded.bandEdgesHz must be a Float64Array");
  }
  const { sampleRateHz, frameLengthSamples } = params;
  assertRate(sampleRateHz, "decodeMdctPsycho");
  assertFrameLength(frameLengthSamples, "decodeMdctPsycho");
  const bitLength = encoded.bitLength;
  if (!Number.isInteger(bitLength) || bitLength < 0) {
    throw new RangeError(
      `decodeMdctPsycho: encoded.bitLength must be a non-negative integer (got ${bitLength})`,
    );
  }
  const frameCount = encoded.coefficients.length;
  if (encoded.steps.length !== frameCount) {
    throw new RangeError(
      `decodeMdctPsycho: encoded.steps holds ${encoded.steps.length} entries for ${frameCount} frames`,
    );
  }
  if (encoded.bandSteps.length !== frameCount) {
    throw new RangeError(
      `decodeMdctPsycho: bandSteps holds ${encoded.bandSteps.length} frames for ${frameCount}`,
    );
  }
  const hop = frameLengthSamples / 2;
  const bandCount = encoded.bandEdgesHz.length - 1;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameC = encoded.coefficients[frame];
    const frameSteps = encoded.bandSteps[frame];
    if (!(frameC instanceof Float64Array)) {
      throw new TypeError(
        `decodeMdctPsycho: encoded.coefficients[${frame}] must be a Float64Array`,
      );
    }
    if (frameC.length !== hop) {
      throw new RangeError(
        `decodeMdctPsycho: encoded.coefficients[${frame}] holds ${frameC.length} coefficients, expected hop ${hop}`,
      );
    }
    if (frameSteps === undefined || frameSteps.length !== bandCount) {
      throw new RangeError(`decodeMdctPsycho: bandSteps[${frame}] must hold ${bandCount} entries`);
    }
  }

  const codebook: HuffmanCodebook = encoded.codebook;
  const decodedBytes = huffmanDecode(encoded.bits, bitLength, codebook);
  const coefficientCount = frameCount * hop;
  if (decodedBytes.length !== 2 * coefficientCount) {
    throw new RangeError("truncated mdct psycho stream");
  }
  const binBands = new Int32Array(hop);
  for (let bin = 0; bin < hop; bin += 1) {
    binBands[bin] = binToBand(bin, hop, sampleRateHz, encoded.bandEdgesHz);
  }
  const dequantized: Float64Array[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameSteps = encoded.bandSteps[frame];
    if (frameSteps === undefined) {
      throw new TypeError(`decodeMdctPsycho: bandSteps[${frame}] read out of bounds`);
    }
    const frameC = new Float64Array(hop);
    for (let k = 0; k < hop; k += 1) {
      const pairIndex = frame * hop + k;
      const low = decodedBytes[pairIndex] ?? 0;
      const high = decodedBytes[coefficientCount + pairIndex] ?? 0;
      const unsigned = low | (high << 8);
      const q = (unsigned & 1) === 0 ? unsigned >>> 1 : -((unsigned >>> 1) + 1);
      const band = binBands[k] ?? 0;
      frameC[k] = q * (frameSteps[band] ?? 0);
    }
    dequantized.push(frameC);
  }
  const synthesized = imdct(dequantized, { frameLengthSamples });
  const audio = new Float32Array(synthesized.length);
  for (let index = 0; index < synthesized.length; index += 1) {
    audio[index] = synthesized[index] ?? 0;
  }
  return audio;
}
