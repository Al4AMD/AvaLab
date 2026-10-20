/**
 * Purpose: uniform quantization with optional TPDF dither for the F03
 * "Sampling rate & bit depth" lab. Students reduce the bit depth of a signal,
 * hear/see the quantization noise, and compare the measured SNR with the
 * textbook approximation 6.02*bits + 1.76 dB. The dithered variant shows the
 * pedagogical point that TPDF dither decorrelates the quantization error from
 * the signal at the cost of noise: the TPDF dither alone has power Δ²/6
 * (twice the Δ²/12 undithered error power), so the total error
 * dither + quantizer error is Δ²/4 and the SNR drops by
 * 10·log10(3) ≈ 4.77 dB relative to the undithered curve (Zölzer).
 *
 * Definitions (pinned; x in float full scale [−1, 1]):
 *   levels      = 2^bits
 *   Δ           = 2 / (levels − 1)
 *   Q(v)        = clip(Δ * round(v / Δ), −1, 1)
 *   quantizeUniform(x, {bits})[n]          = Q(x[n])
 *   quantizeWithTpdfDither(x, {bits, seed})[n] = Q(x[n] + d[n])
 *     d[n] = (u1[n] + u2[n] − 1) * Δ, u1, u2 independent uniform in [0, 1)
 *   quantizationError(original, quantized)[n] = original[n] − quantized[n]
 *
 * The quantizer is mid-tread (a code at zero) with the pinned step
 * Δ = 2/(2^bits − 1), so the codes are Δ·k. `round` is JavaScript Math.round
 * (half up toward +∞); the Python golden reference uses exact half-up
 * (floor then compare the fractional part with 0.5) for the identical tie
 * rule, NOT floor(v + 0.5) (which can differ within 1 ulp below a half
 * integer) and NOT NumPy's banker's rounding. The clip is applied AFTER
 * rounding — the brief's pinned order — so a full-scale +1 input maps to +1
 * while −1 maps to −(2^(bits−1) − 1)·Δ (the tie at −(2^(bits−1) − 0.5) rounds
 * toward +∞); both boundaries stay inside [−1, 1] by construction.
 *
 * Clipping headroom (controller ruling R11): the TPDF dither has support
 * (−Δ, Δ), so a sample at full scale ±1 is pushed outside the representable
 * range by the dither and the post-round clip correlates the error with the
 * signal. That is honest behavior, not a defect: dither decorrelation holds
 * WITHOUT clipping. Operating point for the decorrelation demo: amplitude
 * ≤ 1 − Δ (the largest dithered sample stays strictly below +1), or accept
 * the clip-induced correlation at amplitude 1 (tested: |ρ| > 0.1 at b = 4).
 * The dithered SNR test at b = 8 uses a full-scale tone and still matches the
 * Δ²/4 theory within ±0.5 dB.
 *
 * Dither (controller ruling R3): the TPDF noise has support (−Δ, Δ), zero
 * mean and variance Δ²/6, i.e. twice the Δ²/12 power of undithered
 * quantization error. It is added to the sample BEFORE rounding and the sum
 * goes through the same mid-tread quantizer Q. Because the dither is TPDF,
 * the total error becomes approximately signal-independent (white and
 * uncorrelated with x); its power is Δ²/6 + Δ²/12 = Δ²/4, so the SNR is
 * 10·log10(3) ≈ 4.77 dB below the undithered curve. That decorrelation and
 * the dithered SNR are the teaching contrasts the tests assert.
 *
 * Seed derivation: two independent mulberry32 streams are used for the two
 * uniforms of each TPDF draw:
 *   stream 1 : mulberry32(seed)
 *   stream 2 : mulberry32((seed + 0x9E3779B9) >>> 0)
 * The streams run the same 32-bit counter recurrence, so stream 2 is the
 * stream-1 cycle advanced by 613 683 765 steps; over the ≤ 2^32 period the
 * two draws are effectively independent. The offset is added (not XORed):
 * XOR is an involution, so seeds s and s XOR 0x9E3779B9 would swap the two
 * streams and produce byte-identical dither. Addition modulo 2^32 is
 * asymmetric and avoids that aliasing. Same seed -> byte-identical output;
 * mulberry32 reduces the seed modulo 2^32 (its pinned state width).
 *
 * References: U. Zölzer, "Digital Audio Signal Processing", 2nd ed., section
 * 1.2 (uniform quantization, signal-to-noise ratio, dither); the TPDF
 * derivation follows the standard treatment in S. P. Lipshitz, J. Vanderkooy
 * & R. A. Wannamaker, "Minimally audible noise shaping", J. Audio Eng. Soc.
 * 39(11), 1991. NumPy reference values define the golden vectors in
 * test-data/golden/quantize.json.
 *
 * Complexity: O(N) time and O(N) output space; O(1) extra state (the PRNG
 * streams). The input is never mutated and every call returns a fresh array.
 *
 * Edge cases (R6): a non-finite sample -> TypeError; `bits` must be an integer
 * in [1, 24] -> RangeError otherwise (R6 parameter rule); the dither `seed`
 * must be a finite integer (mulberry32 contract) -> RangeError otherwise;
 * quantizationError requires equal lengths -> RangeError on a mismatch. Empty
 * input returns an empty Float64Array. Pinned convention: the "error" is
 * original − quantized (observation convention; the UI labels the polarity).
 */

