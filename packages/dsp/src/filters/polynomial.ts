/**
 * Purpose: internal polynomial-root helper for the IIR design stability guard.
 * The coefficient form `{b, a}` has no retention of the analog poles, so a
 * numerically fragile high-order design can only be identified by finding the
 * roots of the realized denominator polynomial.
 *
 * Formula: Durand-Kerner (Weierstrass) simultaneous iteration for
 * `p(z) = c_0 z^N + c_1 z^{N-1} + ... + c_N`,
 *   z_i <- z_i - p(z_i) / prod_{j != i} (z_i - z_j),
 * starting from the fixed points `z_i = R*exp(j*(2*pi*i/N + 0.1))` with
 * `R = options.initialRadius` (default 0.5; deterministic: no random numbers,
 * so repeated calls return the same roots). The unit circle is the natural
 * scale for filter poles and zeros; a smaller radius makes the Weierstrass
 * denominators collide for higher-degree polynomials such as the 30th-degree
 * FIR zeros in F11, which is why `polesZeros` requests R = 1 above degree 16.
 *
 * Convergence criterion: after normalization by the leading coefficient
 * (`c_0 = 1`), a result is accepted when either
 *   - the largest per-root step of the last iteration is < 1e-12, or
 *   - the relative polynomial residual is small:
 *       max_k |p(z_k)| / max(1, |z_k|)^N <= 1e-10.
 * The second test is what clustered high-degree roots need: roundoff makes
 * the step stall near 1e-11 while the roots are still accurate to ~1e-15.
 * Non-convergence is reported only when both tests fail.
 *
 * Reference: Durand, "Solutions numeriques des equations algebriques" (1960);
 * Kerner, "Ein Gesamtschrittverfahren zur Berechnung der Nullstellen von
 * Polynomen", Numerische Mathematik 8 (1966).
 *
 * Complexity: O(N^2) per iteration, at most `MAX_ITERATIONS` iterations,
 * O(N) space. Used by the IIR design guard (N <= 16) and by `polesZeros`
 * for FIR zero sets up to degree 30.
 *
 * Edge cases: an empty or constant polynomial has no roots and reports
 * `converged: true`; non-finite coefficients, a zero leading coefficient, a
 * zero Weierstrass denominator, non-finite roots, or a non-positive/non-finite
 * `initialRadius` report `converged: false` instead of throwing. The caller
 * decides how to surface that failure.
 */

export interface PolynomialRoot {
  re: number;
  im: number;
}

export interface PolynomialRootsResult {
  roots: PolynomialRoot[];
  converged: boolean;
}

export interface PolynomialRootsOptions {
  /**
   * Radius of the deterministic initial root circle. Default 0.5 (the value
   * used by the IIR design guard). Higher-degree polynomials with roots near
   * the unit circle can start at 1 instead.
   */
  initialRadius?: number;
}

const MAX_ITERATIONS = 2000;
/** Largest per-root update accepted as a converged step. */
const STEP_TOLERANCE = 1e-12;
/**
 * Relative residual bound: max |p(z_k)| / max(1, |z_k|)^N after normalizing
 * the polynomial to a monic one.
 */
const RESIDUAL_TOLERANCE = 1e-10;
const INITIAL_RADIUS = 0.5;
const INITIAL_ANGLE_OFFSET = 0.1;

function multiplyRoots(left: PolynomialRoot, right: PolynomialRoot): PolynomialRoot {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re,
  };
}

/** Horner evaluation of a real-coefficient polynomial at a complex point. */
function evaluatePolynomial(coefficients: readonly number[], root: PolynomialRoot): PolynomialRoot {
  let value: PolynomialRoot = { re: coefficients[0] ?? 0, im: 0 };
  for (let index = 1; index < coefficients.length; index += 1) {
    value = multiplyRoots(value, root);
    value = { re: value.re + (coefficients[index] ?? 0), im: value.im };
  }
  return value;
}

/**
 * Monic relative residual `max |p(z_k)| / max(1, |z_k|)^N`. Scaling by the
 * modulus of the evaluation point keeps the test meaningful for roots outside
 * the unit circle instead of exploding with `|z|^N`.
 */
function relativeResidual(
  coefficients: readonly number[],
  roots: readonly PolynomialRoot[],
): number {
  const degree = coefficients.length - 1;
  let worst = 0;
  for (const root of roots) {
    const value = evaluatePolynomial(coefficients, root);
    const scale = Math.max(1, Math.hypot(root.re, root.im)) ** degree;
    const residual = Math.hypot(value.re, value.im) / scale;
    if (!Number.isFinite(residual)) {
      return Number.POSITIVE_INFINITY;
    }
    worst = Math.max(worst, residual);
  }
  return worst;
}

export function polynomialRoots(
  coefficients: readonly number[],
  options: PolynomialRootsOptions = {},
): PolynomialRootsResult {
  const degree = coefficients.length - 1;
  if (degree <= 0) {
    return { roots: [], converged: true };
  }

  const leading = coefficients[0] ?? 0;
  if (!Number.isFinite(leading) || leading === 0) {
    return { roots: [], converged: false };
  }
  for (let index = 1; index < coefficients.length; index += 1) {
    if (!Number.isFinite(coefficients[index])) {
      return { roots: [], converged: false };
    }
  }

  const initialRadius = options.initialRadius ?? INITIAL_RADIUS;
  if (!Number.isFinite(initialRadius) || initialRadius <= 0) {
    return { roots: [], converged: false };
  }
  const normalized = coefficients.map((coefficient) => coefficient / leading);
  let roots: PolynomialRoot[] = Array.from({ length: degree }, (_, index) => {
    const angle = (2 * Math.PI * index) / degree + INITIAL_ANGLE_OFFSET;
    return { re: initialRadius * Math.cos(angle), im: initialRadius * Math.sin(angle) };
  });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let largestStep = 0;
    const next: PolynomialRoot[] = new Array<PolynomialRoot>(degree);
    for (let index = 0; index < degree; index += 1) {
      const root = roots[index] ?? { re: 0, im: 0 };
      let denominator: PolynomialRoot = { re: 1, im: 0 };
      for (let other = 0; other < degree; other += 1) {
        if (other === index) {
          continue;
        }
        const target = roots[other] ?? { re: 0, im: 0 };
        denominator = multiplyRoots(denominator, {
          re: root.re - target.re,
          im: root.im - target.im,
        });
      }
      const denominatorSquared = denominator.re * denominator.re + denominator.im * denominator.im;
      if (!Number.isFinite(denominatorSquared) || denominatorSquared === 0) {
        return { roots, converged: false };
      }
      const value = evaluatePolynomial(normalized, root);
      const step = {
        re: (value.re * denominator.re + value.im * denominator.im) / denominatorSquared,
        im: (value.im * denominator.re - value.re * denominator.im) / denominatorSquared,
      };
      next[index] = { re: root.re - step.re, im: root.im - step.im };
      largestStep = Math.max(largestStep, Math.hypot(step.re, step.im));
    }

    roots = next;
    for (const root of roots) {
      if (!Number.isFinite(root.re) || !Number.isFinite(root.im)) {
        return { roots, converged: false };
      }
    }
    if (largestStep < STEP_TOLERANCE) {
      return { roots, converged: true };
    }
  }

  return {
    roots,
    converged: relativeResidual(normalized, roots) <= RESIDUAL_TOLERANCE,
  };
}
