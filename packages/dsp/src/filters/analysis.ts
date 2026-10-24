/**
 * Purpose: analysis of a digital filter given as transfer-function
 * coefficients `{b, a}` (F11): frequency response, phase unwrapping, group
 * delay, impulse/step responses, poles/zeros and stability.
 *
 * Formulas (ω = 2πf/fs is the digital angular frequency in rad/sample):
 *
 *   H(e^{jω}) = Σ_{k=0}^{M} b[k]·e^{-jωk} / Σ_{k=0}^{N} a[k]·e^{-jωk}
 *   |H| (linear magnitude), ∠H = atan2(Im H, Re H) ∈ (−π, π]
 *
 *   The frequency grid is INCLUSIVE at both ends (controller ruling R3):
 *     f[k] = k·(fs/2)/(numPoints − 1),  k = 0..numPoints−1
 *   so the last point is exactly fs/2 (Nyquist).
 *
 *   Phase unwrapping follows `numpy.unwrap` (ruling R5): the phase is
 *   corrected by 2π whenever an adjacent difference reaches or exceeds π.
 *
 *   Group delay (ruling R4; NOT the analytic SciPy group_delay):
 *     τ(ω) = −dφ/dω
 *     τ[k] = −(φ[k+1] − φ[k−1]) / (2·Δω),  Δω = π/(numPoints − 1)
 *   with one-sided differences at the first and last grid points,
 *     τ[0] = −(φ[1] − φ[0])/Δω,
 *     τ[N−1] = −(φ[N−1] − φ[N−2])/Δω.
 *   The units are samples (τ seconds = τ samples / fs). This finite-
 *   difference definition is pinned by the golden generator, which applies
 *   the same formula to SciPy's `freqz` phase.
 *
 *   Responses use the transposed direct form II of `applyFilter` with zero
 *   initial state, so they include the documented start-up transient and
 *   have exactly `n` samples.
 *
 *   Poles and zeros are the roots of `a(z)` and of the leading-zero-trimmed
 *   `b(z)`, computed by the deterministic Durand–Kerner helper in
 *   `polynomial.ts` (ruling R6; fixed initial guesses, tolerance 1e-10 on the
 *   monic relative polynomial residual). A pole `z` is stable in the strict
 *   sense when `|z| < 1 − tolerance` (ruling R7).
 *
 * Numerical honesty about repeated roots: a polynomial with a repeated root
 * is ill-conditioned in double precision. The butterworth lowpass `b` has a
 * fourfold zero at z = −1, and the RBJ lowpass `b` a double zero there; two
 * independent root finders can scatter such zeros by ~1e-4 even though the
 * coefficients are identical. Consequently this module does NOT claim
 * root-to-root accuracy for repeated roots. The pinned accuracy is 1e-8 for
 * SIMPLE roots. Repeated zeros are verified in the tests by (a) the monic
 * numerator residual `|B(z)| / max(1, |z|)^degree <= 1e-8`, (b) the root
 * count, and (c) a cluster check within 1e-3 of the known centre. This is a
 * property of double-precision root finding, not a tolerance fudge.
 *
 * Reference: A. V. Oppenheim & R. W. Schafer, "Discrete-Time Signal
 * Processing", 3rd ed., ch. 5 (frequency response), ch. 6 (IIR structures)
 * and ch. 7 (pole-zero and stability); SciPy `scipy.signal.freqz` defines the
 * frequency-response golden vectors; NumPy `numpy.unwrap` defines the phase
 * unwrapping golden vectors; Durand (1960) and Kerner (1966) for the
 * simultaneous root iteration.
 *
 * Complexity: `freqz` O(numPoints·(len b + len a)) time and O(numPoints)
 * space; `unwrapPhase` O(numPoints); `groupDelaySamples` the same as `freqz`
 * plus O(numPoints); `impulseResponse`/`stepResponse` O(n·max(len b, len a))
 * time and O(n) space; `polesZeros` O(D²) per Durand–Kerner iteration (D =
 * polynomial degree) and O(D) space; `isStable` O(number of poles).
 *
 * Edge cases: `b` and `a` must be non-empty `Float64Array`s with finite
 * entries and `a[0] !== 0`; non-finite coefficients throw `TypeError`, an
 * empty array or `a[0] = 0` throws `RangeError`. `numPoints` must be an
 * integer >= 2 and `sampleRateHz` finite > 0 → else `RangeError`.
 * `freqz` throws `RangeError` when the denominator vanishes on the unit
 * circle (a pole there, e.g. `a = [1, -1]` at DC): the response is undefined
 * and `0/0` would otherwise surface as a silent NaN. The guard triggers when
 * `|A|² <= Number.MIN_VALUE`, which also covers subnormal squares.
 * `unwrapPhase` throws `TypeError` for non-finite phase values, and empty
 * input returns an empty array. Response lengths must be non-negative
 * integers (0 returns an empty array after the coefficient guards). A
 * non-converged pole/zero solve throws `RangeError` instead of returning
 * partial roots. `isStable` rejects non-finite pole data with `TypeError`,
 * mismatched parallel-array lengths with `RangeError`, and requires a finite
 * tolerance >= 0; an empty pole set is stable. A zero magnitude converts to
 * `-Infinity` dB in `magnitudeDb`; negative or non-finite magnitudes are
 * rejected. No input is mutated and every call returns fresh arrays.
 */

