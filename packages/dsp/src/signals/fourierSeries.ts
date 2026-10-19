/**
 * Purpose: Fourier-series partial sums for the F12 teaching view. Students add
 * harmonics one at a time and watch a square, sawtooth or triangle wave appear
 * out of sines; the same module measures the Gibbs overshoot so the UI can
 * show the ~9 % ringing that never disappears.
 *
 * Sample grid (same convention as generators.ts):
 *   N = round(durationSeconds * sampleRateHz),  t_n = n / sampleRateHz
 *
 * Series (a = amplitude, f = frequencyHz, w = 2*pi*f, k = harmonic index):
 *   square    x(t) = sum_{k odd}  4a/(pi*k) * sin(k*w*t)
 *   sawtooth  x(t) = sum_{k >= 1} 2a/(pi*k) * (-1)^(k+1) * sin(k*w*t)
 *   triangle  x(t) = sum_{k odd}  8a/(pi^2*k^2) * (-1)^((k-1)/2) * sin(k*w*t)
 *
 * Sign conventions are pinned to the generators in generators.ts:
 *   - The square series is the odd sine series of a bipolar square that is
 *     +a on the first half cycle and -a on the second. At a discontinuity the
 *     series converges to the midpoint 0, whereas generateSquare pins the
 *     samples exactly on a transition to +a (sign(sin) with sign(0) = +1).
 *   - The sawtooth series has the same rising slope as generateSawtooth but
 *     is phase shifted by -T/2: it starts at 0, rises 0 -> +a over the first
 *     half period, and takes the -a branch just after t = T/2, whereas
 *     generateSawtooth starts at -a. The value exactly at the jump t = T/2 is
 *     the midpoint 0 for every partial sum (all sine terms vanish there);
 *     generateSawtooth instead pins its transition sample to -a.
 *   - The triangle series starts at 0, rises to +a at a quarter period and
 *     falls to -a at three quarters, matching generateTriangle. The (-1)^((k-1)/2)
 *     factor is the one that produces that phase (k = 1, 5, 9, ... positive;
 *     k = 3, 7, 11, ... negative).
 * A negative amplitude simply mirrors every waveform, because all three
 * series are odd in a.
 *
 * Gibbs overshoot:
 *   measureGibbsOvershoot(x, a) = max_n |x[n]| / a - 1
 * For the square partial sum this tends to the Gibbs constant
 *   (2/pi) * integral_0^pi sin(t)/t dt - 1 = 0.1789797...
 * i.e. 8.94899... % of the peak-to-peak excursion 2a. The function returns the
 * overshoot relative to the peak amplitude a, hence ~0.17898 at large harmonic
 * counts; dividing the result by 2 gives the familiar fraction of the jump.
 *
 * Reference: Oppenheim & Willsky, "Signals and Systems", 2nd ed., ch. 3
 * (Fourier series representation of periodic signals, including the square
 * wave and Gibbs phenomenon); Oppenheim & Schafer, "Discrete-Time Signal
 * Processing", 3rd ed., section 4.1 for the t = n/fs sampling grid.
 *
 * Complexity: O(N * harmonics) time and O(N) output space for the partial
 * sum; O(N) time and O(1) space for the overshoot measurement.
 *
 * Edge cases: sampleRateHz must be a positive finite number and
 * durationSeconds a non-negative finite number -> RangeError otherwise
 * (R6: every numeric parameter must be finite). The rounded sample count must
 * be a safe integer -> RangeError otherwise; duration 0 returns an empty
 * Float64Array. harmonics must be a positive integer no greater than
 * MAX_FOURIER_HARMONICS (10 000) -> RangeError otherwise; the cap keeps the
 * O(N * harmonics) loop from being driven by an absurd index.
 * The waveform `kind` is a TS union; an unknown runtime value -> RangeError.
 * A non-finite frequencyHz or amplitude -> RangeError. A negative amplitude
 * is accepted and mirrors the waveform. measureGibbsOvershoot requires a
 * positive finite amplitude -> RangeError otherwise; an empty sample array
 * returns 0 (documented convention: there is nothing to overshoot); a
 * non-finite sample -> TypeError (R6 sample-data rule). No input is mutated
 * and every call returns a fresh array.
 */

import type { SignalSpec } from "./generators.js";

const TAU = 2 * Math.PI;

/**
 * Largest accepted harmonic index. The partial sum is O(N * harmonics), so an
 * unbounded index (e.g. 1e9) would hang the caller; 10 000 is far beyond any
 * teaching reconstruction and still runs in a few milliseconds per sample.
 */
const MAX_FOURIER_HARMONICS = 10_000;

export type FourierSeriesKind = "square" | "sawtooth" | "triangle";

