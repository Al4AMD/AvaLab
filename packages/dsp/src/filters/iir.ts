/**
 * Purpose: design IIR filters from analog prototypes (F11):
 * `designButterworth` (maximally flat passband) and `designChebyshev1`
 * (equiripple passband) for lowpass, highpass, bandpass and bandstop, plus
 * `applyFilter`, a direct-form II transposed realization of any `{b, a}`
 * coefficient pair.
 *
 * Formulas (analog prototype, then frequency transform, then bilinear):
 *
 *   Butterworth prototype poles (N-th order, cutoff 1 rad/s):
 *     p_k = -exp(j*pi*m_k/(2N)),  m_k = -N+1, -N+3, ..., N-1
 *     z = none, k = 1
 *
 *   Chebyshev I prototype (rp dB passband ripple):
 *     eps = sqrt(10^(rp/10) - 1)
 *     mu = asinh(1/eps) / N
 *     p_k = -sinh(mu + j*pi*m_k/(2N)),  m_k = -N+1, -N+3, ..., N-1
 *     k = real(prod(-p_k));  k /= sqrt(1 + eps^2) when N is even
 *
 *   Prewarping (fs is the digital sample rate; scipy evaluates the same
 *   expression with its internal fs = 2):
 *     Wn = fc / (fs/2),  w_c = 4*tan(pi*Wn/2)
 *
 *   Frequency transformations (s-plane, relative degree d = #poles - #zeros):
 *     lowpass   s -> s/w0:        z <- w0*z, p <- w0*p, k <- k*w0^d
 *     highpass  s -> w0/s:        z <- w0/z + d zeros at 0, k <- k*Re(prod(-z)/prod(-p))
 *     bandpass  s -> (s^2+w0^2)/(s*B): duplicate poles/zeros through
 *               (B/2)*p +/- sqrt(((B/2)*p)^2 - w0^2), add d zeros at 0,
 *               k <- k*B^d
 *     bandstop  s -> s*B/(s^2+w0^2): duplicate through
 *               (B/2)/p +/- sqrt(((B/2)/p)^2 - w0^2), add d zeros at +/-j*w0,
 *               k <- k*Re(prod(-z)/prod(-p))
 *   with B = w_high - w_low and w0 = sqrt(w_low*w_high) from the warped
 *   cutoffs.
 *
 *   Bilinear transform (fs2 = 2*fs):
 *     z_d = (fs2 + z_a)/(fs2 - z_a),  p_d = (fs2 + p_a)/(fs2 - p_a),
 *     d zeros at z = -1,  k_d = k_a*Re(prod(fs2 - z_a)/prod(fs2 - p_a))
 *
 *   Coefficients: b = k_d*poly(z_d), a = poly(p_d), real parts (the
 *   conjugate pairs make both polynomials real).
 *
 *   applyFilter uses transposed direct form II with zero initial state,
 *   coefficients normalized internally by a[0]:
 *     y[n]   = b0*x[n] + s0[n-1]
 *     s_i[n] = b_{i+1}*x[n] - a_{i+1}*y[n] + s_{i+1}[n-1]
 *   where s has max(len(b), len(a)) - 1 entries and signals are zero outside
 *   their supports. The state update evaluates `b*x + s_next - a*y` (the
 *   delayed state before the feedback term), which is mathematically
 *   identical to the formula above but matches SciPy `lfilter`'s rounding
 *   order, so the golden outputs agree closely. The recursive response starts
 *   with a transient because the state is zero; the output keeps the input
 *   length.
 *
 * Reference: A. V. Oppenheim & R. W. Schafer, "Discrete-Time Signal
 * Processing", 3rd ed., ch. 6 (IIR structures) and ch. 7 (analog prototypes,
 * bilinear transform); SciPy `scipy.signal.butter` / `cheby1` define the
 * coefficients in `packages/dsp/test-data/golden/iir.json`.
 *
 * Complexity: design O(N^2) with N = order (at most 8); applyFilter
 * O(inputLength * max(len(b), len(a))).
 *
 * Edge cases: order must be an integer in [1, 8] (higher orders in b/a form
 * are numerically fragile, so they are rejected); rippleDb must be in
 * [0.1, 3]; sampleRateHz finite and > 0; cutoffHz holds exactly 1 value for
 * lowpass/highpass and 2 for bandpass/bandstop, finite, strictly increasing,
 * each strictly inside (0, sampleRateHz/2). Every invalid configuration throws
 * RangeError. applyFilter throws TypeError for NaN/Infinity in the data or in
 * b/a, and RangeError for empty b/a or a[0] = 0. Empty data returns an empty
 * array after the coefficient guards pass. No input is mutated.
 */

