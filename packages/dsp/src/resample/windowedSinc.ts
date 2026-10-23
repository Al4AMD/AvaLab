/**
 * Purpose: design a linear-phase low-pass FIR filter by the window method,
 * used as the anti-alias/anti-imaging prototype of the rational resampler
 * (`resample/resample.ts`) and, on its own, as the F03/F11 teaching example of
 * how a windowed sinc trades passband ripple against transition width.
 *
 * Formula (H = halfLengthSamples, length L = 2H + 1, k = 0..L-1):
 *   m[k]    = k - H
 *   h[k]    = fc * sinc(fc * m[k]) * w[k]
 *   sinc(x) = 1 for x = 0, otherwise sin(pi*x) / (pi*x)
 *   w       = symmetric Kaiser window of length L and shape beta:
 *             w[k] = I0(beta * sqrt(1 - (2k/(L-1) - 1)^2)) / I0(beta)
 *   h       = h / sum(h)                (unity DC gain, pinned)
 * where fc = cutoffNormalized is the cutoff frequency as a fraction of the
 * Nyquist frequency of the filter's sampling rate (0 < fc <= 1). fc = 1 puts
 * the cutoff at Nyquist and degenerates to the centre tap; fc = 0 is
 * rejected. The Kaiser window is the *symmetric* variant (`kaiser` from
 * plan 01), not the periodic STFT variant.
 *
 * Reference: J. O. Smith III, "Digital Audio Resampling" (CCRMA, Stanford
 * University) for the windowed-sinc interpolator/filter construction;
 * Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed., section
 * 7.2 (FIR design by windowing) and Kaiser (1974) for the window shape.
 * SciPy `scipy.signal.firwin(length, fc, window=("kaiser", beta))` uses the
 * same definition (scale=True divides by the tap sum) and defines the golden
 * vectors through `golden/resample.json`.
 *
 * Complexity: O(H) time and O(H) space; every call returns a fresh
 * Float64Array and the arguments are never mutated.
 *
 * Edge cases: `cutoffNormalized` must be finite with 0 < fc <= 1, else
 * RangeError; `halfLengthSamples` must be an integer >= 1, else RangeError
 * (length is then at least 3); `beta` must be finite and >= 0, else
 * RangeError (R6 parameter rule). The tap sum is positive by construction
 * (the centre tap equals fc > 0 and every window sample is non-negative); a
 * non-finite or zero sum is rejected with RangeError so the normalization
 * can never emit NaN/Infinity.
 */

import { kaiser } from "../fourier/windows.js";

export interface LowpassSincOptions {
  /** Cutoff as a fraction of the Nyquist frequency; finite, 0 < fc <= 1. */
  cutoffNormalized: number;
  /** Half-length H in filter samples; integer >= 1 (length 2H + 1). */
  halfLengthSamples: number;
  /** Kaiser shape parameter; finite and >= 0 (0 gives a rectangular window). */
  beta: number;
}

/** Normalized sinc: sinc(0) = 1, otherwise sin(pi*x)/(pi*x). */
function sinc(x: number): number {
  if (x === 0) {
    return 1;
  }
  const angle = Math.PI * x;
  return Math.sin(angle) / angle;
}

/**
 * Windowed-sinc low-pass design: h[k] = fc*sinc(fc*(k-H))*kaiser[k], normalized
 * to sum(h) = 1. Cutoff is a fraction of Nyquist; returns a fresh array of
 * 2*halfLengthSamples+1 taps.
 */
export function designLowpassSinc(options: LowpassSincOptions): Float64Array {
  const cutoffNormalized: number = options?.cutoffNormalized;
  const halfLengthSamples: number = options?.halfLengthSamples;
  const beta: number = options?.beta;

  if (!Number.isFinite(cutoffNormalized) || cutoffNormalized <= 0 || cutoffNormalized > 1) {
    throw new RangeError(
      `designLowpassSinc: cutoffNormalized must be finite and in (0, 1] (got ${cutoffNormalized})`,
    );
  }
  if (!Number.isInteger(halfLengthSamples) || halfLengthSamples < 1) {
    throw new RangeError(
      `designLowpassSinc: halfLengthSamples must be an integer >= 1 (got ${halfLengthSamples})`,
    );
  }
  if (!Number.isFinite(beta) || beta < 0) {
    throw new RangeError(`designLowpassSinc: beta must be finite and >= 0 (got ${beta})`);
  }

  const length = 2 * halfLengthSamples + 1;
  const window = kaiser(length, beta);
  const taps = new Float64Array(length);
  let sum = 0;
  for (let k = 0; k < length; k += 1) {
    const offset = k - halfLengthSamples;
    const tap = cutoffNormalized * sinc(cutoffNormalized * offset) * (window[k] ?? 0);
    taps[k] = tap;
    sum += tap;
  }

  if (!Number.isFinite(sum) || sum === 0) {
    throw new RangeError(`designLowpassSinc: tap sum must be finite and non-zero (got ${sum})`);
  }
  for (let k = 0; k < length; k += 1) {
    taps[k] = (taps[k] ?? 0) / sum;
  }
  return taps;
}