export interface FourierSeriesSpec extends SignalSpec {
  kind: FourierSeriesKind;
  frequencyHz: number;
  harmonics: number;
  amplitude: number;
}

function sampleCountOf(spec: SignalSpec, caller: string): number {
  const { durationSeconds, sampleRateHz } = spec;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(
      `${caller}: sampleRateHz must be a positive finite number (got ${sampleRateHz})`,
    );
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new RangeError(
      `${caller}: durationSeconds must be a non-negative finite number (got ${durationSeconds})`,
    );
  }
  const sampleCount = Math.round(durationSeconds * sampleRateHz);
  if (!Number.isSafeInteger(sampleCount)) {
    throw new RangeError(
      `${caller}: durationSeconds * sampleRateHz must be a safe integer sample count (got ${sampleCount})`,
    );
  }
  return sampleCount;
}

function assertFiniteParam(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite (got ${value})`);
  }
}

function assertKind(kind: string, caller: string): asserts kind is FourierSeriesKind {
  if (kind !== "square" && kind !== "sawtooth" && kind !== "triangle") {
    throw new RangeError(`${caller}: unknown kind ${String(kind)}`);
  }
}

/**
 * Partial Fourier series of a square, sawtooth or triangle wave. `harmonics`
 * is the highest harmonic index included (>= 1, <= 10 000); the square and
 * triangle series use only odd indices, the sawtooth uses every index.
 */
export function fourierSeriesPartialSum(spec: FourierSeriesSpec): Float64Array {
  const sampleCount = sampleCountOf(spec, "fourierSeriesPartialSum");
  const { kind, frequencyHz, harmonics, amplitude } = spec;
  assertKind(kind, "fourierSeriesPartialSum");
  assertFiniteParam(frequencyHz, "fourierSeriesPartialSum: frequencyHz");
  assertFiniteParam(amplitude, "fourierSeriesPartialSum: amplitude");
  if (!Number.isFinite(harmonics) || !Number.isInteger(harmonics) || harmonics < 1) {
    throw new RangeError(
      `fourierSeriesPartialSum: harmonics must be a positive integer (got ${harmonics})`,
    );
  }
  if (harmonics > MAX_FOURIER_HARMONICS) {
    throw new RangeError(
      `fourierSeriesPartialSum: harmonics must not exceed ${MAX_FOURIER_HARMONICS} (got ${harmonics})`,
    );
  }

  const values = new Float64Array(sampleCount);
  if (sampleCount === 0) {
    return values;
  }

  // Coefficients are constant across samples, so compute the scale once:
  // square 4a/pi, sawtooth 2a/pi, triangle 8a/pi^2; the 1/k (or 1/k^2) and
  // the alternating sign are applied inside the harmonic loop.
  let scale: number;
  let harmonicStep: number;
  if (kind === "square") {
    scale = (4 * amplitude) / Math.PI;
    harmonicStep = 2;
  } else if (kind === "sawtooth") {
    scale = (2 * amplitude) / Math.PI;
    harmonicStep = 1;
  } else {
    scale = (8 * amplitude) / (Math.PI * Math.PI);
    harmonicStep = 2;
  }

  for (let n = 0; n < sampleCount; n += 1) {
    const timeSeconds = n / spec.sampleRateHz;
    let sum = 0;
    for (let k = 1; k <= harmonics; k += harmonicStep) {
      let sign = 1;
      if (kind === "sawtooth") {
        sign = k % 2 === 1 ? 1 : -1;
      } else if (kind === "triangle") {
        sign = ((k - 1) / 2) % 2 === 0 ? 1 : -1;
      }
      const coefficient = kind === "triangle" ? scale / (k * k) : scale / k;
      sum += sign * coefficient * Math.sin(TAU * k * frequencyHz * timeSeconds);
    }
    values[n] = sum;
  }
  return values;
}

/**
 * Gibbs overshoot of a partial Fourier sum relative to the nominal peak
 * amplitude: max(|x[n]|)/amplitude - 1. Empty samples -> 0. The amplitude
 * must be a positive finite number; non-finite samples -> TypeError (R6).
 */
export function measureGibbsOvershoot(samples: Float64Array, amplitude: number): number {
  if (!Number.isFinite(amplitude) || amplitude <= 0) {
    throw new RangeError(
      `measureGibbsOvershoot: amplitude must be a positive finite number (got ${amplitude})`,
    );
  }
  let peak = 0;
  for (let n = 0; n < samples.length; n += 1) {
    const sample = samples[n] ?? 0;
    if (!Number.isFinite(sample)) {
      throw new TypeError(`measureGibbsOvershoot: samples[${n}] must be finite (got ${sample})`);
    }
    const magnitude = Math.abs(sample);
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  if (samples.length === 0) {
    return 0;
  }
  return peak / amplitude - 1;
}
