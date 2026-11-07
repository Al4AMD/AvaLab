import { describe, expect, it } from "vitest";
import { absoluteThresholdDb, bandAthDb } from "../../src/index.js";
import { asNumberArray, loadGolden } from "../fixtures.js";

const golden = loadGolden("psychoacoustics");

describe("ATH golden", () => {
  it("matches the pinned Terhardt points", () => {
    const goldenCase = golden.cases.find((candidate) => candidate.name === "ath_points");
    if (goldenCase === undefined) {
      throw new Error("missing ath_points");
    }
    const frequencies = asNumberArray(goldenCase.params.frequencies_hz, "frequencies_hz");
    const expected = asNumberArray(goldenCase.expected.ath_db, "ath_db");
    frequencies.forEach((frequency, index) => {
      expect(absoluteThresholdDb(frequency)).toBeCloseTo(expected[index] ?? Number.NaN, 9);
    });
  });

  it("is finite, falls toward 4 kHz, and rises at 20 kHz", () => {
    for (const frequency of [20, 100, 1000, 4000, 10000, 20000]) {
      expect(Number.isFinite(absoluteThresholdDb(frequency))).toBe(true);
    }
    expect(absoluteThresholdDb(4000)).toBeLessThan(absoluteThresholdDb(20));
    expect(absoluteThresholdDb(4000)).toBeLessThan(absoluteThresholdDb(1000));
    expect(absoluteThresholdDb(20000)).toBeGreaterThan(absoluteThresholdDb(4000));
  });

  it("uses the 20 Hz threshold below 20 Hz", () => {
    expect(absoluteThresholdDb(0)).toBe(absoluteThresholdDb(20));
  });

  it("derives band thresholds from geometric centers", () => {
    const edges = Float64Array.from([0, 100, 400, 4000]);
    const thresholds = bandAthDb(edges);
    expect(Array.from(thresholds)).toHaveLength(3);
    expect(thresholds[0]).toBeCloseTo(absoluteThresholdDb(20), 12);
    expect(thresholds[1]).toBeCloseTo(absoluteThresholdDb(200), 12);
    expect(thresholds[2]).toBeCloseTo(absoluteThresholdDb(1264.9110640673518), 12);
  });

  it("throws typed errors for invalid input", () => {
    expect(() => absoluteThresholdDb(-1)).toThrow(RangeError);
    expect(() => absoluteThresholdDb(Number.NaN)).toThrow(RangeError);
    expect(() => bandAthDb(Float64Array.from([0]))).toThrow(RangeError);
  });
});