import type { Complex } from "../fourier/complex.js";
import { applyFilter, type IirCoefficients } from "./iir.js";
import { polynomialRoots } from "./polynomial.js";

export interface FreqzOptions {
  /** Number of grid points, inclusive at 0 and Nyquist. */
  numPoints: number;
  /** Digital sample rate in Hz. */
  sampleRateHz: number;
}

export interface FreqzResult {
  /** Frequency grid in Hz, inclusive from 0 to sampleRateHz/2. */
  frequencyHz: Float64Array;
  /** Linear magnitude |H| (dB conversion is the caller's job). */
  magnitude: Float64Array;
  /** Wrapped phase ∠H in rad, in (−π, π]. */
  phaseRad: Float64Array;
}

export interface PolesZerosResult {
  /** Roots of `a` in the solver's deterministic order. */
  poles: Complex;
  /** Roots of the leading-zero-trimmed `b` in the solver's order. */
  zeros: Complex;
}

const TWO_PI = 2 * Math.PI;
const PHASE_DISCONTINUITY_RAD = Math.PI;
/** Monic relative residual tolerance documented by `polynomialRoots`. */
const ROOT_RESIDUAL_TOLERANCE_TEXT = "1e-10";

function validateCoefficients(functionName: string, b: Float64Array, a: Float64Array): void {
  if (!(b instanceof Float64Array) || !(a instanceof Float64Array)) {
    throw new TypeError(`${functionName}: b and a must be Float64Array values`);
  }
  if (b.length === 0 || a.length === 0) {
    throw new RangeError(`${functionName}: b and a must not be empty`);
  }
  for (let index = 0; index < b.length; index += 1) {
    if (!Number.isFinite(b[index])) {
      throw new TypeError(`${functionName}: b[${index}] must be finite`);
    }
  }
  for (let index = 0; index < a.length; index += 1) {
    if (!Number.isFinite(a[index])) {
      throw new TypeError(`${functionName}: a[${index}] must be finite`);
    }
  }
  if (a[0] === 0) {
    throw new RangeError(`${functionName}: a[0] must be non-zero`);
  }
}

function validateOptions(
  functionName: string,
  options: FreqzOptions,
): { numPoints: number; sampleRateHz: number } {
  if (options === null || typeof options !== "object") {
    throw new RangeError(`${functionName}: options must be an object`);
  }
  const { numPoints, sampleRateHz } = options;
  if (!Number.isInteger(numPoints) || numPoints < 2) {
    throw new RangeError(`${functionName}: numPoints must be an integer >= 2`);
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(`${functionName}: sampleRateHz must be finite and > 0`);
  }
  return { numPoints, sampleRateHz };
}

function validateLength(functionName: string, n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`${functionName}: n must be a non-negative integer`);
  }
}

/**
 * Evaluate `c[0] + c[1]·z⁻¹ + ... + c[M]·z⁻ᴹ` at `z⁻¹ = exp(-j*omega)` by
 * Horner's rule. SciPy's `freqz` evaluates the coefficients in this ascending
 * order (`npp_polyval`), so the golden comparison isolates the analysis code.
 */
function evaluateAtUnitCircle(
  coefficients: Float64Array,
  omega: number,
): { re: number; im: number } {
  const cos = Math.cos(-omega);
  const sin = Math.sin(-omega);
  let re = coefficients[coefficients.length - 1] ?? 0;
  let im = 0;
  for (let index = coefficients.length - 2; index >= 0; index -= 1) {
    const nextRe = re * cos - im * sin;
    const nextIm = re * sin + im * cos;
    re = nextRe + (coefficients[index] ?? 0);
    im = nextIm;
  }
  return { re, im };
}

/**
 * Frequency response H(e^{jω}) on an inclusive linear grid from 0 to fs/2.
 * Magnitude is linear; phase is wrapped to (−π, π].
 */
