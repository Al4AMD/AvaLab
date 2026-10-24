import { describe, expect, it } from "vitest";
import type {
  ButterworthOptions,
  Chebyshev1Options,
  IirBand,
  IirCoefficients,
} from "../../src/index.js";
import { applyFilter, designButterworth, designChebyshev1 } from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("iir");
const SAMPLE_RATE_HZ = 48000;

const iirCases = golden.cases.filter((goldenCase) => {
  const design = goldenCase.params.design;
  return design === "butterworth" || design === "chebyshev1";
});

interface ComplexNumber {
  re: number;
  im: number;
}

function addComplex(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  return { re: left.re + right.re, im: left.im + right.im };
}

function subtractComplex(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  return { re: left.re - right.re, im: left.im - right.im };
}

function multiplyComplex(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re,
  };
}

function divideComplex(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  const denominator = right.re * right.re + right.im * right.im;
  return {
    re: (left.re * right.re + left.im * right.im) / denominator,
    im: (left.im * right.re - left.re * right.im) / denominator,
  };
}

function polynomialValue(coefficients: readonly number[], value: ComplexNumber): ComplexNumber {
  let result: ComplexNumber = { re: coefficients[0] ?? 0, im: 0 };
  for (let index = 1; index < coefficients.length; index += 1) {
    result = addComplex(multiplyComplex(result, value), {
      re: coefficients[index] ?? 0,
      im: 0,
    });
  }
  return result;
}

/**
 * Test-local Durand-Kerner root finder. Task 5 owns the production `polesZeros`;
 * this copy exists only to assert pole stability of the designed coefficients.
 */
function polynomialRoots(coefficients: readonly number[]): ComplexNumber[] {
  const degree = coefficients.length - 1;
  if (degree <= 0) {
    return [];
  }
  const roots: ComplexNumber[] = Array.from({ length: degree }, (_, index) => {
    const angle = (2 * Math.PI * index) / degree + 0.1;
    return { re: 0.5 * Math.cos(angle), im: 0.5 * Math.sin(angle) };
  });
  for (let iteration = 0; iteration < 500; iteration += 1) {
    let largestStep = 0;
    for (let index = 0; index < degree; index += 1) {
      const root = roots[index] ?? { re: 0, im: 0 };
      let denominator: ComplexNumber = { re: 1, im: 0 };
      for (let other = 0; other < degree; other += 1) {
        if (other !== index) {
          denominator = multiplyComplex(
            denominator,
            subtractComplex(root, roots[other] ?? { re: 0, im: 0 }),
          );
        }
      }
      const step = divideComplex(polynomialValue(coefficients, root), denominator);
      roots[index] = subtractComplex(root, step);
      largestStep = Math.max(largestStep, Math.hypot(step.re, step.im));
    }
    if (largestStep < 1e-14) {
      break;
    }
  }
  return roots;
}

function bandOf(goldenCase: GoldenCase): IirBand {
  const band = goldenCase.params.band;
  if (band !== "lowpass" && band !== "highpass" && band !== "bandpass" && band !== "bandstop") {
    throw new Error(`golden fixture band is invalid: ${String(band)}`);
  }
  return band;
}

function designOf(goldenCase: GoldenCase): IirCoefficients {
  const design = goldenCase.params.design;
  const common: ButterworthOptions = {
    band: bandOf(goldenCase),
    cutoffHz: asNumberArray(goldenCase.params.cutoffHz, "params.cutoffHz"),
    order: asNumber(goldenCase.params.order, "params.order"),
    sampleRateHz: asNumber(goldenCase.params.sampleRateHz, "params.sampleRateHz"),
  };
  if (design === "butterworth") {
    return designButterworth(common);
  }
  if (design === "chebyshev1") {
    const options: Chebyshev1Options = {
      ...common,
      rippleDb: asNumber(goldenCase.params.rippleDb, "params.rippleDb"),
    };
    return designChebyshev1(options);
  }
  throw new Error(`golden fixture design is invalid: ${String(design)}`);
}

function expectedArrayOf(goldenCase: GoldenCase, key: string): number[] {
  return asNumberArray(goldenCase.expected[key], `expected.${key}`);
}