export type IirBand = "lowpass" | "highpass" | "bandpass" | "bandstop";

export interface IirCoefficients {
  b: Float64Array;
  a: Float64Array;
}

export interface ButterworthOptions {
  band: IirBand;
  cutoffHz: number[];
  order: number;
  sampleRateHz: number;
}

export interface Chebyshev1Options extends ButterworthOptions {
  /** Passband ripple in dB, in [0.1, 3]. */
  rippleDb: number;
}

interface ComplexValue {
  re: number;
  im: number;
}

interface AnalogPrototype {
  zeros: ComplexValue[];
  poles: ComplexValue[];
  gain: number;
}

const MAX_ORDER = 8;
const MIN_RIPPLE_DB = 0.1;
const MAX_RIPPLE_DB = 3;

function complex(re: number, im: number): ComplexValue {
  return { re, im };
}

function addComplex(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re + right.re, im: left.im + right.im };
}

function subtractComplex(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re - right.re, im: left.im - right.im };
}

function multiplyComplex(left: ComplexValue, right: ComplexValue): ComplexValue {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re,
  };
}

function divideComplex(left: ComplexValue, right: ComplexValue): ComplexValue {
  const denominator = right.re * right.re + right.im * right.im;
  return {
    re: (left.re * right.re + left.im * right.im) / denominator,
    im: (left.im * right.re - left.re * right.im) / denominator,
  };
}

/** Principal square root, matching NumPy's branch (real part >= 0). */
function sqrtComplex(value: ComplexValue): ComplexValue {
  const modulus = Math.hypot(value.re, value.im);
  const real = Math.sqrt(Math.max(0, (modulus + value.re) / 2));
  const imaginary = Math.sqrt(Math.max(0, (modulus - value.re) / 2));
  return { re: real, im: value.im < 0 ? -imaginary : imaginary };
}

function negateComplex(value: ComplexValue): ComplexValue {
  return { re: -value.re, im: -value.im };
}

function productOf(values: readonly ComplexValue[]): ComplexValue {
  let result = complex(1, 0);
  for (const value of values) {
    result = multiplyComplex(result, value);
  }
  return result;
}

/** Coefficients of prod_k (x - root_k), highest power first. */
function polynomialFromRoots(roots: readonly ComplexValue[]): ComplexValue[] {
  let coefficients: ComplexValue[] = [complex(1, 0)];
  for (const root of roots) {
    const next: ComplexValue[] = Array.from({ length: coefficients.length + 1 }, () =>
      complex(0, 0),
    );
    for (let index = 0; index < coefficients.length; index += 1) {
      const coefficient = coefficients[index] ?? complex(0, 0);
      const previous = next[index] ?? complex(0, 0);
      next[index] = addComplex(previous, coefficient);
      const scaled = multiplyComplex(coefficient, root);
      const tail = next[index + 1] ?? complex(0, 0);
      next[index + 1] = subtractComplex(tail, scaled);
    }
    coefficients = next;
  }
  return coefficients;
}

function validateCommon(options: ButterworthOptions): number {
  const band = options?.band;
  const order = options?.order;
  const sampleRateHz = options?.sampleRateHz;

  if (!Number.isInteger(order) || order < 1 || order > MAX_ORDER) {
    throw new RangeError(
      `designIir: order must be an integer in [1, ${MAX_ORDER}] (got ${String(order)})`,
    );
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(
      `designIir: sampleRateHz must be finite and > 0 (got ${String(sampleRateHz)})`,
    );
  }
  if (band !== "lowpass" && band !== "highpass" && band !== "bandpass" && band !== "bandstop") {
    throw new RangeError(`designIir: unknown band ${String(band)}`);
  }
  return order;
}

