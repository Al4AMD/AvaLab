/**
 * Purpose: design a linear-phase FIR filter by the window method (F11). The
 * ideal filter is a sum of sinc-shaped passbands; multiplying by a symmetric
 * window truncates it to `taps` samples and controls the passband ripple /
 * stopband attenuation trade-off. The result is a Type I (odd taps) or Type II
 * (even taps) linear-phase filter.
 *
 * Formula (N = taps, alpha = (N-1)/2, m[n] = n - alpha, normalized frequencies
 * f = cutoffHz / (sampleRateHz / 2) in (0, 1), sinc(x) = sin(pi*x)/(pi*x) with
 * sinc(0) = 1):
 *
 *   passbands                  sum over each passband [left, right]:
 *     lowpass   [0, f_c]       h[n] = w[n] * (right*sinc(right*m[n])
 *     highpass  [f_c, 1]                - left*sinc(left*m[n]))
 *     bandpass  [f_1, f_2]
 *     bandstop  [0, f_1] and [f_2, 1]
 *
 *   w is the symmetric window (SciPy `fftbins=False`): hamming, blackman, or
 *   kaiser with shape beta (default 8.6).
 *
 * Normalization mirrors SciPy `firwin(..., scale=True)` exactly:
 *   - first passband starts at DC (lowpass, bandstop): divide by sum(h), so
 *     the DC gain is unity;
 *   - first passband ends at Nyquist (highpass): divide by
 *     sum(h[n] * cos(pi*m[n])), so the Nyquist gain is unity;
 *   - otherwise (bandpass): divide by
 *     sum(h[n] * cos(pi*m[n]*f_center)) at the centre of the first passband.
 *
 * Reference: J. O. Smith III, "Introduction to Digital Filters with Audio
 * Applications" (CCRMA, Stanford University), chapter on FIR filter design by
 * the window method; Oppenheim & Schafer, "Discrete-Time Signal Processing",
 * 3rd ed., section 7.2. SciPy `scipy.signal.firwin` defines the golden
 * vectors (`test-data/golden/fir.json`).
 *
 * Complexity: O(taps) time and space (at most four normalized cutoff terms
 * per tap).
 *
 * Edge cases: `taps` must be an integer >= 3; `sampleRateHz` finite and > 0;
 * `cutoffHz` must contain exactly 1 value for lowpass/highpass and exactly 2
 * for bandpass/bandstop, each finite and strictly increasing inside
 * (0, sampleRateHz/2); a kaiser `beta` must be finite. Every invalid
 * configuration throws RangeError. Even tap counts are allowed for lowpass
 * and bandpass, but highpass/bandstop with even taps throw RangeError because
 * a Type II filter has a zero at Nyquist and cannot pass it (same rule and
 * message intent as SciPy `firwin`). Unknown runtime `band`/`kind` values
 * throw RangeError. No input is mutated; each call returns a fresh
 * Float64Array of length `taps`.
 */

import { kaiser, windowSymmetric } from "../fourier/windows.js";

export type FirBand = "lowpass" | "highpass" | "bandpass" | "bandstop";
export type FirWindowKind = "hamming" | "blackman" | "kaiser";

export interface FirWindowFilter {
  kind: FirWindowKind;
  /** Kaiser shape parameter; defaults to 8.6 when omitted. */
  beta?: number;
}

export interface FirWindowOptions {
  band: FirBand;
  cutoffHz: number[];
  taps: number;
  sampleRateHz: number;
  windowFilter: FirWindowFilter;
}

const DEFAULT_KAISER_BETA = 8.6;

/** Normalized sinc: sinc(0) = 1, otherwise sin(pi*x)/(pi*x). */
function sinc(x: number): number {
  if (x === 0) {
    return 1;
  }
  const angle = Math.PI * x;
  return Math.sin(angle) / angle;
}

function cutoffCountFor(band: FirBand): number {
  return band === "lowpass" || band === "highpass" ? 1 : 2;
}

/**
 * Windowed-sinc FIR design. Cutoffs are in Hz and normalized internally by
 * `sampleRateHz / 2`; output is normalized exactly like SciPy
 * `firwin(scale=True)` for every band.
 */
