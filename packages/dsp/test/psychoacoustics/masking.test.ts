import { describe, expect, it } from "vitest";
import {
  bandLevelsDb,
  hzToBark,
  maskingThresholdDb,
  maskStepForBand,
  signalToMaskRatioDb,
  spreadingDb,
} from "../../src/index.js";
import { asNumber, asNumberArray, loadGolden } from "../fixtures.js";

const golden = loadGolden("psychoacoustics");

function expectClose(actual: number, expected: number, label: string): void {
  const tolerance = { rtol: 1e-9, atol: 1e-11 };
  const difference = Math.abs(actual - expected);
  const allowed = tolerance.atol + tolerance.rtol * Math.abs(expected);
  expect(difference, `${label}: |${actual} - ${expected}| > ${allowed}`).toBeLessThanOrEqual(
    allowed,
  );
}

describe("spreading", () => {
  it("matches golden and is symmetric", () => {
    const goldenCase = golden.cases.find((candidate) => candidate.name === "spreading_points");
    if (goldenCase === undefined) {
      throw new Error("missing spreading_points");
    }
    const deltas = asNumberArray(goldenCase.params.delta_bark, "delta_bark");
    const expected = asNumberArray(goldenCase.expected.spreading_db, "spreading_db");
    deltas.forEach((delta, index) => {
      const actual = spreadingDb(delta);
      expect(actual).toBeCloseTo(expected[index] ?? Number.NaN, 9);
      expect(spreadingDb(-delta)).toBe(actual);
    });
  });
});

describe("band levels, thresholds and SMR golden", () => {
  const goldenCase = golden.cases.find(
    (candidate) => candidate.name === "band_levels_48k_frame512",
  );
  if (goldenCase === undefined) {
    throw new Error("missing band_levels_48k_frame512");
  }

  it("matches band levels and counts", () => {
    const coefficients = Float64Array.from(
      asNumberArray(goldenCase.expected.coefficients, "coefficients"),
    );
    const edges = Float64Array.from(asNumberArray(goldenCase.expected.edges_hz, "edges_hz"));
    const refSplDb = asNumber(goldenCase.params.reference_spl_db, "reference_spl_db");
    const referencePower = asNumber(goldenCase.params.reference_power, "reference_power");
    const expectedLevels = asNumberArray(goldenCase.expected.levels_db, "levels_db");
    const expectedCounts = asNumberArray(goldenCase.expected.bin_counts, "bin_counts");

    const { levelsDb, binCounts } = bandLevelsDb(
      coefficients,
      edges,
      refSplDb,
      referencePower,
      48000,
    );
    expect(Array.from(binCounts)).toEqual(expectedCounts);
    expectedLevels.forEach((value, index) => {
      expectClose(levelsDb[index] ?? Number.NaN, value, `levels[${index}]`);
    });
  });

  it("matches thresholds and SMR", () => {
    const levels = Float64Array.from(asNumberArray(goldenCase.expected.levels_db, "levels_db"));
    const centersHz = Float64Array.from(
      asNumberArray(goldenCase.expected.band_centers_hz, "band_centers_hz"),
    );
    const centersBark = Float64Array.from(centersHz, (hz) => hzToBark(hz));
    const ath = Float64Array.from(asNumberArray(goldenCase.expected.ath_db, "ath_db"));
    const expectedThresholds = asNumberArray(goldenCase.expected.thresholds_db, "thresholds_db");
    const expectedSmr = asNumberArray(goldenCase.expected.smr_db, "smr_db");
    const thresholds = maskingThresholdDb(levels, centersBark, ath);
    const smr = signalToMaskRatioDb(levels, thresholds);
    expectedThresholds.forEach((value, index) => {
      expectClose(thresholds[index] ?? Number.NaN, value, `threshold[${index}]`);
    });
    expectedSmr.forEach((value, index) => {
      expectClose(smr[index] ?? Number.NaN, value, `smr[${index}]`);
    });
  });
});

describe("masking properties", () => {
  it("never sets a threshold below ATH and stays finite for silence", () => {
    const edges = Float64Array.from([0, 100, 400, 4000]);
    const silence = new Float64Array(4);
    const { levelsDb, binCounts } = bandLevelsDb(silence, edges, 94, 1, 8000);
    const centersBark = Float64Array.from([0, 4, 8]);
    const ath = Float64Array.from([80, 10, 20]);
    const thresholds = maskingThresholdDb(levelsDb, centersBark, ath);
    expect(Array.from(binCounts)).toHaveLength(3);
    thresholds.forEach((threshold, index) => {
      expect(Number.isFinite(threshold)).toBe(true);
      expect(threshold).toBeGreaterThanOrEqual(ath[index] ?? Number.NEGATIVE_INFINITY);
    });
    expect(levelsDb[0]).toBe(Number.NEGATIVE_INFINITY);
  });

  it("returns Infinity for an empty band and a finite step otherwise", () => {
    expect(maskStepForBand(60, 94, 1, 0)).toBe(Number.POSITIVE_INFINITY);
    const step = maskStepForBand(60, 94, 1, 4);
    expect(Number.isFinite(step)).toBe(true);
    expect(step).toBeGreaterThan(0);
  });

  it("throws typed errors for invalid vectors", () => {
    expect(() =>
      maskingThresholdDb(new Float64Array(2), new Float64Array(3), new Float64Array(2)),
    ).toThrow(RangeError);
    expect(() => maskStepForBand(60, 94, 1, -1)).toThrow(RangeError);
  });
});
