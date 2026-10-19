/**
 * Purpose: analysis/synthesis windows (F08, consumed by the STFT in plan 04)
 * and the Kaiser window for filter design (F11, plan 03). Windows taper a
 * finite signal before a DFT to reduce spectral leakage; the periodic and
 * symmetric variants differ only in their denominator and must not be mixed:
 * STFT/overlap-add uses the periodic variant, FIR filter design uses the
 * symmetric variant.
 *
 * Formulas (rect, hann, hamming, blackman; n = 0..L-1):
 *   periodic (denominator L, SciPy `sym=False`):
 *     rect     w[n] = 1
 *     hann     w[n] = 0.5 - 0.5*cos(2*pi*n/L)
 *     hamming  w[n] = 0.54 - 0.46*cos(2*pi*n/L)
 *     blackman w[n] = 0.42 - 0.5*cos(2*pi*n/L) + 0.08*cos(4*pi*n/L)
 *   symmetric (denominator L-1, SciPy default `sym=True`): same expressions
 *   with L replaced by L-1.
 *
 * Kaiser (symmetric only):
 *   w[n] = I0(beta * sqrt(1 - (2*n/(L-1) - 1)^2)) / I0(beta)
 * where I0 is the zeroth-order modified Bessel function of the first kind.
 *
 * I0 is evaluated with its power series
 *   I0(x) = sum_{k=0}^{29} (x^2/4)^k / (k!)^2,
 * accumulated with the term recurrence t_k = t_{k-1} * (x^2/4) / k^2 so no
 * factorial is formed. Truncating at 30 terms is accurate to about 1e-15
 * relative for |x| <= 12 (the golden probe range), about 4e-13 at |x| = 20,
 * and degrades beyond |x| ~ 20 (8.7e-7 at x = 30); the largest Kaiser beta
 * used by the app is far below that. The series overflows only near the
 * double-precision limit |x| ~ 709.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 7.2 (windows in spectral analysis); Harris, "On the use of windows
 * for harmonic analysis with the discrete Fourier transform", Proc. IEEE
 * 66(1), 1978; Kaiser, "Nonrecursive digital filter design using the
 * I0-sinh window function", Proc. IEEE ISCAS, 1974; Abramowitz & Stegun,
 * "Handbook of Mathematical Functions", eq. 9.6.12 (I0 series). SciPy
 * `scipy.signal.windows.*` and `scipy.special.i0` define the golden vectors.
 *
 * Complexity: O(L) time, O(L) space for every function.
 *
 * Edge cases: `length` must be an integer >= 2 -> RangeError otherwise
 * (including NaN, +/-Infinity and non-integers). `beta` and the `i0`
 * argument must be finite -> TypeError otherwise. No input arrays, no
 * mutation; each call returns a fresh Float64Array.
 */

export type WindowKind = "rect" | "hann" | "hamming" | "blackman";

function assertLength(length: number, caller: string): void {
  if (!Number.isInteger(length) || length < 2) {
    throw new RangeError(`${caller}: length must be an integer >= 2 (got ${length})`);
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite (got ${value})`);
  }
}

/**
 * Periodic window of `length` samples (denominator `length`, SciPy
 * `sym=False`). Use for STFT and overlap-add; periodic hann with 50 % hop
 * satisfies the COLA condition (sum of overlapped windows is constant).
 */
export function window(kind: WindowKind, length: number): Float64Array {
  assertLength(length, "window");
  return fillWindow(kind, length, length);
}

/**
 * Symmetric window of `length` samples (denominator `length - 1`, SciPy
 * `sym=True`). Use for FIR filter design; w[n] = w[length - 1 - n].
 */
export function windowSymmetric(kind: WindowKind, length: number): Float64Array {
  assertLength(length, "windowSymmetric");
  return fillWindow(kind, length, length - 1);
}

function fillWindow(kind: WindowKind, length: number, denominator: number): Float64Array {
  const values = new Float64Array(length);
  if (kind === "rect") {
    values.fill(1);
    return values;
  }
  for (let n = 0; n < length; n += 1) {
    const angle = (2 * Math.PI * n) / denominator;
    if (kind === "hann") {
      values[n] = 0.5 - 0.5 * Math.cos(angle);
    } else if (kind === "hamming") {
      values[n] = 0.54 - 0.46 * Math.cos(angle);
    } else {
      values[n] = 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
    }
  }
  return values;
}

/** Zeroth-order modified Bessel function of the first kind, series to k = 29. */
export function i0(x: number): number {
  assertFinite(x, "i0: x");
  const quarterSquare = (x * x) / 4;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 30; k += 1) {
    term *= quarterSquare / (k * k);
    sum += term;
  }
  return sum;
}

/**
 * Symmetric Kaiser window of `length` samples with shape parameter `beta`.
 * Larger beta gives lower side lobes and a wider main lobe; beta = 0 gives a
 * rectangular window. I0 is even, so a negative beta produces the same
 * window as its absolute value.
 */
export function kaiser(length: number, beta: number): Float64Array {
  assertLength(length, "kaiser");
  assertFinite(beta, "kaiser: beta");
  const values = new Float64Array(length);
  const normalizer = i0(beta);
  const denominator = length - 1;
  for (let n = 0; n < length; n += 1) {
    const centered = (2 * n) / denominator - 1;
    values[n] = i0(beta * Math.sqrt(1 - centered * centered)) / normalizer;
  }
  return values;
}