import { mulberry32 } from "../signals/noise.js";

const MIN_BITS = 1;
const MAX_BITS = 24;
/** Golden-ratio offset; see the module header for the seed derivation. */
const TPDF_SECOND_STREAM_OFFSET = 0x9e3779b9;

export interface UniformQuantizeOptions {
  /** Quantizer resolution in bits; integer in [1, 24]. */
  bits: number;
}

export interface TpdfDitherOptions extends UniformQuantizeOptions {
  /** Seed of the pinned mulberry32 TPDF noise streams. */
  seed: number;
}

function assertFiniteSamples(samples: Float64Array, label: string): void {
  for (let n = 0; n < samples.length; n += 1) {
    const sample: number | undefined = samples[n];
    if (sample === undefined) {
      throw new TypeError(`${label}: samples[${n}] read out of bounds`);
    }
    if (!Number.isFinite(sample)) {
      throw new TypeError(`${label}: samples[${n}] must be finite (got ${sample})`);
    }
  }
}

function stepForBits(bits: number, caller: string): number {
  if (!Number.isInteger(bits) || bits < MIN_BITS || bits > MAX_BITS) {
    throw new RangeError(
      `${caller}: bits must be an integer in [${MIN_BITS}, ${MAX_BITS}] (got ${bits})`,
    );
  }
  return 2 / (2 ** bits - 1);
}

/** Mid-tread quantizer Q(v) = clip(Δ·round(v/Δ), −1, 1) for one sample. */
function quantizeValue(value: number, step: number): number {
  const quantized = step * Math.round(value / step);
  if (quantized > 1) {
    return 1;
  }
  if (quantized < -1) {
    return -1;
  }
  return quantized;
}

/**
 * Mid-tread uniform quantization: y[n] = clip(Δ·round(x[n]/Δ), −1, 1) with
 * Δ = 2/(2^bits − 1). `bits` must be an integer in [1, 24]; non-finite sample
 * -> TypeError. Returns a fresh array; the input is never mutated.
 */
export function quantizeUniform(x: Float64Array, options: UniformQuantizeOptions): Float64Array {
  const step = stepForBits(options?.bits, "quantizeUniform");
  assertFiniteSamples(x, "quantizeUniform");

  const output = new Float64Array(x.length);
  for (let n = 0; n < x.length; n += 1) {
    output[n] = quantizeValue(x[n] ?? 0, step);
  }
  return output;
}

/**
 * Uniform quantization with additive TPDF dither:
 * y[n] = Q(x[n] + (u1[n] + u2[n] − 1)·Δ), the dither added before rounding.
 * Same seed -> identical output; seed must be a finite integer (RangeError
 * otherwise). Returns a fresh array; the input is never mutated.
 */
export function quantizeWithTpdfDither(x: Float64Array, options: TpdfDitherOptions): Float64Array {
  const step = stepForBits(options?.bits, "quantizeWithTpdfDither");
  // mulberry32 validates the seed (finite integer) before the first draw.
  const firstStream = mulberry32(options.seed);
  // Additive, not XOR: XOR is an involution and would swap the streams for
  // seeds s and s XOR offset, producing byte-identical dither.
  const secondStream = mulberry32((options.seed + TPDF_SECOND_STREAM_OFFSET) >>> 0);
  assertFiniteSamples(x, "quantizeWithTpdfDither");

  const output = new Float64Array(x.length);
  for (let n = 0; n < x.length; n += 1) {
    const dither = (firstStream() + secondStream() - 1) * step;
    output[n] = quantizeValue((x[n] ?? 0) + dither, step);
  }
  return output;
}

/**
 * Quantization error e[n] = original[n] − quantized[n] (observation
 * convention; the UI labels the polarity). Equal lengths required
 * (RangeError on mismatch); non-finite samples -> TypeError.
 */
export function quantizationError(original: Float64Array, quantized: Float64Array): Float64Array {
  if (original.length !== quantized.length) {
    throw new RangeError(
      `quantizationError: original and quantized must have the same length (got ${original.length} and ${quantized.length})`,
    );
  }
  assertFiniteSamples(original, "quantizationError: original");
  assertFiniteSamples(quantized, "quantizationError: quantized");

  const output = new Float64Array(original.length);
  for (let n = 0; n < original.length; n += 1) {
    output[n] = (original[n] ?? 0) - (quantized[n] ?? 0);
  }
  return output;
}
