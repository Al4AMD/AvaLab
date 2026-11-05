import { describe, expect, it } from "vitest";
import { barkBandEdgesHz, barkBandIndexOf, barkToHz, hzToBark } from "../../src/index.js";
import { asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("psychoacoustics");

function edgesCase(name: string): GoldenCase {
  const goldenCase = golden.cases.find((candidate) => candidate.name === name);
  if (goldenCase === undefined) {
    throw new Error(`missing golden case ${name}`);
  }
  return goldenCase;
}

function expectClose(actual: number, expected: number, label: string): void {
  const tolerance = { rtol: 1e-9, atol: 1e-12 };
  const difference = Math.abs(actual - expected);
  const allowed = tolerance.atol + tolerance.rtol * Math.abs(expected);
  expect(difference, `${label}: |${actual} - ${expected}| > ${allowed}`).toBeLessThanOrEqual(
    allowed,
  );
}

describe("bark edges golden", () => {
  for (const name of ["bark_edges_48k", "bark_edges_8k"]) {
    it(`matches ${name}`, () => {
      const goldenCase = edgesCase(name);
      const sampleRateHz = goldenCase.input.sample_rate_hz ?? 0;
      const expected = asNumberArray(goldenCase.expected.edges_hz, "edges_hz");
      const actual = barkBandEdgesHz(sampleRateHz);
      expect(actual.length).toBe(expected.length);
      expected.forEach((value, index) => {
        expectClose(actual[index] ?? Number.NaN, value, `${name}[${index}]`);
      });
    });
  }

  it("clamps the 8 kHz grid at 4 kHz and keeps 26 edges", () => {
    const edges = barkBandEdgesHz(8000);
    expect(edges.length).toBe(26);
    expect(edges[0]).toBe(0);
    expect(edges[25]).toBe(4000);
    expect(edges[24]).toBe(4000);
  });
});

describe("Bark conversion properties", () => {
  it("is monotonic and round-trips below Nyquist", () => {
    const sampleRateHz = 48000;
    let previous = -1;
    for (const hz of [20, 100, 1000, 4000, 10000, 20000, 23999]) {
      const bark = hzToBark(hz);
      expect(bark).toBeGreaterThan(previous);
      previous = bark;
      const back = barkToHz(bark, sampleRateHz);
      expect(Math.abs(back - hz)).toBeLessThanOrEqual(1e-6);
    }
  });

  it("returns the last band above 25 Bark", () => {
    expect(barkBandIndexOf(100000)).toBe(24);
    expect(barkBandIndexOf(0)).toBe(0);
  });

  it("throws typed errors for invalid inputs", () => {
    expect(() => hzToBark(-1)).toThrow(RangeError);
    expect(() => hzToBark(Number.NaN)).toThrow(RangeError);
    expect(() => barkToHz(Number.POSITIVE_INFINITY, 48000)).toThrow(RangeError);
    expect(() => barkToHz(1, 0)).toThrow(RangeError);
    expect(() => barkBandEdgesHz(48000, 0)).toThrow(RangeError);
  });
});