/** Validates cutoffs and returns them prewarped for fs = 2 (SciPy's internal form). */
function warpedCutoffs(options: ButterworthOptions): number[] {
  const band = options.band;
  const cutoffHz = options.cutoffHz;
  const sampleRateHz = options.sampleRateHz;
  const expectedCount = band === "lowpass" || band === "highpass" ? 1 : 2;

  if (!Array.isArray(cutoffHz) || cutoffHz.length !== expectedCount) {
    throw new RangeError(`designIir: ${band} requires ${expectedCount} cutoffHz value(s)`);
  }

  const nyquistHz = sampleRateHz / 2;
  const warped: number[] = [];
  let previousHz = 0;
  for (let index = 0; index < cutoffHz.length; index += 1) {
    const value = cutoffHz[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RangeError(`designIir: cutoffHz[${index}] must be finite`);
    }
    if (value <= 0 || value >= nyquistHz) {
      throw new RangeError(
        `designIir: cutoffHz[${index}] must be inside (0, ${nyquistHz}) (got ${value})`,
      );
    }
    if (index > 0 && value <= previousHz) {
      throw new RangeError("designIir: cutoffHz must be strictly increasing");
    }
    previousHz = value;
    const normalized = value / nyquistHz;
    warped.push(4 * Math.tan((Math.PI * normalized) / 2));
  }
  return warped;
}

function butterworthPrototype(order: number): AnalogPrototype {
  const poles: ComplexValue[] = [];
  for (let index = 0; index < order; index += 1) {
    const m = -order + 1 + 2 * index;
    const angle = (Math.PI * m) / (2 * order);
    poles.push(complex(-Math.cos(angle), -Math.sin(angle)));
  }
  return { zeros: [], poles, gain: 1 };
}

function chebyshev1Prototype(order: number, rippleDb: number): AnalogPrototype {
  const epsilon = Math.sqrt(10 ** (0.1 * rippleDb) - 1);
  const mu = Math.asinh(1 / epsilon) / order;
  const poles: ComplexValue[] = [];
  for (let index = 0; index < order; index += 1) {
    const m = -order + 1 + 2 * index;
    const angle = (Math.PI * m) / (2 * order);
    poles.push(complex(-Math.sinh(mu) * Math.cos(angle), -Math.cosh(mu) * Math.sin(angle)));
  }

  let gain = productOf(poles.map(negateComplex)).re;
  if (order % 2 === 0) {
    gain /= Math.sqrt(1 + epsilon * epsilon);
  }
  return { zeros: [], poles, gain };
}

