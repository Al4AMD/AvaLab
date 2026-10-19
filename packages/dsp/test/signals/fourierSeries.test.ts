import { describe, expect, it } from "vitest";
import {
  type FourierSeriesKind,
  type FourierSeriesSpec,
  fourierSeriesPartialSum,
  generateSquare,
  generateTriangle,
  measureGibbsOvershoot,
  type SignalSpec,
} from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("fourier_series");

function valueAt(values: Float64Array, index: number, label = "values"): number {
  const value: number | undefined = values[index];
  if (value === undefined) {
    throw new Error(`${label}[${index}] read out of bounds`);
  }
  return value;
}

function expectClose(
  actual: number,
  expected: number,
  tolerance: { rtol: number; atol: number },
  label: string,
): void {
  const difference = Math.abs(actual - expected);
  const allowed = tolerance.atol + tolerance.rtol * Math.abs(expected);
  expect(
    difference,
    `${label}: |${actual} - ${expected}| = ${difference} exceeds ${allowed}`,
  ).toBeLessThanOrEqual(allowed);
}

function meanSquaredError(reference: Float64Array, test: Float64Array): number {
  expect(test.length).toBe(reference.length);
  let sum = 0;
  for (let n = 0; n < reference.length; n += 1) {
    const difference = valueAt(test, n, "test") - valueAt(reference, n, "reference");
    sum += difference * difference;
  }
  return reference.length === 0 ? 0 : sum / reference.length;
}

function paramNumber(goldenCase: GoldenCase, key: string): number {
  return asNumber(goldenCase.params[key], `params.${key} of ${goldenCase.name}`);
}

function paramKind(goldenCase: GoldenCase): FourierSeriesKind {
  const value = goldenCase.params.kind;
  if (value === "square" || value === "sawtooth" || value === "triangle") {
    return value;
  }
  throw new Error(`golden kind is not a Fourier-series kind: ${String(value)}`);
}

function specOf(goldenCase: GoldenCase): FourierSeriesSpec {
  return {
    kind: paramKind(goldenCase),
    durationSeconds: paramNumber(goldenCase, "durationSeconds"),
    sampleRateHz: paramNumber(goldenCase, "sampleRateHz"),
    frequencyHz: paramNumber(goldenCase, "frequencyHz"),
    harmonics: paramNumber(goldenCase, "harmonics"),
    amplitude: paramNumber(goldenCase, "amplitude"),
  };
}

describe("fourier series fixture", () => {
  it("loads the committed fourier_series fixture", () => {
    expect(golden.algorithm).toBe("fourier_series");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "square_50hz_h1_amplitude1",
      "square_50hz_h3_amplitude1",
      "square_50hz_h5_amplitude1",
      "square_50hz_h51_amplitude1",
      "sawtooth_50hz_h10_amplitude1",
      "triangle_50hz_h9_amplitude1",
    ]);
  });
});

describe("fourierSeriesPartialSum (golden)", () => {
  it.each(golden.cases)("matches golden samples for $name", (goldenCase: GoldenCase) => {
    const expected = asNumberArray(goldenCase.expected.samples, "expected.samples");
    const actual = fourierSeriesPartialSum(specOf(goldenCase));

    expect(actual.length).toBe(expected.length);
    expected.forEach((value, n) => {
      expectClose(valueAt(actual, n), value, goldenCase.tolerance, `x[${n}]`);
    });
  });

  it("starts every series at 0 and flips sign with a negative amplitude", () => {
    const base: SignalSpec & {
      frequencyHz: number;
      harmonics: number;
      amplitude: number;
    } = {
      durationSeconds: 0.02,
      sampleRateHz: 1000,
      frequencyHz: 50,
      harmonics: 9,
      amplitude: 1,
    };
    for (const kind of ["square", "sawtooth", "triangle"] as const) {
      const positive = fourierSeriesPartialSum({ ...base, kind });
      const negative = fourierSeriesPartialSum({ ...base, kind, amplitude: -1 });
      expect(Math.abs(valueAt(positive, 0))).toBeLessThan(1e-15);
      for (let n = 0; n < positive.length; n += 1) {
        expectClose(
          valueAt(negative, n),
          -valueAt(positive, n),
          { rtol: 0, atol: 1e-15 },
          `${kind} x[${n}]`,
        );
      }
    }
  });
});

