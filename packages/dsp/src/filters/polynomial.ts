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
 * `R = 0.5` (deterministic: no random numbers, so repeated calls return the
 * same roots).
 *
 * Reference: Durand, "Solutions numeriques des equations algebriques" (1960);
 * Kerner, "Ein Gesamtschrittverfahren zur Berechnung der Nullstellen von
 * Polynomen", Numerische Mathematik 8 (1966).
 *
 * Complexity: O(N^2) per iteration, at most `MAX_ITERATIONS` iterations,
 * O(N) space. Used here with N <= 16.
 *
 * Edge cases: an empty or constant polynomial has no roots and reports
 * `converged: true`; non-finite coefficients, a zero leading coefficient, a
 * zero Weierstrass denominator, or non-finite roots report `converged: false`
 * instead of throwing. The caller decides how to surface that failure.
 */

export interface PolynomialRoot {
  re: number;
  im: number;
}

export interface PolynomialRootsResult {
  roots: PolynomialRoot[];
  converged: boolean;
}

const MAX_ITERATIONS = 2000;
/**
 * Absolute step bound. Roundoff in clustered high-degree roots stalls the
 * iteration around 1e-11 while the polynomial residual is still ~1e-15, so a
 * tighter bound would reject accurate roots as non-converged.
 */
const STEP_TOLERANCE = 1e-10;
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

export function polynomialRoots(coefficients: readonly number[]): PolynomialRootsResult {
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

  const normalized = coefficients.map((coefficient) => coefficient / leading);
  let roots: PolynomialRoot[] = Array.from({ length: degree }, (_, index) => {
    const angle = (2 * Math.PI * index) / degree + INITIAL_ANGLE_OFFSET;
    return { re: INITIAL_RADIUS * Math.cos(angle), im: INITIAL_RADIUS * Math.sin(angle) };
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
    if (largestStep <= STEP_TOLERANCE) {
      return { roots, converged: true };
    }
  }

  return { roots, converged: false };
}
