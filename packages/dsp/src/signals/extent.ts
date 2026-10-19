/**
 * Purpose: signal-extent operations for the F07 "Signal Extent" lab. Students
 * shift, scale, reverse, truncate and zero-pad a signal and immediately see the
 * effect on duration, sample count, support, energy and average power. All
 * operations are pure, deterministic and return a fresh Float64Array.
 *
 * Definitions (N = samples.length, x indexed 0..N-1):
 *   timeShift(x, s)            y[n] = x[n - s] for 0 <= n - s < N, else 0
 *                              (zero-fill; output length N; s integer)
 *   timeScale(x, a)            L = round_half_up(N / a)
 *                              y[k] = (1 - f)*x[i] + f*x[i + 1],
 *                              p = k*a, i = floor(p), f = p - i,
 *                              clamped to x[N - 1] when p >= N - 1
 *                              (plain linear interpolation, NO anti-alias
 *                              filter: this is the deliberate teaching demo of
 *                              x(a*t), not a production resampler)
 *   reverse(x)                 y[n] = x[N - 1 - n]
 *   truncate(x, s, L)          y = x[s .. min(N, s + L) - 1] (no zero-fill;
 *                              the tail is clamped to the available samples)
 *   zeroPad(x, p, q)           y = [0]*p ++ x ++ [0]*q
 *   support(x, {threshold})    first and last n with |x[n]| > threshold;
 *                              empty support is {start: N, end: N - 1}
 *   classifySignalType(x)      "energy" if the nonzero support is strictly
 *                              inside the window (at least one leading or
 *                              trailing zero); otherwise "power" (a constant
 *                              spanning the whole window, silence, or empty)
 *   signalEnergy(x)            E = sum_{n=0}^{N-1} x[n]^2, empty -> 0
 *   averagePower(x)            P = E / N, empty -> 0
 *
 * Energy and power units are amplitude units squared ("sample^2"): for a
 * signal in [-1, 1], energy is in full-scale^2 samples and average power in
 * full-scale^2. Both are computed in Float64 even for Float32 input.
 *
 * The `round_half_up` convention is pinned: L = floor(N/a + 0.5), matching
 * JavaScript Math.round for non-negative values and the Python reference in
 * tools/golden (Python's built-in round is banker's rounding and is NOT used).
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 1.2 (time transformations: shifting, scaling, reversal), section 1.4
 * (finite-length sequences and support) and section 2.1 (energy and average
 * power of discrete-time signals). NumPy reference values define the golden
 * vectors in test-data/golden/extent.json.
 *
 * Complexity: O(N) time and O(N) output space per operation (truncate and
 * timeScale allocate only their output length; support and the energy helpers
 * are O(N) time and O(1) extra space).
 *
 * Edge cases: any non-finite sample -> TypeError (R6 sample-data rule). Every
 * numeric parameter must be a finite integer / finite number in its stated
 * domain -> RangeError otherwise (R6 parameter rule). timeShift accepts any
 * integer shift, including one larger than N (the output is all zeros);
 * non-integer or non-finite shiftSamples -> RangeError. timeScale requires
 * factor finite and > 0; a factor so small that N/factor is not a safe integer
 * -> RangeError; N = 0 -> empty output. truncate requires startSampleIndex an
 * integer in [0, N] (N yields an empty output) and lengthSamples a
 * non-negative integer; the end is clamped to N. zeroPad requires both pad
 * counts to be non-negative integers and the total length a safe integer.
 * support requires a finite threshold >= 0 and uses a strict comparison
 * (|x[n]| == threshold does not count as support). classifySignalType uses
 * support with threshold 0. Empty inputs return empty / zero / the documented
 * empty-support values. Inputs are never mutated.
 */

import { averagePowerOf, energyOf } from "../utils/energy.js";

export type FloatArray = Float64Array | Float32Array;

export interface SupportOptions {
  threshold: number;
}

export interface SupportRange {
  startSampleIndex: number;
  endSampleIndex: number;
}

