/**
 * Purpose: F09 freehand spectrum curves. A curve is a sorted list of
 * bin/value points; values are linearly interpolated between points and held
 * constant before the first and after the last point. Curves run AFTER the
 * legacy band edits so the student's drawn shape wins.
 *
 * Formula: for bin k between points (b_i, v_i) and (b_{i+1}, v_{i+1}),
 *   v(k) = v_i + (v_{i+1} - v_i) * (k - b_i) / (b_{i+1} - b_i).
 * Transformations per target:
 *   re / im: set that component;
 *   mag:     m' = max(v, 0), keep phi, re' = m' cos(phi), im' = m' sin(phi);
 *   phase:   phi' = wrap(v, [-pi, pi]), keep m.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * sections 8.1-8.4 (polar form and DFT edits).
 *
 * Complexity: O(C * P + C * K) for C curves, P points per curve and K covered
 * bins; the implementation walks each curve once and fills only its range.
 *
 * Edge cases: more than 8 curves, fewer than 2 or more than 256 points in a
 * curve, unknown target, non-integer/out-of-range bin, non-finite value or a
 * spectrum/binCount mismatch -> RangeError; duplicate bins keep the last
 * value; inputs are never mutated (points are copied for sorting).
 */

export type SpectrumCurveTarget = "re" | "im" | "mag" | "phase";

export interface SpectrumCurvePoint {
  readonly bin: number;
  readonly value: number;
}

export interface SpectrumCurveEdit {
  readonly target: SpectrumCurveTarget;
  readonly points: readonly SpectrumCurvePoint[];
}

const TARGETS: readonly SpectrumCurveTarget[] = ["re", "im", "mag", "phase"];
const MAX_CURVES = 8;
const MAX_POINTS = 256;
const MIN_POINTS = 2;
const TAU = 2 * Math.PI;

function wrapAngle(angle: number): number {
  const wrapped = ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return wrapped === -Math.PI && angle > 0 ? Math.PI : wrapped;
}

function sortedPoints(
  curve: SpectrumCurveEdit,
  curveIndex: number,
  binCount: number,
): readonly SpectrumCurvePoint[] {
  if (curve === null || typeof curve !== "object") {
    throw new RangeError(`applySpectrumCurves: curves[${curveIndex}] must be an object`);
  }
  if (!TARGETS.includes(curve.target)) {
    throw new RangeError(
      `applySpectrumCurves: curves[${curveIndex}].target is unknown (${String(curve.target)})`,
    );
  }
  if (!Array.isArray(curve.points)) {
    throw new RangeError(`applySpectrumCurves: curves[${curveIndex}].points must be an array`);
  }
  if (curve.points.length < MIN_POINTS || curve.points.length > MAX_POINTS) {
    throw new RangeError(
      `applySpectrumCurves: curves[${curveIndex}] must have ${MIN_POINTS}..${MAX_POINTS} points (got ${curve.points.length})`,
    );
  }
  const points: SpectrumCurvePoint[] = [];
  for (let index = 0; index < curve.points.length; index += 1) {
    const point = curve.points[index];
    if (point === undefined || point === null || typeof point !== "object") {
      throw new RangeError(
        `applySpectrumCurves: curves[${curveIndex}].points[${index}] must be an object`,
      );
    }
    if (!Number.isInteger(point.bin) || point.bin < 0 || point.bin >= binCount) {
      throw new RangeError(
        `applySpectrumCurves: curves[${curveIndex}].points[${index}].bin must be in [0, ${binCount}) (got ${String(point.bin)})`,
      );
    }
    if (!Number.isFinite(point.value)) {
      throw new RangeError(
        `applySpectrumCurves: curves[${curveIndex}].points[${index}].value must be finite (got ${String(point.value)})`,
      );
    }
    points.push({ bin: point.bin, value: point.value });
  }
  points.sort((left, right) => left.bin - right.bin);
  // Duplicate bins keep the LAST value in the caller's order.
  const deduped: SpectrumCurvePoint[] = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (previous !== undefined && previous.bin === point.bin) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }
  if (deduped.length < MIN_POINTS) {
    throw new RangeError(
      `applySpectrumCurves: curves[${curveIndex}] needs at least ${MIN_POINTS} distinct bins`,
    );
  }
  return deduped;
}

function interpolate(points: readonly SpectrumCurvePoint[], bin: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) {
    return 0;
  }
  if (bin <= first.bin) {
    return first.value;
  }
  if (bin >= last.bin) {
    return last.value;
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index];
    const right = points[index + 1];
    if (left === undefined || right === undefined) {
      break;
    }
    if (bin >= left.bin && bin <= right.bin) {
      const span = right.bin - left.bin;
      if (span === 0) {
        return right.value;
      }
      return left.value + ((right.value - left.value) * (bin - left.bin)) / span;
    }
  }
  return last.value;
}

function applyCurve(
  re: Float64Array,
  im: Float64Array,
  curve: SpectrumCurveEdit,
  curveIndex: number,
  binCount: number,
): void {
  const points = sortedPoints(curve, curveIndex, binCount);
  for (let bin = 0; bin < binCount; bin += 1) {
    const value = interpolate(points, bin);
    const reValue = re[bin] ?? 0;
    const imValue = im[bin] ?? 0;
    if (curve.target === "re") {
      re[bin] = value;
    } else if (curve.target === "im") {
      im[bin] = value;
    } else if (curve.target === "mag") {
      const magnitude = Math.max(0, value);
      const phase = Math.atan2(imValue, reValue);
      re[bin] = magnitude * Math.cos(phase);
      im[bin] = magnitude * Math.sin(phase);
    } else {
      const magnitude = Math.hypot(reValue, imValue);
      const phase = wrapAngle(value);
      re[bin] = magnitude * Math.cos(phase);
      im[bin] = magnitude * Math.sin(phase);
    }
  }
}

export function applySpectrumCurves(
  spectrum: { re: Float64Array; im: Float64Array },
  curves: readonly SpectrumCurveEdit[],
  binCount: number,
): void {
  if (spectrum.re.length !== binCount || spectrum.im.length !== binCount) {
    throw new RangeError(
      `applySpectrumCurves: spectrum length ${spectrum.re.length}/${spectrum.im.length} does not match binCount ${binCount}`,
    );
  }
  if (!Array.isArray(curves)) {
    throw new RangeError("applySpectrumCurves: curves must be an array");
  }
  if (curves.length > MAX_CURVES) {
    throw new RangeError(
      `applySpectrumCurves: at most ${MAX_CURVES} curves are allowed (got ${curves.length})`,
    );
  }
  for (let index = 0; index < curves.length; index += 1) {
    const curve = curves[index];
    if (curve === undefined) {
      throw new RangeError(`applySpectrumCurves: curves[${index}] is missing`);
    }
    applyCurve(spectrum.re, spectrum.im, curve, index, binCount);
  }
}