describe("Gibbs phenomenon", () => {
  // 48 kHz resolves the narrow overshoot lobe; the infinite-series limit is
  // 0.1789797..., and this partial sum (h = 51) reaches ~0.1784.
  const gibbsSpec: FourierSeriesSpec = {
    kind: "square",
    durationSeconds: 0.2,
    sampleRateHz: 48000,
    frequencyHz: 50,
    harmonics: 51,
    amplitude: 1,
  };

  it("measures ~8.95 % of the peak-to-peak jump for a 51-harmonic square", () => {
    const square = fourierSeriesPartialSum(gibbsSpec);
    const overshoot = measureGibbsOvershoot(square, gibbsSpec.amplitude);

    // The function returns the overshoot relative to the peak amplitude, so
    // the Gibbs constant appears as ~0.179 here; /2 is the canonical 8.95 %
    // fraction of the peak-to-peak jump (2a) quoted by textbooks.
    expect(overshoot).toBeGreaterThan(0.177);
    expect(overshoot).toBeLessThan(0.181);
    expect(Math.abs(overshoot / 2 - 0.0895)).toBeLessThan(0.001);
  });

  it("converges monotonically to the ideal square as harmonics increase", () => {
    const idealSquare = generateSquare({
      durationSeconds: gibbsSpec.durationSeconds,
      sampleRateHz: gibbsSpec.sampleRateHz,
      frequencyHz: gibbsSpec.frequencyHz,
      amplitude: gibbsSpec.amplitude,
    });

    const harmonicCounts = [1, 3, 5, 51];
    const errors = harmonicCounts.map((harmonics) =>
      meanSquaredError(idealSquare, fourierSeriesPartialSum({ ...gibbsSpec, harmonics })),
    );

    for (let index = 1; index < errors.length; index += 1) {
      const previous = errors[index - 1] ?? Number.NaN;
      const current = errors[index] ?? Number.NaN;
      expect(
        current,
        `MSE at h=${harmonicCounts[index]} should be below h=${harmonicCounts[index - 1]}`,
      ).toBeLessThan(previous);
    }
  });

  it("triangle converges much faster than square (1/k^2 vs 1/k coefficients)", () => {
    const spec: SignalSpec & { frequencyHz: number; amplitude: number } = {
      durationSeconds: 0.02,
      sampleRateHz: 1000,
      frequencyHz: 50,
      amplitude: 1,
    };
    const harmonics = 9;

    const squareMse = meanSquaredError(
      generateSquare(spec),
      fourierSeriesPartialSum({ ...spec, kind: "square", harmonics }),
    );
    const triangleMse = meanSquaredError(
      generateTriangle(spec),
      fourierSeriesPartialSum({ ...spec, kind: "triangle", harmonics }),
    );

    // Measured ratio is ~1.5e-3; the 1/100 bound leaves ample margin and
    // still fails if the triangle used the square's 1/k coefficients.
    expect(triangleMse).toBeLessThan(squareMse / 100);
  });
});

describe("fourier series guards", () => {
  const base: FourierSeriesSpec = {
    kind: "square",
    durationSeconds: 0.01,
    sampleRateHz: 1000,
    frequencyHz: 50,
    harmonics: 3,
    amplitude: 1,
  };

  const invalidCalls: Array<[string, () => Float64Array]> = [
    ["harmonics = 0", () => fourierSeriesPartialSum({ ...base, harmonics: 0 })],
    ["harmonics = -1", () => fourierSeriesPartialSum({ ...base, harmonics: -1 })],
    ["harmonics = 1.5", () => fourierSeriesPartialSum({ ...base, harmonics: 1.5 })],
    ["harmonics = NaN", () => fourierSeriesPartialSum({ ...base, harmonics: Number.NaN })],
    [
      "harmonics = Infinity",
      () => fourierSeriesPartialSum({ ...base, harmonics: Number.POSITIVE_INFINITY }),
    ],
    ["amplitude = NaN", () => fourierSeriesPartialSum({ ...base, amplitude: Number.NaN })],
    [
      "amplitude = Infinity",
      () => fourierSeriesPartialSum({ ...base, amplitude: Number.POSITIVE_INFINITY }),
    ],
    ["frequencyHz = NaN", () => fourierSeriesPartialSum({ ...base, frequencyHz: Number.NaN })],
    [
      "frequencyHz = Infinity",
      () => fourierSeriesPartialSum({ ...base, frequencyHz: Number.POSITIVE_INFINITY }),
    ],
    ["sampleRateHz = 0", () => fourierSeriesPartialSum({ ...base, sampleRateHz: 0 })],
    ["sampleRateHz = NaN", () => fourierSeriesPartialSum({ ...base, sampleRateHz: Number.NaN })],
    ["durationSeconds = -1", () => fourierSeriesPartialSum({ ...base, durationSeconds: -1 })],
    [
      "durationSeconds = Infinity",
      () => fourierSeriesPartialSum({ ...base, durationSeconds: Number.POSITIVE_INFINITY }),
    ],
    [
      "unknown kind",
      () =>
        fourierSeriesPartialSum({
          ...base,
          kind: "pulse" as FourierSeriesKind,
        }),
    ],
  ];

  it.each(invalidCalls)("throws RangeError for %s", (_label, call) => {
    expect(call).toThrow(RangeError);
  });

  it("returns an empty array for zero duration", () => {
    const empty = fourierSeriesPartialSum({ ...base, durationSeconds: 0 });
    expect(empty.length).toBe(0);
  });
});

describe("measureGibbsOvershoot guards", () => {
  const square = fourierSeriesPartialSum({
    kind: "square",
    durationSeconds: 0.02,
    sampleRateHz: 1000,
    frequencyHz: 50,
    harmonics: 51,
    amplitude: 1,
  });

  it("returns 0 for an empty sample array", () => {
    expect(measureGibbsOvershoot(new Float64Array(0), 1)).toBe(0);
  });

  const invalidAmplitudes: Array<[string, number]> = [
    ["amplitude = 0", 0],
    ["amplitude = -1", -1],
    ["amplitude = NaN", Number.NaN],
    ["amplitude = Infinity", Number.POSITIVE_INFINITY],
  ];

  it.each(invalidAmplitudes)("throws RangeError for %s", (_label, amplitude) => {
    expect(() => measureGibbsOvershoot(square, amplitude)).toThrow(RangeError);
  });

  it("throws TypeError for non-finite samples", () => {
    const withNaN = Float64Array.from([0, Number.NaN, 1]);
    const withInfinity = Float64Array.from([0, Number.POSITIVE_INFINITY, 1]);
    expect(() => measureGibbsOvershoot(withNaN, 1)).toThrow(TypeError);
    expect(() => measureGibbsOvershoot(withInfinity, 1)).toThrow(TypeError);
  });

  it("reports max|x|/a - 1 for an arbitrary bounded array", () => {
    expect(measureGibbsOvershoot(Float64Array.from([-0.5, 1.25, 0]), 1)).toBeCloseTo(0.25, 15);
    expect(measureGibbsOvershoot(Float64Array.from([-0.5, 1.25, 0]), 2.5)).toBeCloseTo(-0.5, 15);
  });
});