function transformPrototype(
  prototype: AnalogPrototype,
  band: IirBand,
  warped: readonly number[],
): AnalogPrototype {
  let zeros = prototype.zeros;
  let poles = prototype.poles;
  let gain = prototype.gain;
  const degree = poles.length - zeros.length;

  if (band === "lowpass") {
    const cutoff = warped[0] ?? 0;
    zeros = zeros.map((zero) => complex(zero.re * cutoff, zero.im * cutoff));
    poles = poles.map((pole) => complex(pole.re * cutoff, pole.im * cutoff));
    gain *= cutoff ** degree;
  } else if (band === "highpass") {
    const cutoff = warped[0] ?? 0;
    zeros = zeros.map((zero) => {
      const scaled = divideComplex(complex(cutoff, 0), zero);
      return scaled;
    });
    poles = poles.map((pole) => divideComplex(complex(cutoff, 0), pole));
    for (let index = 0; index < degree; index += 1) {
      zeros.push(complex(0, 0));
    }
    gain *= divideComplex(
      productOf(prototype.zeros.map(negateComplex)),
      productOf(prototype.poles.map(negateComplex)),
    ).re;
  } else {
    const low = warped[0] ?? 0;
    const high = warped[1] ?? 0;
    const bandwidth = high - low;
    const center = Math.sqrt(low * high);

    if (band === "bandpass") {
      const scaledZeros = zeros.map((zero) =>
        complex((zero.re * bandwidth) / 2, (zero.im * bandwidth) / 2),
      );
      const scaledPoles = poles.map((pole) =>
        complex((pole.re * bandwidth) / 2, (pole.im * bandwidth) / 2),
      );
      zeros = [];
      poles = [];
      for (const value of scaledZeros) {
        const root = sqrtComplex(
          subtractComplex(multiplyComplex(value, value), complex(center * center, 0)),
        );
        zeros.push(addComplex(value, root), subtractComplex(value, root));
      }
      for (const value of scaledPoles) {
        const root = sqrtComplex(
          subtractComplex(multiplyComplex(value, value), complex(center * center, 0)),
        );
        poles.push(addComplex(value, root), subtractComplex(value, root));
      }
      for (let index = 0; index < degree; index += 1) {
        zeros.push(complex(0, 0));
      }
      gain *= bandwidth ** degree;
    } else {
      const invertedZeros = zeros.map((zero) => divideComplex(complex(bandwidth / 2, 0), zero));
      const invertedPoles = poles.map((pole) => divideComplex(complex(bandwidth / 2, 0), pole));
      zeros = [];
      poles = [];
      for (const value of invertedZeros) {
        const root = sqrtComplex(
          subtractComplex(multiplyComplex(value, value), complex(center * center, 0)),
        );
        zeros.push(addComplex(value, root), subtractComplex(value, root));
      }
      for (const value of invertedPoles) {
        const root = sqrtComplex(
          subtractComplex(multiplyComplex(value, value), complex(center * center, 0)),
        );
        poles.push(addComplex(value, root), subtractComplex(value, root));
      }
      for (let index = 0; index < degree; index += 1) {
        zeros.push(complex(0, center), complex(0, -center));
      }
      gain *= divideComplex(
        productOf(prototype.zeros.map(negateComplex)),
        productOf(prototype.poles.map(negateComplex)),
      ).re;
    }
  }

  return { zeros, poles, gain };
}

function bilinearTransform(prototype: AnalogPrototype): AnalogPrototype {
  const fs2 = 4;
  const degree = prototype.poles.length - prototype.zeros.length;
  const zeros = prototype.zeros.map((zero) =>
    divideComplex(addComplex(complex(fs2, 0), zero), subtractComplex(complex(fs2, 0), zero)),
  );
  const poles = prototype.poles.map((pole) =>
    divideComplex(addComplex(complex(fs2, 0), pole), subtractComplex(complex(fs2, 0), pole)),
  );
  const gain =
    prototype.gain *
    divideComplex(
      productOf(prototype.zeros.map((zero) => subtractComplex(complex(fs2, 0), zero))),
      productOf(prototype.poles.map((pole) => subtractComplex(complex(fs2, 0), pole))),
    ).re;
  for (let index = 0; index < degree; index += 1) {
    zeros.push(complex(-1, 0));
  }
  return { zeros, poles, gain };
}

function coefficientsFromPrototype(prototype: AnalogPrototype): IirCoefficients {
  const numerator = polynomialFromRoots(prototype.zeros);
  const denominator = polynomialFromRoots(prototype.poles);
  const b = new Float64Array(numerator.length);
  const a = new Float64Array(denominator.length);
  for (let index = 0; index < numerator.length; index += 1) {
    b[index] = (numerator[index] ?? complex(0, 0)).re * prototype.gain;
  }
  for (let index = 0; index < denominator.length; index += 1) {
    a[index] = (denominator[index] ?? complex(0, 0)).re;
  }
  for (let index = 0; index < b.length; index += 1) {
    if (!Number.isFinite(b[index])) {
      throw new RangeError("designIir: design produced a non-finite coefficient (b)");
    }
  }
  for (let index = 0; index < a.length; index += 1) {
    if (!Number.isFinite(a[index])) {
      throw new RangeError("designIir: design produced a non-finite coefficient (a)");
    }
  }
  return { b, a };
}