export type SignalType = "energy" | "power";

function assertFiniteSamples(samples: FloatArray, caller: string): void {
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

function assertIntegerParam(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer (got ${value})`);
  }
}

function assertNonNegativeIntegerParam(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer (got ${value})`);
  }
}

function assertSafeOutputLength(length: number, caller: string): void {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(
      `${caller}: output length must be a non-negative safe integer (got ${length})`,
    );
  }
}

/**
 * Integer time shift with zero-fill: y[n] = x[n - shiftSamples]. Positive
 * shifts delay the signal (move it to later samples), negative shifts advance
 * it. Output length equals input length; samples shifted past either edge are
 * replaced with zeros (no wrap-around).
 */
export function timeShift(samples: FloatArray, shiftSamples: number): Float64Array {
  assertFiniteSamples(samples, "timeShift");
  assertIntegerParam(shiftSamples, "timeShift: shiftSamples");

  const output = new Float64Array(samples.length);
  for (let n = 0; n < samples.length; n += 1) {
    const sourceIndex = n - shiftSamples;
    if (sourceIndex >= 0 && sourceIndex < samples.length) {
      output[n] = samples[sourceIndex] ?? 0;
    }
  }
  return output;
}

/**
 * Time scaling x(a*t) in the sample domain by plain linear interpolation:
 * output length L = round_half_up(N / factor), and output sample k reads the
 * input at position k * factor, clamped to the last sample past the end. There
 * is intentionally no anti-aliasing filter: factor < 1 interpolates (and
 * stretches), factor > 1 decimates without a low-pass, so aliasing is visible
 * and audible. Use resampleRational from the resampling module when a
 * band-limited result is required.
 */
export function timeScale(samples: FloatArray, factor: number): Float64Array {
  assertFiniteSamples(samples, "timeScale");
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`timeScale: factor must be a positive finite number (got ${factor})`);
  }

  const outputLength = Math.round(samples.length / factor);
  assertSafeOutputLength(outputLength, "timeScale");
  const output = new Float64Array(outputLength);
  if (samples.length === 0) {
    return output;
  }

  const lastPosition = samples.length - 1;
  for (let k = 0; k < outputLength; k += 1) {
    const position = k * factor;
    if (position >= lastPosition) {
      output[k] = samples[lastPosition] ?? 0;
      continue;
    }
    const lowerIndex = Math.floor(position);
    const fraction = position - lowerIndex;
    const lowerSample = samples[lowerIndex] ?? 0;
    const upperSample = samples[lowerIndex + 1] ?? lowerSample;
    output[k] = (1 - fraction) * lowerSample + fraction * upperSample;
  }
  return output;
}

/**
 * Time reversal: y[n] = x[N - 1 - n]. Applying it twice returns the original
 * sequence (as a fresh array). Reversing changes the phase spectrum but leaves
 * the magnitude spectrum unchanged.
 */
export function reverse(samples: FloatArray): Float64Array {
  assertFiniteSamples(samples, "reverse");
  const sampleCount = samples.length;
  const output = new Float64Array(sampleCount);
  for (let n = 0; n < sampleCount; n += 1) {
    output[n] = samples[sampleCount - 1 - n] ?? 0;
  }
  return output;
}

/**
 * Truncation to x[startSampleIndex .. startSampleIndex + lengthSamples - 1].
 * The start must be an integer in [0, N] (N returns an empty output). The end
 * is clamped to the available signal: truncating 5 samples starting 2 samples
 * before the end returns only 2 samples. There is no zero-fill.
 */
