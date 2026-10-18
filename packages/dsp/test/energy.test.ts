import { describe, expect, it } from "vitest";
import { averagePowerOf, energyOf } from "../src/index.js";
import { type GoldenCase, loadGolden } from "./fixtures.js";

const golden = loadGolden("energy");

function expectedValue(expected: Record<string, number>, key: string): number {
  const value = expected[key];
  if (value === undefined) {
    throw new Error(`fixture is missing expected["${key}"]`);
  }
  return value;
}

function goldenCaseNamed(name: string): GoldenCase {
  const found = golden.cases.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`fixture is missing case "${name}"`);
  }
  return found;
}

describe("loadGolden", () => {
  it("throws with the file path when the fixture is missing", () => {
    expect(() => loadGolden("no-such-algorithm")).toThrow(/no-such-algorithm\.json/);
  });
});

describe("energyOf", () => {
  it("loads the committed energy fixture", () => {
    expect(golden.algorithm).toBe("energy");
    expect(golden.cases.length).toBeGreaterThan(0);
  });

  it.each(golden.cases)("matches golden case $name", (goldenCase: GoldenCase) => {
    const samples = Float64Array.from(goldenCase.input.samples);
    const reference = expectedValue(goldenCase.expected, "energy");
    const actual = energyOf(samples);
    const allowed = goldenCase.tolerance.atol + goldenCase.tolerance.rtol * Math.abs(reference);
    expect(Math.abs(actual - reference)).toBeLessThanOrEqual(allowed);
  });

  it("returns 0 for empty input", () => {
    expect(energyOf(new Float64Array(0))).toBe(0);
    expect(energyOf(new Float32Array(0))).toBe(0);
  });

  it("returns 0 for a silent signal", () => {
    expect(energyOf(new Float64Array(1000))).toBe(0);
  });

  it("computes Float32 input within 1e-5 relative error of the golden value", () => {
    const sine = goldenCaseNamed("sine_440hz_1s_48000");
    const reference = expectedValue(sine.expected, "energy");
    const actual = energyOf(Float32Array.from(sine.input.samples));
    expect(Math.abs(actual - reference) / Math.abs(reference)).toBeLessThan(1e-5);
  });

  it("throws TypeError when a sample is NaN", () => {
    expect(() => energyOf(Float64Array.from([0, Number.NaN, 1]))).toThrow(TypeError);
  });

  it("throws TypeError when a sample is infinite", () => {
    expect(() => energyOf(Float64Array.from([0, Number.POSITIVE_INFINITY]))).toThrow(TypeError);
  });
});

describe("averagePowerOf", () => {
  it("is energy / N for the golden sine (0.5)", () => {
    const sine = goldenCaseNamed("sine_440hz_1s_48000");
    expect(averagePowerOf(Float64Array.from(sine.input.samples))).toBeCloseTo(0.5, 12);
  });

  it("returns 0 for empty input (documented N = 0 convention)", () => {
    expect(averagePowerOf(new Float64Array(0))).toBe(0);
  });

  it("returns 0 for a silent signal", () => {
    expect(averagePowerOf(new Float64Array(1000))).toBe(0);
  });
});
