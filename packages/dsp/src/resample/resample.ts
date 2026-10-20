/**
 * Purpose: rational sample-rate conversion for the F03 "Sampling rate & bit
 * depth" lab. Two modes make the same signal path comparable:
 *   - "kaiserSinc": polyphase windowed-sinc interpolation/decimation with the
 *     anti-alias/anti-imaging low-pass, the production-quality path;
 *   - "none": nearest-sample interpolation/decimation with NO filter. This is
 *     the deliberate aliasing demo: a tone above the target Nyquist folds to
 *     |f - fs_out| and students see/hear the alias instead of a filtered
 *     result. The UI must label this path loudly.
 *
 * Rates and factors (controller ruling: L = output/g, M = input/g):
 *   g = gcd(inputRateHz, outputRateHz)
 *   L = outputRateHz / g          (upsampling factor)
 *   M = inputRateHz / g           (downsampling factor)
 *   N_out = round(N_in * outputRateHz / inputRateHz)  (half up, Math.round)
 * Both rates must be positive finite integers when the rates differ (gcd is
 * an integer operation); equal rates copy the input.
 *
 * Filtered path (polyphase windowed sinc, Smith, "Digital Audio Resampling"):
 *   The prototype is designed at the upsampled rate L*fs_in with cutoff
 *   fc = 1 / max(L, M) of its Nyquist, i.e. at min(fs_in, fs_out)/2 once
 *   mapped back to either rate. `halfLengthSamples = 16` is pinned in INPUT
 *   samples, so at the upsampled rate the half-length is 16*max(L, M) taps
 *   (32*max(L,M)+1 taps total); beta = 8.6. The taps are normalized to sum 1
 *   by `designLowpassSinc` and then scaled by L, matching SciPy
 *   `resample_poly(x, L, M, window=firwin(2*16*max(L,M)+1, 1/max(L,M),
 *   window=("kaiser", 8.6)))`, which multiplies the window by `up` itself.
 *   The output alignment, zero boundary extension and the pre-pad /
 *   pre-remove shift follow SciPy's `resample_poly` (`padtype="constant"`):
 *     prePad      = M - (halfLength % M)
 *     preRemove   = (halfLength + prePad) / M
 *     base(m)     = (m + preRemove) * M
 *     y[m]        = sum over k in [0, paddedTaps.length) with
 *                   (base(m) - k) divisible by L and 0 <= (base-k)/L < N of
 *                   paddedTaps[k] * x[(base(m) - k)/L]
 *   paddedTaps is prePad leading zeros followed by L*h. This is the standard
 *   polyphase decomposition; it costs O(N_out * taps / L) multiply-adds.
 *
 * Unfiltered path (controller ruling R4, pinned literally):
 *   y[n] = x[clamp(round(n * inputRateHz / outputRateHz), 0, N - 1)]
 *   No interpolation filter, no averaging: this is what makes the fold exact.
 *
 * Reference: J. O. Smith III, "Digital Audio Resampling" (CCRMA, Stanford
 * University) for polyphase windowed-sinc resampling; Oppenheim & Schafer,
 * "Discrete-Time Signal Processing", 3rd ed., section 4.6 (sampling-rate
 * conversion and aliasing) for the fold |f - fs| in the unfiltered path.
 * SciPy `scipy.signal.resample_poly` defines the golden vectors in
 * `golden/resample.json` with the construction documented above.
 *
 * Complexity: filtered O(N_out * (32*max(L,M)+1) / L) time and O(N_out +
 * max(L,M)) space; unfiltered O(N_out) time and O(N_out) space. Inputs are
 * never mutated and every call returns a fresh Float64Array.
 *
 * Edge cases (R6): a non-finite sample -> TypeError; a rate that is not
 * finite and > 0 -> RangeError, and rates that differ but are not integers
 * -> RangeError (checked even for N = 0, so an empty input with invalid
 * rates is still rejected). An unknown runtime `filter` value -> RangeError;
 * an output length outside the safe-integer range (or unsafe per-sample index
 * arithmetic) -> RangeError. The unfiltered path additionally rejects
 * `(outputLength - 1) * inputRateHz > Number.MAX_SAFE_INTEGER` up front: the
 * nearest-source index `round(n * inputRateHz / outputRateHz)` would then
 * lose integer exactness before the clamp. Equal positive finite rates return
 * an exact copy for both modes (no filter is applied). N = 0, or an output
 * length that rounds to zero (extreme downsampling), returns an empty array
 * once the rates have been validated.
 *
 * The unfiltered guard is necessary because `n * inputRateHz` can exceed
 * 2^53 even when both rates and the output length are safe integers; the
 * subsequent division and Math.round would silently return an inexact
 * (possibly clamped) sample index.
 */

import { designLowpassSinc } from "./windowedSinc.js";

export type ResampleFilter = "kaiserSinc" | "none";

export interface ResampleRationalOptions {
  /** Input sample rate in Hz; finite positive integer when rates differ. */
  inputRateHz: number;
  /** Output sample rate in Hz; finite positive integer when rates differ. */
  outputRateHz: number;
  /** "kaiserSinc" applies the anti-alias filter; "none" is the aliasing demo. */
  filter: ResampleFilter;
}

/** Pinned Kaiser shape parameter (brief / golden construction). */
const KAISER_BETA = 8.6;
/** Pinned half-length in input samples; scaled by max(L, M) at the upsampled rate. */
const HALF_LENGTH_INPUT_SAMPLES = 16;