/** Butterworth IIR design by analog prototype, prewarped bilinear transform. */
export function designButterworth(options: ButterworthOptions): IirCoefficients {
  const order = validateCommon(options);
  const warped = warpedCutoffs(options);
  const transformed = transformPrototype(butterworthPrototype(order), options.band, warped);
  return coefficientsFromPrototype(bilinearTransform(transformed));
}

/** Chebyshev type I IIR design by analog prototype with `rippleDb` passband ripple. */
export function designChebyshev1(options: Chebyshev1Options): IirCoefficients {
  const order = validateCommon(options);
  const rippleDb = options?.rippleDb;
  if (!Number.isFinite(rippleDb) || rippleDb < MIN_RIPPLE_DB || rippleDb > MAX_RIPPLE_DB) {
    throw new RangeError(
      `designChebyshev1: rippleDb must be finite in [${MIN_RIPPLE_DB}, ${MAX_RIPPLE_DB}] (got ${String(rippleDb)})`,
    );
  }
  const warped = warpedCutoffs(options);
  const transformed = transformPrototype(
    chebyshev1Prototype(order, rippleDb),
    options.band,
    warped,
  );
  return coefficientsFromPrototype(bilinearTransform(transformed));
}

/**
 * Apply an IIR filter with transposed direct form II. Coefficients are
 * normalized internally by `a[0]`; the initial state is zero and the output
 * has exactly the input length (including the start-up transient).
 */
export function applyFilter(x: Float64Array, coefficients: IirCoefficients): Float64Array {
  const b = coefficients?.b;
  const a = coefficients?.a;
  if (!(b instanceof Float64Array) || !(a instanceof Float64Array)) {
    throw new TypeError("applyFilter: b and a must be Float64Array values");
  }
  if (b.length === 0 || a.length === 0) {
    throw new RangeError("applyFilter: b and a must not be empty");
  }
  for (let index = 0; index < b.length; index += 1) {
    if (!Number.isFinite(b[index])) {
      throw new TypeError(`applyFilter: b[${index}] must be finite`);
    }
  }
  for (let index = 0; index < a.length; index += 1) {
    if (!Number.isFinite(a[index])) {
      throw new TypeError(`applyFilter: a[${index}] must be finite`);
    }
  }
  const a0 = a[0] ?? 0;
  if (a0 === 0) {
    throw new RangeError("applyFilter: a[0] must be non-zero");
  }
  for (let index = 0; index < x.length; index += 1) {
    if (!Number.isFinite(x[index])) {
      throw new TypeError(`applyFilter: x[${index}] must be finite`);
    }
  }

  const inverseA0 = 1 / a0;
  const normalizedB = new Float64Array(b.length);
  const normalizedA = new Float64Array(a.length);
  for (let index = 0; index < b.length; index += 1) {
    normalizedB[index] = (b[index] ?? 0) * inverseA0;
  }
  for (let index = 0; index < a.length; index += 1) {
    normalizedA[index] = (a[index] ?? 0) * inverseA0;
  }

  const output = new Float64Array(x.length);
  const order = Math.max(normalizedB.length, normalizedA.length);
  const state = new Float64Array(order - 1);
  for (let sample = 0; sample < x.length; sample += 1) {
    const input = x[sample] ?? 0;
    const filtered = (normalizedB[0] ?? 0) * input + (state[0] ?? 0);
    for (let index = 1; index < order; index += 1) {
      const next = index < order - 1 ? (state[index] ?? 0) : 0;
      const numerator = index < normalizedB.length ? (normalizedB[index] ?? 0) : 0;
      const denominator = index < normalizedA.length ? (normalizedA[index] ?? 0) : 0;
      // Add the delayed state before the feedback term: the same rounding
      // order as SciPy's lfilter, so the lfilter golden vectors match closely.
      state[index - 1] = numerator * input + next - denominator * filtered;
    }
    output[sample] = filtered;
  }
  return output;
}
