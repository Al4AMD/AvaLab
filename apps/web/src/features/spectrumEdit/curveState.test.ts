import { describe, expect, it } from "vitest";

import {
  addCurvePoint,
  CURVE_URL_CHAR_LIMIT,
  decodeCurves,
  encodeCurves,
  moveCurvePoint,
  undoCurvePoint,
  validSpectrumCurve,
} from "./curveState";

describe("curve URL codec", () => {
  it("round-trips curves under cv", () => {
    const curves = [
      {
        target: "mag" as const,
        points: [
          { bin: 0, value: 0.2 },
          { bin: 8, value: 1 },
        ],
      },
      {
        target: "phase" as const,
        points: [
          { bin: 2, value: -1 },
          { bin: 9, value: 1 },
        ],
      },
    ];
    const encoded = encodeCurves(curves);
    expect(encoded).not.toBeNull();
    expect(decodeCurves(encoded ?? undefined)).toEqual(curves);
  });

  it("falls back to no curves for bad or oversized input", () => {
    expect(decodeCurves(undefined)).toEqual([]);
    expect(decodeCurves("not-json")).toEqual([]);
    expect(decodeCurves("{}")).toEqual([]);
    expect(decodeCurves("x".repeat(CURVE_URL_CHAR_LIMIT + 1))).toEqual([]);
  });

  it("drops invalid curves individually", () => {
    const raw = JSON.stringify([
      {
        target: "bogus",
        points: [
          { bin: 0, value: 1 },
          { bin: 2, value: 1 },
        ],
      },
      { target: "mag", points: [{ bin: 0, value: 1 }] },
      {
        target: "mag",
        points: [
          { bin: 0, value: 1 },
          { bin: 2, value: Infinity },
        ],
      },
      {
        target: "mag",
        points: [
          { bin: 0, value: 1 },
          { bin: 2, value: 2 },
        ],
      },
    ]);
    expect(decodeCurves(raw, 4)).toEqual([
      {
        target: "mag",
        points: [
          { bin: 0, value: 1 },
          { bin: 2, value: 2 },
        ],
      },
    ]);
  });

  it("rejects bins beyond the analysis spectrum", () => {
    const raw = JSON.stringify([
      {
        target: "mag",
        points: [
          { bin: 0, value: 1 },
          { bin: 9, value: 2 },
        ],
      },
    ]);
    expect(decodeCurves(raw, 8)).toEqual([]);
  });
});

describe("curve point helpers", () => {
  it("adds sorted, replaces duplicate bins and caps the list", () => {
    const points = addCurvePoint([], { bin: 5, value: 1 });
    expect(points).toEqual([{ bin: 5, value: 1 }]);
    expect(addCurvePoint(points, { bin: 2, value: 3 })).toEqual([
      { bin: 2, value: 3 },
      { bin: 5, value: 1 },
    ]);
    expect(addCurvePoint(points, { bin: 5, value: 9 })).toEqual([{ bin: 5, value: 9 }]);
  });

  it("moves and undoes points", () => {
    const points = [
      { bin: 1, value: 1 },
      { bin: 4, value: 2 },
    ];
    expect(moveCurvePoint(points, 1, { bin: 0, value: 2 })).toEqual([
      { bin: 0, value: 2 },
      { bin: 1, value: 1 },
    ]);
    expect(undoCurvePoint(points)).toEqual([{ bin: 1, value: 1 }]);
  });

  it("validates a whole curve", () => {
    expect(
      validSpectrumCurve({
        target: "re",
        points: [
          { bin: 0, value: 0 },
          { bin: 1, value: 0 },
        ],
      }),
    ).toBe(true);
    expect(validSpectrumCurve({ target: "re", points: [{ bin: 0, value: 0 }] })).toBe(false);
  });
});