export function truncate(
  samples: FloatArray,
  startSampleIndex: number,
  lengthSamples: number,
): Float64Array {
  assertFiniteSamples(samples, "truncate");
  if (
    !Number.isInteger(startSampleIndex) ||
    startSampleIndex < 0 ||
    startSampleIndex > samples.length
  ) {
    throw new RangeError(
      `truncate: startSampleIndex must be an integer in [0, ${samples.length}] (got ${startSampleIndex})`,
    );
  }
  if (!Number.isInteger(lengthSamples) || lengthSamples < 0) {
    throw new RangeError(
      `truncate: lengthSamples must be a non-negative integer (got ${lengthSamples})`,
    );
  }

  const endSampleIndex = Math.min(samples.length, startSampleIndex + lengthSamples);
  const output = new Float64Array(endSampleIndex - startSampleIndex);
  for (let n = 0; n < output.length; n += 1) {
    output[n] = samples[startSampleIndex + n] ?? 0;
  }
  return output;
}

/**
 * Zero padding: padStartSamples zeros, the original samples, then
 * padEndSamples zeros. Both pad counts must be non-negative integers. Padding
 * changes the DFT bin spacing (df = fs/N) and interpolates the spectrum; it
 * adds no new information.
 */
export function zeroPad(
  samples: FloatArray,
  padStartSamples: number,
  padEndSamples: number,
): Float64Array {
  assertFiniteSamples(samples, "zeroPad");
  assertNonNegativeIntegerParam(padStartSamples, "zeroPad: padStartSamples");
  assertNonNegativeIntegerParam(padEndSamples, "zeroPad: padEndSamples");

  const outputLength = padStartSamples + samples.length + padEndSamples;
  assertSafeOutputLength(outputLength, "zeroPad");
  const output = new Float64Array(outputLength);
  for (let n = 0; n < samples.length; n += 1) {
    output[padStartSamples + n] = samples[n] ?? 0;
  }
  return output;
}

/**
 * Nonzero support of a finite observation window: the first and last sample
 * indices with |x[n]| > threshold (strictly greater; equality is outside the
 * support). When no sample exceeds the threshold the support is empty and is
 * reported as {startSampleIndex: N, endSampleIndex: N - 1}, so
 * end - start + 1 == 0.
 */
export function support(samples: FloatArray, options: SupportOptions): SupportRange {
  assertFiniteSamples(samples, "support");
  const threshold = options.threshold;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new RangeError(
      `support: threshold must be a non-negative finite number (got ${threshold})`,
    );
  }

  let startSampleIndex = -1;
  let endSampleIndex = -1;
  for (let n = 0; n < samples.length; n += 1) {
    const magnitude = Math.abs(samples[n] ?? 0);
    if (magnitude > threshold) {
      if (startSampleIndex < 0) {
        startSampleIndex = n;
      }
      endSampleIndex = n;
    }
  }

  if (startSampleIndex < 0) {
    return { startSampleIndex: samples.length, endSampleIndex: samples.length - 1 };
  }
  return { startSampleIndex, endSampleIndex };
}

/**
 * Pedagogical energy/power classification over one finite observation window.
 * A signal whose nonzero support is strictly inside the window (at least one
 * leading or trailing zero sample) is treated as an energy signal: its energy
 * is finite and its average power over the infinite line is zero. A signal
 * that spans the whole window (support reaches both edges, e.g. a constant),
 * or that is silent/empty, is treated as a power signal. Uses support with
 * threshold 0, so any nonzero sample counts.
 */
export function classifySignalType(samples: FloatArray): SignalType {
  const nonzeroSupport = support(samples, { threshold: 0 });
  if (nonzeroSupport.startSampleIndex > nonzeroSupport.endSampleIndex) {
    return "power";
  }
  if (
    nonzeroSupport.startSampleIndex === 0 &&
    nonzeroSupport.endSampleIndex === samples.length - 1
  ) {
    return "power";
  }
  return "energy";
}

/**
 * Total energy E = sum x[n]^2 (amplitude units squared). Empty input -> 0.
 * Non-finite samples -> TypeError (delegates to energyOf).
 */
export function signalEnergy(samples: FloatArray): number {
  return energyOf(samples);
}

/**
 * Average power P = (1/N) sum x[n]^2 (amplitude units squared). Empty input
 * -> 0 by the documented N = 0 convention (delegates to averagePowerOf).
 */
export function averagePower(samples: FloatArray): number {
  return averagePowerOf(samples);
}
