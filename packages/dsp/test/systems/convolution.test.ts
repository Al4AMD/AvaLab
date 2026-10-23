import { describe, expect, it } from "vitest";
import { convolveDirect } from "../../src/index.js";
import { asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("convolution_direct");

function kernelOf(goldenCase: GoldenCase): Float64Array {
  return Float64Array.from(asNumberArray(goldenCase.params.h, "params.h"));
}

function expectSamplesClose(
  actual: Float64Array,
  expected: Float64Array,
  tolerance = 1e-12,
  label = "samples",
): void {
  expect(actual.length, `${label} length`).toBe(expected.length);
  for (let n = 0; n < expected.length; n += 1) {
    const actualValue = actual[n] ?? Number.NaN;
    const expectedValue = expected[n] ?? Number.NaN;
    const difference = Math.abs(actualValue - expectedValue);
    const allowed = tolerance * Math.max(1, Math.abs(expectedValue));
    expect(
      difference,
      `${label}[${n}]: |${actualValue} - ${expectedValue}| = ${difference} exceeds ${allowed}`,
    ).toBeLessThanOrEqual(allowed);
  }
}

// Zero-pad at the front, i.e. delay by `delaySamples` (delta * signal).
function delayed(samples: Float64Array, delaySamples: number): Float64Array {
  const output = new Float64Array(samples.length + delaySamples);
  output.set(samples, delaySamples);
  return output;
}

describe("convolution_direct fixture", () => {
  it("loads the committed golden fixture with the pinned cases", () => {
    expect(golden.algorithm).toBe("convolution_direct");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "impulse_conv_arbitrary_kernel",
      "ramp32_conv_decaying_exponential5",
      "known_3x3",
      "hundred_conv_scalar",
    ]);
  });

  it("pins rtol = 1e-12", () => {
    for (const goldenCase of golden.cases) {
      expect(goldenCase.tolerance.rtol).toBe(1e-12);
    }
  });

  it.each(golden.cases)("matches golden case $name", (goldenCase: GoldenCase) => {
    const actual = convolveDirect(
      Float64Array.from(goldenCase.input.samples),
      kernelOf(goldenCase),
    );
    expectSamplesClose(
      actual,
      Float64Array.from(asNumberArray(goldenCase.expected.samples, "expected.samples")),
      goldenCase.tolerance.rtol,
      goldenCase.name,
    );
  });
});

describe("convolveDirect", () => {
  it("returns a Float64Array of length N + M - 1", () => {
    expect(convolveDirect(new Float64Array(1), new Float64Array(1))).toHaveLength(1);
    expect(convolveDirect(new Float64Array(4), new Float64Array(3))).toHaveLength(6);
    expect(convolveDirect(new Float64Array(1), new Float64Array(7))).toHaveLength(7);
    expect(convolveDirect(new Float64Array(100), new Float64Array(1))).toHaveLength(100);
  });

  it("convolves the pinned 3x3 known values to [4, 13, 28, 27, 18]", () => {
    const actual = convolveDirect(Float64Array.from([1, 2, 3]), Float64Array.from([4, 5, 6]));
    expect(Array.from(actual)).toEqual([4, 13, 28, 27, 18]);
  });

  it("is commutative within 1e-12", () => {
    const a = Float64Array.from([1.5, -2.25, 0.75, 3, -1, 0.125, 4, -0.5]);
    const b = Float64Array.from([0.3, -1.1, 2.7, 0.9, -0.4]);
    expectSamplesClose(convolveDirect(a, b), convolveDirect(b, a), 1e-12, "commutativity");
  });

  it("is associative with a third signal", () => {
    const a = Float64Array.from([1, -2, 0.5, 3]);
    const b = Float64Array.from([0.25, 2, -1]);
    const c = Float64Array.from([1.5, 0, -0.75, 2, 0.5]);
    const left = convolveDirect(convolveDirect(a, b), c);
    const right = convolveDirect(a, convolveDirect(b, c));
    expectSamplesClose(left, right, 1e-12, "associativity");
  });

  it("treats the unit impulse as the identity kernel", () => {
    const signal = Float64Array.from([3, -1.5, 0, 2.25, -4]);
    expectSamplesClose(convolveDirect(signal, Float64Array.from([1])), signal, 0, "right identity");
    expectSamplesClose(convolveDirect(Float64Array.from([1]), signal), signal, 0, "left identity");
  });

  it("shifts a delayed signal's convolution by the same delay", () => {
    const signal = Float64Array.from([1, 2, 3]);
    const kernel = Float64Array.from([0.5, -1]);
    const base = convolveDirect(signal, kernel);

    expectSamplesClose(
      convolveDirect(delayed(signal, 2), kernel),
      delayed(base, 2),
      0,
      "delayed signal",
    );
    expectSamplesClose(
      convolveDirect(signal, delayed(kernel, 1)),
      delayed(base, 1),
      0,
      "delayed kernel",
    );
  });

  it("does not mutate either input", () => {
    const x = Float64Array.from([1, -2, 3]);
    const h = Float64Array.from([0.5, 4]);
    const xBefore = Array.from(x);
    const hBefore = Array.from(h);
    convolveDirect(x, h);
    expect(Array.from(x)).toEqual(xBefore);
    expect(Array.from(h)).toEqual(hBefore);
  });

  it("throws RangeError when either input is empty", () => {
    expect(() => convolveDirect(new Float64Array(0), Float64Array.from([1]))).toThrow(RangeError);
    expect(() => convolveDirect(Float64Array.from([1]), new Float64Array(0))).toThrow(RangeError);
    expect(() => convolveDirect(new Float64Array(0), new Float64Array(0))).toThrow(RangeError);
  });

  it("throws TypeError on non-finite samples in either input", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => convolveDirect(Float64Array.from([1, bad]), Float64Array.from([1]))).toThrow(
        TypeError,
      );
      expect(() => convolveDirect(Float64Array.from([1]), Float64Array.from([bad]))).toThrow(
        TypeError,
      );
    }
  });
});