function expectArrayClose(
  actual: Float64Array,
  expected: readonly number[],
  rtol: number,
  atol: number,
  label: string,
): void {
  expect(actual.length, `${label} length`).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    const actualValue = actual[index] ?? Number.NaN;
    const expectedValue = expected[index] ?? Number.NaN;
    const difference = Math.abs(actualValue - expectedValue);
    const allowed = Math.max(atol, rtol * Math.abs(expectedValue));
    expect(
      difference,
      `${label}[${index}]: |${actualValue} - ${expectedValue}| = ${difference} exceeds ${allowed}`,
    ).toBeLessThanOrEqual(allowed);
  }
}

function rootMeanSquare(samples: Float64Array, startSample: number): number {
  let sum = 0;
  for (let index = startSample; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / (samples.length - startSample));
}

function sine(frequencyHz: number, durationSeconds = 2): Float64Array {
  const samples = new Float64Array(Math.round(durationSeconds * SAMPLE_RATE_HZ));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE_HZ);
  }
  return samples;
}

/** Naive difference equation, independent of the transposed direct form II. */
function impulseResponseFromDifferenceEquation(
  { b, a }: IirCoefficients,
  length: number,
): Float64Array {
  const a0 = a[0] ?? 0;
  const output = new Float64Array(length);
  for (let sample = 0; sample < length; sample += 1) {
    let value = 0;
    for (let index = 0; index < b.length; index += 1) {
      const inputIndex = sample - index;
      if (inputIndex === 0) {
        value += (b[index] ?? 0) * 1;
      }
    }
    for (let index = 1; index < a.length; index += 1) {
      const outputIndex = sample - index;
      if (outputIndex >= 0) {
        value -= (a[index] ?? 0) * (output[outputIndex] ?? 0);
      }
    }
    output[sample] = value / a0;
  }
  return output;
}

describe("iir fixture", () => {
  it("loads the committed golden fixture with the pinned design cases", () => {
    expect(golden.algorithm).toBe("iir");
    expect(iirCases.map((goldenCase) => goldenCase.name)).toEqual([
      "butterworth_lowpass_order4_fc4000_fs48000",
      "butterworth_highpass_order4_fc4000_fs48000",
      "butterworth_bandpass_order3_fc1000_4000_fs48000",
      "butterworth_bandstop_order2_fc1000_4000_fs48000",
      "chebyshev1_lowpass_order4_fc4000_ripple0.5_fs48000",
      "chebyshev1_highpass_order4_fc4000_ripple0.5_fs48000",
      "chebyshev1_bandpass_order3_fc1000_4000_ripple0.5_fs48000",
      "butterworth_lowpass_order4_fc2000_fs48000",
      "butterworth_highpass_order2_fc4000_fs48000",
      "butterworth_bandpass_order4_fc1000_4000_fs48000",
      "chebyshev1_lowpass_order5_fc4000_ripple1_fs48000",
      "chebyshev1_bandpass_order4_fc1000_4000_ripple1_fs48000",
    ]);
    expect(new Set(iirCases.map((goldenCase) => bandOf(goldenCase)))).toEqual(
      new Set(["lowpass", "highpass", "bandpass", "bandstop"]),
    );
  });

  it("pins the scipy coefficient tolerance rtol = 1e-9", () => {
    for (const goldenCase of iirCases) {
      expect(goldenCase.tolerance.rtol).toBe(1e-9);
    }
  });

  it.each(iirCases)("matches scipy coefficients for $name", (goldenCase: GoldenCase) => {
    const actual = designOf(goldenCase);
    expectArrayClose(
      actual.b,
      expectedArrayOf(goldenCase, "b"),
      goldenCase.tolerance.rtol,
      goldenCase.tolerance.atol,
      `${goldenCase.name} b`,
    );
    expectArrayClose(
      actual.a,
      expectedArrayOf(goldenCase, "a"),
      goldenCase.tolerance.rtol,
      goldenCase.tolerance.atol,
      `${goldenCase.name} a`,
    );
  });

  it.each(iirCases)("applyFilter matches scipy lfilter for $name", (goldenCase: GoldenCase) => {
    // Apply the reference (SciPy) coefficients: this isolates applyFilter from
    // the 1e-9 coefficient tolerance; the design itself is checked above.
    const coefficients = {
      b: Float64Array.from(expectedArrayOf(goldenCase, "b")),
      a: Float64Array.from(expectedArrayOf(goldenCase, "a")),
    };
    const input = Float64Array.from(goldenCase.input.samples);
    const filtered = applyFilter(input, coefficients);
    expectArrayClose(
      filtered,
      expectedArrayOf(goldenCase, "filteredSamples"),
      1e-12,
      1e-12,
      `${goldenCase.name} filteredSamples`,
    );
  });
});