export function designFirWindow(options: FirWindowOptions): Float64Array {
  const band: FirBand = options?.band;
  const cutoffHz: number[] = options?.cutoffHz;
  const taps: number = options?.taps;
  const sampleRateHz: number = options?.sampleRateHz;
  const windowFilter: FirWindowFilter = options?.windowFilter;

  if (!Number.isInteger(taps) || taps < 3) {
    throw new RangeError(`designFirWindow: taps must be an integer >= 3 (got ${taps})`);
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(
      `designFirWindow: sampleRateHz must be finite and > 0 (got ${sampleRateHz})`,
    );
  }
  if (band !== "lowpass" && band !== "highpass" && band !== "bandpass" && band !== "bandstop") {
    throw new RangeError(`designFirWindow: unknown band ${String(band)}`);
  }
  if (!Array.isArray(cutoffHz) || cutoffHz.length !== cutoffCountFor(band)) {
    throw new RangeError(
      `designFirWindow: ${band} requires ${cutoffCountFor(band)} cutoffHz value(s)`,
    );
  }

  const nyquistHz = sampleRateHz / 2;
  const normalizedCutoff: number[] = [];
  let previousHz = 0;
  for (let index = 0; index < cutoffHz.length; index += 1) {
    const value = cutoffHz[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RangeError(
        `designFirWindow: cutoffHz[${index}] must be finite (got ${String(value)})`,
      );
    }
    if (value <= 0 || value >= nyquistHz) {
      throw new RangeError(
        `designFirWindow: cutoffHz[${index}] must be inside (0, ${nyquistHz}) (got ${value})`,
      );
    }
    if (index > 0 && value <= previousHz) {
      throw new RangeError("designFirWindow: cutoffHz must be strictly increasing");
    }
    previousHz = value;
    normalizedCutoff.push(value / nyquistHz);
  }

  if ((band === "highpass" || band === "bandstop") && taps % 2 === 0) {
    throw new RangeError(
      "designFirWindow: highpass/bandstop with even taps has zero response at Nyquist",
    );
  }

  const kind = windowFilter?.kind;
  let window: Float64Array;
  if (kind === "hamming" || kind === "blackman") {
    window = windowSymmetric(kind, taps);
  } else if (kind === "kaiser") {
    const beta = windowFilter.beta ?? DEFAULT_KAISER_BETA;
    if (!Number.isFinite(beta)) {
      throw new RangeError(`designFirWindow: kaiser beta must be finite (got ${beta})`);
    }
    window = kaiser(taps, beta);
  } else {
    throw new RangeError(`designFirWindow: unknown window kind ${String(kind)}`);
  }

  // Each pair is one passband [left, right] in normalized frequency.
  const passbands: Array<[number, number]> = [];
  const [firstCutoff, secondCutoff] = normalizedCutoff;
  if (band === "lowpass") {
    passbands.push([0, firstCutoff ?? 0]);
  } else if (band === "highpass") {
    passbands.push([firstCutoff ?? 0, 1]);
  } else if (band === "bandpass") {
    passbands.push([firstCutoff ?? 0, secondCutoff ?? 0]);
  } else {
    passbands.push([0, firstCutoff ?? 0], [secondCutoff ?? 0, 1]);
  }

  const alpha = (taps - 1) / 2;
  const tapsOut = new Float64Array(taps);
  for (let n = 0; n < taps; n += 1) {
    const offset = n - alpha;
    let value = 0;
    for (const [left, right] of passbands) {
      value += right * sinc(right * offset) - left * sinc(left * offset);
    }
    tapsOut[n] = value * (window[n] ?? 0);
  }

  // SciPy `firwin(scale=True)` reference frequency: DC when the first
  // passband starts at 0, Nyquist when it ends at 1, else its centre.
  let scaleFrequency: number;
  if (band === "lowpass" || band === "bandstop") {
    scaleFrequency = 0;
  } else if (band === "highpass") {
    scaleFrequency = 1;
  } else {
    scaleFrequency = 0.5 * ((firstCutoff ?? 0) + (secondCutoff ?? 0));
  }

  let scale = 0;
  for (let n = 0; n < taps; n += 1) {
    scale += (tapsOut[n] ?? 0) * Math.cos(Math.PI * (n - alpha) * scaleFrequency);
  }
  if (!Number.isFinite(scale) || scale === 0) {
    throw new RangeError(`designFirWindow: normalization sum must be finite and non-zero`);
  }
  for (let n = 0; n < taps; n += 1) {
    tapsOut[n] = (tapsOut[n] ?? 0) / scale;
  }
  return tapsOut;
}
