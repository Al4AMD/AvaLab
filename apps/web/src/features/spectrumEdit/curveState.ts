/**
 * URL/state helpers for F09 freehand curves. Curves ride the URL under `cv`
 * as a capped JSON array; malformed entries are dropped one by one so a
 * hand-edited link never reaches the worker with a bad curve. Band edits keep
 * the legacy `ed` key and still apply before these curves.
 */
import type { SpectrumCurveEdit, SpectrumCurvePoint, SpectrumCurveTarget } from "@avalab/dsp";

export const CURVE_URL_KEY = "cv";
export const CURVE_URL_CHAR_LIMIT = 8192;
export const MAX_CURVES = 8;
export const MAX_CURVE_POINTS = 256;
export const MIN_CURVE_POINTS = 2;
export const SPECTRUM_CURVE_TARGETS = ["re", "im", "mag", "phase"] as const;

export type SpectrumCurveTargetName = (typeof SPECTRUM_CURVE_TARGETS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validCurvePoint(value: unknown, maxBin: number): value is SpectrumCurvePoint {
  return (
    isRecord(value) &&
    Number.isInteger(value.bin) &&
    (value.bin as number) >= 0 &&
    (value.bin as number) <= maxBin &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
  );
}

export function validSpectrumCurve(
  value: unknown,
  maxBin = Number.MAX_SAFE_INTEGER,
): value is SpectrumCurveEdit {
  if (!isRecord(value) || !Array.isArray(value.points)) {
    return false;
  }
  if (
    !(SPECTRUM_CURVE_TARGETS as readonly string[]).includes(value.target as string) ||
    value.points.length < MIN_CURVE_POINTS ||
    value.points.length > MAX_CURVE_POINTS
  ) {
    return false;
  }
  const points = value.points.filter((point) => validCurvePoint(point, maxBin));
  return points.length === value.points.length;
}

export function decodeCurves(
  raw: string | undefined,
  maxBin = Number.MAX_SAFE_INTEGER,
): SpectrumCurveEdit[] {
  if (raw === undefined || raw.length > CURVE_URL_CHAR_LIMIT) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter((curve): curve is SpectrumCurveEdit => validSpectrumCurve(curve, maxBin))
    .slice(0, MAX_CURVES)
    .map((curve) => ({
      target: curve.target,
      points: curve.points.map((point) => ({ bin: point.bin, value: point.value })),
    }));
}

export function encodeCurves(curves: readonly SpectrumCurveEdit[]): string | null {
  if (curves.length === 0) {
    return null;
  }
  return JSON.stringify(curves);
}

/** Adds or replaces the point at `bin`, keeping the list sorted and capped. */
export function addCurvePoint(
  points: readonly SpectrumCurvePoint[],
  point: SpectrumCurvePoint,
): SpectrumCurvePoint[] {
  const next = points.filter((entry) => entry.bin !== point.bin);
  next.push({ bin: point.bin, value: point.value });
  next.sort((left, right) => left.bin - right.bin);
  return next.slice(-MAX_CURVE_POINTS);
}

export function moveCurvePoint(
  points: readonly SpectrumCurvePoint[],
  index: number,
  point: SpectrumCurvePoint,
): SpectrumCurvePoint[] {
  if (index < 0 || index >= points.length) {
    return [...points];
  }
  const next = points.map((entry, entryIndex) => (entryIndex === index ? point : entry));
  next.sort((left, right) => left.bin - right.bin);
  return next;
}

export function undoCurvePoint(points: readonly SpectrumCurvePoint[]): SpectrumCurvePoint[] {
  return points.slice(0, -1);
}

export function isCurveTarget(value: unknown): value is SpectrumCurveTarget {
  return (SPECTRUM_CURVE_TARGETS as readonly string[]).includes(value as string);
}