describe("designButterworth and designChebyshev1", () => {
  it("returns a[0] = 1 for every golden design", () => {
    for (const goldenCase of iirCases) {
      expect(designOf(goldenCase).a[0], goldenCase.name).toBe(1);
    }
  });

  it("places every pole strictly inside the unit circle", () => {
    for (const goldenCase of iirCases) {
      const { a } = designOf(goldenCase);
      const poles = polynomialRoots(Array.from(a));
      expect(poles.length, goldenCase.name).toBe(a.length - 1);
      for (const pole of poles) {
        const modulus = Math.hypot(pole.re, pole.im);
        expect(modulus, `${goldenCase.name} pole |z| = ${modulus} must be < 1 - 1e-9`).toBeLessThan(
          1 - 1e-9,
        );
      }
    }
  });

  it("keeps a 1 kHz sine and attenuates a 10 kHz sine by at least 30 dB (order 4)", () => {
    const coefficients = designButterworth({
      band: "lowpass",
      cutoffHz: [4000],
      order: 4,
      sampleRateHz: SAMPLE_RATE_HZ,
    });
    const transitionSamples = Math.round(0.2 * SAMPLE_RATE_HZ);

    const passbandInput = sine(1000);
    const passbandOutput = applyFilter(passbandInput, coefficients);
    const passbandDb =
      20 *
      Math.log10(
        rootMeanSquare(passbandOutput, transitionSamples) /
          rootMeanSquare(passbandInput, transitionSamples),
      );
    expect(Math.abs(passbandDb)).toBeLessThanOrEqual(0.2);

    const stopbandInput = sine(10000);
    const stopbandOutput = applyFilter(stopbandInput, coefficients);
    const stopbandDb =
      20 *
      Math.log10(
        rootMeanSquare(stopbandOutput, transitionSamples) /
          rootMeanSquare(stopbandInput, transitionSamples),
      );
    expect(stopbandDb).toBeLessThanOrEqual(-30);
  });

  it("rejects orders outside the integer range 1..8", () => {
    for (const order of [0, -1, 9, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        designButterworth({ band: "lowpass", cutoffHz: [4000], order, sampleRateHz: 48000 }),
      ).toThrow(RangeError);
      expect(() =>
        designChebyshev1({
          band: "lowpass",
          cutoffHz: [4000],
          order,
          rippleDb: 1,
          sampleRateHz: 48000,
        }),
      ).toThrow(RangeError);
    }
    expect(() =>
      designButterworth({ band: "lowpass", cutoffHz: [4000], order: 8, sampleRateHz: 48000 }),
    ).not.toThrow();
  });

  it("rejects ripple outside [0.1, 3] dB", () => {
    for (const rippleDb of [0, 0.05, 3.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        designChebyshev1({
          band: "lowpass",
          cutoffHz: [4000],
          order: 4,
          rippleDb,
          sampleRateHz: 48000,
        }),
      ).toThrow(RangeError);
    }
    for (const rippleDb of [0.1, 3]) {
      expect(() =>
        designChebyshev1({
          band: "lowpass",
          cutoffHz: [4000],
          order: 4,
          rippleDb,
          sampleRateHz: 48000,
        }),
      ).not.toThrow();
    }
  });

  it("rejects a cutoff count that does not match the band", () => {
    for (const [band, cutoffHz] of [
      ["lowpass", [4000, 12000]],
      ["highpass", []],
      ["bandpass", [4000]],
      ["bandstop", [4000]],
    ] as const) {
      expect(() =>
        designButterworth({ band, cutoffHz: [...cutoffHz], order: 2, sampleRateHz: 48000 }),
      ).toThrow(RangeError);
    }
  });

  it("rejects cutoffs outside (0, fs/2) and cutoffs that are not strictly increasing", () => {
    for (const cutoffHz of [
      [0],
      [-1],
      [24000],
      [30000],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
    ]) {
      expect(() =>
        designButterworth({ band: "lowpass", cutoffHz, order: 2, sampleRateHz: 48000 }),
      ).toThrow(RangeError);
    }
    for (const cutoffHz of [
      [12000, 4000],
      [4000, 4000],
      [4000, 24000],
    ]) {
      expect(() =>
        designButterworth({ band: "bandpass", cutoffHz, order: 2, sampleRateHz: 48000 }),
      ).toThrow(RangeError);
    }
  });

  it("rejects invalid sample rates and unknown runtime bands", () => {
    for (const sampleRateHz of [0, -48000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        designButterworth({ band: "lowpass", cutoffHz: [4000], order: 2, sampleRateHz }),
      ).toThrow(RangeError);
    }
    expect(() =>
      designButterworth({
        band: "notch" as unknown as IirBand,
        cutoffHz: [4000],
        order: 2,
        sampleRateHz: 48000,
      }),
    ).toThrow(RangeError);
  });

  it("does not mutate the cutoff array and returns fresh coefficient arrays", () => {
    const options: ButterworthOptions = {
      band: "bandpass",
      cutoffHz: [1000, 4000],
      order: 3,
      sampleRateHz: 48000,
    };
    const before = [...options.cutoffHz];
    const first = designButterworth(options);
    const second = designButterworth(options);
    expect(options.cutoffHz).toEqual(before);
    expect(first.b).not.toBe(second.b);
    expect(first.a).not.toBe(second.a);
    expect(Array.from(first.b)).toEqual(Array.from(second.b));
  });
});