export function freqz(b: Float64Array, a: Float64Array, options: FreqzOptions): FreqzResult {
  validateCoefficients("freqz", b, a);
  const { numPoints, sampleRateHz } = validateOptions("freqz", options);

  const frequencyHz = new Float64Array(numPoints);
  const magnitude = new Float64Array(numPoints);
  const phaseRad = new Float64Array(numPoints);
  const deltaOmega = PHASE_DISCONTINUITY_RAD / (numPoints - 1);
  const nyquistHz = sampleRateHz / 2;

  for (let index = 0; index < numPoints; index += 1) {
    // The final point is pinned exactly to Nyquist so the inclusive grid
    // contract cannot drift by one ulp.
    const frequencyHzValue =
      index === numPoints - 1 ? nyquistHz : (index * nyquistHz) / (numPoints - 1);
    frequencyHz[index] = frequencyHzValue;
    const omega = index === numPoints - 1 ? PHASE_DISCONTINUITY_RAD : index * deltaOmega;
    const numerator = evaluateAtUnitCircle(b, omega);
    const denominator = evaluateAtUnitCircle(a, omega);
    const denominatorMagnitudeSquared =
      denominator.re * denominator.re + denominator.im * denominator.im;
    // A vanishing denominator means a pole on the unit circle: H is undefined
    // there, and permitting 0/0 would silently poison magnitude and phase.
    if (denominatorMagnitudeSquared <= Number.MIN_VALUE) {
      throw new RangeError(
        `freqz: filter has a pole on the unit circle at ${frequencyHzValue} Hz; response undefined`,
      );
    }
    const real =
      (numerator.re * denominator.re + numerator.im * denominator.im) / denominatorMagnitudeSquared;
    const imaginary =
      (numerator.im * denominator.re - numerator.re * denominator.im) / denominatorMagnitudeSquared;
    magnitude[index] = Math.hypot(real, imaginary);
    phaseRad[index] = Math.atan2(imaginary, real);
  }

  return { frequencyHz, magnitude, phaseRad };
}

/**
 * Convert linear magnitudes to decibels: `20·log10(|H|)`.
 * A zero magnitude becomes `-Infinity`; negative or non-finite magnitudes
 * are invalid.
 */
export function magnitudeDb(magnitude: Float64Array): Float64Array {
  if (!(magnitude instanceof Float64Array)) {
    throw new TypeError("magnitudeDb: magnitude must be a Float64Array");
  }
  const decibels = new Float64Array(magnitude.length);
  for (let index = 0; index < magnitude.length; index += 1) {
    const value = magnitude[index] ?? Number.NaN;
    if (!Number.isFinite(value)) {
      throw new TypeError(`magnitudeDb: magnitude[${index}] must be finite`);
    }
    if (value < 0) {
      throw new RangeError(`magnitudeDb: magnitude[${index}] must be non-negative`);
    }
    decibels[index] = 20 * Math.log10(value);
  }
  return decibels;
}

/**
 * Unwrap a wrapped phase sequence by the same rule as `numpy.unwrap`:
 * adjacent differences `>= π` are complemented by multiples of 2π.
 */
export function unwrapPhase(phase: Float64Array): Float64Array {
  if (!(phase instanceof Float64Array)) {
    throw new TypeError("unwrapPhase: phase must be a Float64Array");
  }
  for (let index = 0; index < phase.length; index += 1) {
    if (!Number.isFinite(phase[index])) {
      throw new TypeError(`unwrapPhase: phase[${index}] must be finite`);
    }
  }
  const unwrapped = new Float64Array(phase.length);
  if (phase.length === 0) {
    return unwrapped;
  }
  unwrapped[0] = phase[0] ?? 0;
  let correction = 0;
  for (let index = 1; index < phase.length; index += 1) {
    const previous = phase[index - 1] ?? 0;
    const current = phase[index] ?? 0;
    const difference = current - previous;
    if (Math.abs(difference) >= PHASE_DISCONTINUITY_RAD) {
      // mod(difference + π, 2π) - π, matching numpy.unwrap exactly; the
      // lower boundary is mapped to +π when the jump is positive.
      let reduced =
        ((((difference + PHASE_DISCONTINUITY_RAD) % TWO_PI) + TWO_PI) % TWO_PI) -
        PHASE_DISCONTINUITY_RAD;
      if (reduced === -PHASE_DISCONTINUITY_RAD && difference > 0) {
        reduced = PHASE_DISCONTINUITY_RAD;
      }
      correction += reduced - difference;
    }
    unwrapped[index] = current + correction;
  }
  return unwrapped;
}

/**
 * Group delay in samples, `−dφ/dω`, by central finite differences of the
 * unwrapped phase on the inclusive `freqz` grid; one-sided at the endpoints.
 */
