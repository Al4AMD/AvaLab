import { describe, expect, it } from "vitest";
import { entropyBitsPerSymbol } from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("metrics");

function entropyCase(): GoldenCase {
  const found = golden.cases.find(
    (candidate) => candidate.expected.entropyBitsPerSymbol !== undefined,
  );
  if (found === undefined) {
    throw new Error("fixture is missing the entropy case");
  }
  return found;
}

function expectClose(
  actual: number,
  expected: number,
  tolerance: { rtol: number; atol: number },
): void {
  const difference = Math.abs(actual - expected);
  const allowed = tolerance.atol + tolerance.rtol * Math.abs(expected);
  expect(
    difference,
    `|${actual} - ${expected}| = ${difference} exceeds ${allowed}`,
  ).toBeLessThanOrEqual(allowed);
}

describe("entropyBitsPerSymbol (golden)", () => {
  it("matches the skewed-histogram golden case", () => {
    const goldenCase = entropyCase();
    const symbols = Int32Array.from(asNumberArray(goldenCase.input.samples, "input.samples"));
    const expected = asNumber(
      goldenCase.expected.entropyBitsPerSymbol,
      "expected.entropyBitsPerSymbol",
    );
    expectClose(entropyBitsPerSymbol(symbols), expected, goldenCase.tolerance);
  });

  it("pins the same skewed histogram through Uint8Array", () => {
    const symbols = Uint8Array.from(asNumberArray(entropyCase().input.samples, "input.samples"));
    expect(entropyBitsPerSymbol(symbols)).toBeCloseTo(1.610577243331642, 12);
  });
});

describe("entropyBitsPerSymbol edge cases", () => {
  it("returns 0 for empty input", () => {
    expect(entropyBitsPerSymbol(new Uint8Array(0))).toBe(0);
    expect(entropyBitsPerSymbol(new Int32Array(0))).toBe(0);
  });

  it("returns 0 for a single distinct symbol", () => {
    expect(entropyBitsPerSymbol(Uint8Array.from([7, 7, 7, 7]))).toBe(0);
    expect(entropyBitsPerSymbol(Int32Array.from([-3, -3, -3]))).toBe(0);
  });

  it("returns 1 bit for two equiprobable symbols", () => {
    expect(entropyBitsPerSymbol(Uint8Array.from([0, 1, 0, 1]))).toBe(1);
  });

  it("returns 2 bits for four equiprobable symbols", () => {
    expect(entropyBitsPerSymbol(Uint8Array.from([0, 1, 2, 3]))).toBe(2);
  });

  it("counts negative Int32 symbols as distinct", () => {
    expect(entropyBitsPerSymbol(Int32Array.from([-1, -1, 2, 2]))).toBe(1);
    expect(entropyBitsPerSymbol(Int32Array.from([-1, 2]))).toBe(1);
  });

  it("does not mutate the input", () => {
    const symbols = Int32Array.from([-1, 2, -1, 2]);
    entropyBitsPerSymbol(symbols);
    expect(Array.from(symbols)).toEqual([-1, 2, -1, 2]);
  });
});