describe("applyFilter", () => {
  it("implements the impulse response of the designed difference equation", () => {
    const coefficients = designButterworth({
      band: "lowpass",
      cutoffHz: [2000],
      order: 4,
      sampleRateHz: SAMPLE_RATE_HZ,
    });
    const impulse = new Float64Array(128);
    impulse[0] = 1;
    const actual = applyFilter(impulse, coefficients);
    expectArrayClose(
      actual,
      Array.from(impulseResponseFromDifferenceEquation(coefficients, 128)),
      1e-12,
      1e-12,
      "impulse response",
    );
  });

  it("normalizes the coefficients by a[0]", () => {
    const output = applyFilter(Float64Array.of(0.5, 1), {
      b: Float64Array.of(2, 2),
      a: Float64Array.of(2),
    });
    expect(Array.from(output)).toEqual([0.5, 1.5]);
  });

  it("rejects empty coefficient arrays and a zero a[0]", () => {
    expect(() =>
      applyFilter(Float64Array.of(1), { b: new Float64Array(0), a: Float64Array.of(1) }),
    ).toThrow(RangeError);
    expect(() =>
      applyFilter(Float64Array.of(1), { b: Float64Array.of(1), a: new Float64Array(0) }),
    ).toThrow(RangeError);
    expect(() =>
      applyFilter(Float64Array.of(1), { b: Float64Array.of(1), a: Float64Array.of(0, 1) }),
    ).toThrow(RangeError);
  });

  it("rejects non-finite samples and coefficients with TypeError", () => {
    const coefficients = { b: Float64Array.of(1), a: Float64Array.of(1) };
    for (const sample of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => applyFilter(Float64Array.of(sample), coefficients)).toThrow(TypeError);
    }
    expect(() =>
      applyFilter(Float64Array.of(1), { b: Float64Array.of(Number.NaN), a: Float64Array.of(1) }),
    ).toThrow(TypeError);
    expect(() =>
      applyFilter(Float64Array.of(1), { b: Float64Array.of(1), a: Float64Array.of(1, Number.NaN) }),
    ).toThrow(TypeError);
  });

  it("returns an empty array for empty input and leaves the input unchanged", () => {
    const coefficients = designChebyshev1({
      band: "highpass",
      cutoffHz: [4000],
      order: 4,
      rippleDb: 1,
      sampleRateHz: SAMPLE_RATE_HZ,
    });
    expect(applyFilter(new Float64Array(0), coefficients).length).toBe(0);

    const input = sine(1000, 0.01);
    const before = Array.from(input);
    applyFilter(input, coefficients);
    expect(Array.from(input)).toEqual(before);
  });
});