export function groupDelaySamples(
  b: Float64Array,
  a: Float64Array,
  options: FreqzOptions,
): Float64Array {
  const response = freqz(b, a, options);
  const phase = unwrapPhase(response.phaseRad);
  const numPoints = phase.length;
  const deltaOmega = PHASE_DISCONTINUITY_RAD / (numPoints - 1);
  const groupDelay = new Float64Array(numPoints);

  groupDelay[0] = -((phase[1] ?? 0) - (phase[0] ?? 0)) / deltaOmega;
  if (numPoints > 2) {
    for (let index = 1; index < numPoints - 1; index += 1) {
      groupDelay[index] = -((phase[index + 1] ?? 0) - (phase[index - 1] ?? 0)) / (2 * deltaOmega);
    }
  }
  groupDelay[numPoints - 1] =
    -((phase[numPoints - 1] ?? 0) - (phase[numPoints - 2] ?? 0)) / deltaOmega;
  return groupDelay;
}

/** Unit-impulse response of `{b, a}` with zero initial state, length `n`. */
export function impulseResponse(b: Float64Array, a: Float64Array, n: number): Float64Array {
  validateCoefficients("impulseResponse", b, a);
  validateLength("impulseResponse", n);
  const impulse = new Float64Array(n);
  if (n > 0) {
    impulse[0] = 1;
  }
  return applyFilter(impulse, { b, a } satisfies IirCoefficients);
}

/** Unit-step response of `{b, a}` with zero initial state, length `n`. */
export function stepResponse(b: Float64Array, a: Float64Array, n: number): Float64Array {
  validateCoefficients("stepResponse", b, a);
  validateLength("stepResponse", n);
  const step = new Float64Array(n);
  step.fill(1);
  return applyFilter(step, { b, a } satisfies IirCoefficients);
}

function rootsToComplex(roots: ReadonlyArray<{ re: number; im: number }>): Complex {
  const re = new Float64Array(roots.length);
  const im = new Float64Array(roots.length);
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index] ?? { re: 0, im: 0 };
    re[index] = root.re;
    im[index] = root.im;
  }
  return { re, im };
}

/**
 * Poles (roots of `a`) and zeros (roots of the leading-zero-trimmed `b`) via
 * the deterministic Durand–Kerner helper. Simple roots are accurate to the
 * pinned 1e-8 golden tolerance; repeated roots are ill-conditioned in double
 * precision and are not claimed to be root-to-root accurate (see the header).
 */
export function polesZeros(b: Float64Array, a: Float64Array): PolesZerosResult {
  validateCoefficients("polesZeros", b, a);

  let firstNonZero = 0;
  while (firstNonZero < b.length && b[firstNonZero] === 0) {
    firstNonZero += 1;
  }
  const trimmedNumerator = Array.from(b.subarray(firstNonZero));
  const zeroDegree = trimmedNumerator.length - 1;
  // Degree-30 FIR zeros cluster around the unit circle; the default R = 0.5
  // initial circle makes the Weierstrass denominators collide. Keep the
  // degree <= 16 behavior (the IIR design guard) unchanged.
  const zeroSolution = polynomialRoots(trimmedNumerator, {
    initialRadius: zeroDegree > 16 ? 1 : 0.5,
  });
  if (!zeroSolution.converged) {
    throw new RangeError(
      `polesZeros: numerator root finding did not converge (relative residual tolerance ${ROOT_RESIDUAL_TOLERANCE_TEXT})`,
    );
  }
  const poleSolution = polynomialRoots(Array.from(a));
  if (!poleSolution.converged) {
    throw new RangeError(
      `polesZeros: denominator root finding did not converge (relative residual tolerance ${ROOT_RESIDUAL_TOLERANCE_TEXT})`,
    );
  }

  return {
    poles: rootsToComplex(poleSolution.roots),
    zeros: rootsToComplex(zeroSolution.roots),
  };
}

/**
 * Strict stability test: every pole must satisfy `|z| < 1 − tolerance`
 * (default tolerance 0). An empty pole set is stable.
 */
export function isStable(poles: Complex, tolerance = 0): boolean {
  if (poles === null || typeof poles !== "object") {
    throw new TypeError("isStable: poles must be a Complex object");
  }
  const { re, im } = poles;
  if (!(re instanceof Float64Array) || !(im instanceof Float64Array)) {
    throw new TypeError("isStable: poles.re and poles.im must be Float64Array values");
  }
  if (re.length !== im.length) {
    throw new RangeError("isStable: poles.re and poles.im must have equal lengths");
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError("isStable: tolerance must be finite and >= 0");
  }
  for (let index = 0; index < re.length; index += 1) {
    if (!Number.isFinite(re[index]) || !Number.isFinite(im[index])) {
      throw new TypeError(`isStable: pole[${index}] must be finite`);
    }
  }

  const threshold = 1 - tolerance;
  for (let index = 0; index < re.length; index += 1) {
    const modulus = Math.hypot(re[index] ?? 0, im[index] ?? 0);
    if (!(modulus < threshold)) {
      return false;
    }
  }
  return true;
}
