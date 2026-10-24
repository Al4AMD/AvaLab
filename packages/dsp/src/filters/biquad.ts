/**
 * Purpose: RBJ audio-EQ biquad designs (F11). Each function returns one
 * `{b, a}` second-order section normalized so `a[0] = 1`, ready for
 * `applyFilter`. The Audio EQ Cookbook is the definition; the golden vectors
 * evaluate the same closed-form expressions in NumPy.
 *
 * Common variables (f0 = significant frequency, fs = sample rate, Q = q):
 *   w0 = 2*pi*f0/fs
 *   cw = cos(w0), sw = sin(w0)
 *   alpha = sw/(2*Q)
 *   A = 10^(gainDb/40)                          (peaking only)
 *
 * Lowpass:   b = ((1-cw)/2, 1-cw, (1-cw)/2),  a = (1+alpha, -2cw, 1-alpha)
 * Highpass:  b = ((1+cw)/2, -(1+cw), (1+cw)/2), a = same denominator
 * Notch:     b = (1, -2cw, 1),                a = same denominator
 * Peaking:   b = (1+alpha*A, -2cw, 1-alpha*A),
 *            a = (1+alpha/A, -2cw, 1-alpha/A)
 *
 * Reference: R. Bristow-Johnson, "Cookbook formulae for audio EQ biquad
 * filter coefficients" (Audio EQ Cookbook, 2005); W3C Audio EQ Cookbook,
 * https://www.w3.org/TR/audio-eq-cookbook/. Golden coefficients are in
 * `packages/dsp/test-data/golden/iir.json`.
 *
 * Complexity: O(1) time and space per design.
 *
 * Edge cases: sampleRateHz finite and > 0; frequencyHz finite and strictly
 * inside (0, sampleRateHz/2); q finite and > 0; gainDb finite for peaking.
 * Any violation throws RangeError. Coefficients are always finite
 * (a design that overflows throws RangeError) and a[0] is exactly 1. No input
 * is mutated.
 */

import type { IirCoefficients } from "./iir.js";

export interface BiquadOptions {
  frequencyHz: number;
  q: number;
  sampleRateHz: number;
}

export interface BiquadGainOptions extends BiquadOptions {
  gainDb: number;
}

interface BiquadAngles {
  cosW0: number;
  alpha: number;
  a: number;
}

function validateBiquad(options: BiquadOptions, needsGain: boolean): BiquadAngles {
  const frequencyHz = options?.frequencyHz;
  const q = options?.q;
  const sampleRateHz = options?.sampleRateHz;

  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(
      `biquad: sampleRateHz must be finite and > 0 (got ${String(sampleRateHz)})`,
    );
  }
  const nyquistHz = sampleRateHz / 2;
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0 || frequencyHz >= nyquistHz) {
    throw new RangeError(
      `biquad: frequencyHz must be inside (0, ${nyquistHz}) (got ${String(frequencyHz)})`,
    );
  }
  if (!Number.isFinite(q) || q <= 0) {
    throw new RangeError(`biquad: q must be finite and > 0 (got ${String(q)})`);
  }

  const w0 = (2 * Math.PI * frequencyHz) / sampleRateHz;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  let gainAmplitude = 1;
  if (needsGain) {
    const gainDb = (options as BiquadGainOptions).gainDb;
    if (!Number.isFinite(gainDb)) {
      throw new RangeError(`biquad: gainDb must be finite (got ${String(gainDb)})`);
    }
    gainAmplitude = 10 ** (gainDb / 40);
    if (!Number.isFinite(gainAmplitude)) {
      throw new RangeError(`biquad: gainDb is too large (got ${gainDb})`);
    }
  }

  return { cosW0, alpha, a: gainAmplitude };
}

function normalize(
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
): IirCoefficients {
  if (!Number.isFinite(a0) || a0 === 0) {
    throw new RangeError("biquad: design produced a non-finite or zero a0");
  }
  const inverseA0 = 1 / a0;
  const b = Float64Array.of(b0 * inverseA0, b1 * inverseA0, b2 * inverseA0);
  const a = Float64Array.of(1, a1 * inverseA0, a2 * inverseA0);
  for (let index = 0; index < b.length; index += 1) {
    if (!Number.isFinite(b[index])) {
      throw new RangeError("biquad: design produced a non-finite coefficient (b)");
    }
  }
  for (let index = 1; index < a.length; index += 1) {
    if (!Number.isFinite(a[index])) {
      throw new RangeError("biquad: design produced a non-finite coefficient (a)");
    }
  }
  return { b, a };
}

export function biquadLowpass(options: BiquadOptions): IirCoefficients {
  const { cosW0, alpha } = validateBiquad(options, false);
  return normalize((1 - cosW0) / 2, 1 - cosW0, (1 - cosW0) / 2, 1 + alpha, -2 * cosW0, 1 - alpha);
}

export function biquadHighpass(options: BiquadOptions): IirCoefficients {
  const { cosW0, alpha } = validateBiquad(options, false);
  return normalize(
    (1 + cosW0) / 2,
    -(1 + cosW0),
    (1 + cosW0) / 2,
    1 + alpha,
    -2 * cosW0,
    1 - alpha,
  );
}

export function biquadNotch(options: BiquadOptions): IirCoefficients {
  const { cosW0, alpha } = validateBiquad(options, false);
  return normalize(1, -2 * cosW0, 1, 1 + alpha, -2 * cosW0, 1 - alpha);
}

export function biquadPeaking(options: BiquadGainOptions): IirCoefficients {
  const { cosW0, alpha, a } = validateBiquad(options, true);
  return normalize(
    1 + alpha * a,
    -2 * cosW0,
    1 - alpha * a,
    1 + alpha / a,
    -2 * cosW0,
    1 - alpha / a,
  );
}