function assertFiniteSamples(samples: Float64Array, caller: string): void {
  for (let n = 0; n < samples.length; n += 1) {
    const sample: number | undefined = samples[n];
    if (sample === undefined) {
      throw new TypeError(`${caller}: samples[${n}] read out of bounds`);
    }
    if (!Number.isFinite(sample)) {
      throw new TypeError(`${caller}: samples[${n}] must be finite (got ${sample})`);
    }
  }
}

function assertPositiveRate(rate: number, label: string, caller: string): void {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`${caller}: ${label} must be finite and > 0 (got ${rate})`);
  }
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = a;
  let right = b;
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

/**
 * Resample `x` from `inputRateHz` to `outputRateHz` by the rational factor
 * L/M. `filter: "kaiserSinc"` applies the pinned windowed-sinc anti-alias
 * filter; `filter: "none"` is the unfiltered aliasing demo path. Returns a
 * fresh Float64Array of length round(N * outputRateHz / inputRateHz).
 */
export function resampleRational(x: Float64Array, options: ResampleRationalOptions): Float64Array {
  const inputRateHz: number = options?.inputRateHz;
  const outputRateHz: number = options?.outputRateHz;
  const filter: ResampleFilter = options?.filter;

  assertPositiveRate(inputRateHz, "inputRateHz", "resampleRational");
  assertPositiveRate(outputRateHz, "outputRateHz", "resampleRational");
  if (filter !== "kaiserSinc" && filter !== "none") {
    throw new RangeError(
      `resampleRational: filter must be "kaiserSinc" or "none" (got ${String(filter)})`,
    );
  }
  assertFiniteSamples(x, "resampleRational");

  const inputLength = x.length;
  const outputLength = Math.round((inputLength * outputRateHz) / inputRateHz);
  if (!Number.isSafeInteger(outputLength) || outputLength < 0) {
    throw new RangeError(
      `resampleRational: output length must be a non-negative safe integer (got ${outputLength})`,
    );
  }

  if (
    inputRateHz !== outputRateHz &&
    (!Number.isInteger(inputRateHz) || !Number.isInteger(outputRateHz))
  ) {
    throw new RangeError(
      "resampleRational: sample rates must be integers when inputRateHz != outputRateHz " +
        `(got ${inputRateHz} and ${outputRateHz})`,
    );
  }

  if (inputLength === 0 || outputLength === 0) {
    return new Float64Array(0);
  }

  if (inputRateHz === outputRateHz) {
    // Same rates are a passthrough in both modes; a fresh copy keeps the
    // immutable-input contract.
    return new Float64Array(x);
  }

  if (filter === "none") {
    // Nearest-source index round(n * inputRateHz / outputRateHz) must stay
    // exact; check the largest multiplication before entering the loop.
    if ((outputLength - 1) * inputRateHz > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(
        "resampleRational: nearest-sample index arithmetic exceeds the safe integer range",
      );
    }
    // Pinned aliasing demo path: nearest input sample, clamped at both ends.
    const output = new Float64Array(outputLength);
    for (let n = 0; n < outputLength; n += 1) {
      const roundIndex = Math.round((n * inputRateHz) / outputRateHz);
      const inputIndex = Math.min(inputLength - 1, Math.max(0, roundIndex));
      output[n] = x[inputIndex] ?? 0;
    }
    return output;
  }

  const divisor = greatestCommonDivisor(inputRateHz, outputRateHz);
  const upsamplingFactor = outputRateHz / divisor;
  const downsamplingFactor = inputRateHz / divisor;
  const maxRate = Math.max(upsamplingFactor, downsamplingFactor);
  const halfLengthSamples = HALF_LENGTH_INPUT_SAMPLES * maxRate;
  const tapCount = 2 * halfLengthSamples + 1;
  if (!Number.isSafeInteger(halfLengthSamples) || !Number.isSafeInteger(tapCount)) {
    throw new RangeError("resampleRational: filter length exceeds the safe integer range");
  }

  const prePad = downsamplingFactor - (halfLengthSamples % downsamplingFactor);
  const preRemove = (halfLengthSamples + prePad) / downsamplingFactor;
  if (
    !Number.isSafeInteger(preRemove) ||
    !Number.isSafeInteger((outputLength + preRemove) * downsamplingFactor)
  ) {
    throw new RangeError(
      "resampleRational: sample-index arithmetic exceeds the safe integer range",
    );
  }

  const taps = designLowpassSinc({
    cutoffNormalized: 1 / maxRate,
    halfLengthSamples,
    beta: KAISER_BETA,
  });

  // SciPy resample_poly pads the filter at the front so that the output
  // samples line up with the input sample grid (zero-phase alignment), then
  // scales by L to compensate for zero insertion.
  const paddedTaps = new Float64Array(taps.length + prePad);
  for (let k = 0; k < taps.length; k += 1) {
    paddedTaps[k + prePad] = (taps[k] ?? 0) * upsamplingFactor;
  }

  const output = new Float64Array(outputLength);
  for (let m = 0; m < outputLength; m += 1) {
    const base = (m + preRemove) * downsamplingFactor;
    const lastTapIndex = Math.min(paddedTaps.length - 1, base);
    let accumulator = 0;
    for (let k = base % upsamplingFactor; k <= lastTapIndex; k += upsamplingFactor) {
      const inputIndex = (base - k) / upsamplingFactor;
      if (inputIndex < inputLength) {
        accumulator += (paddedTaps[k] ?? 0) * (x[inputIndex] ?? 0);
      }
    }
    output[m] = accumulator;
  }
  return output;
}
