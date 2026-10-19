import { describe, expect, it } from "vitest";
import { type Complex, dftNaive, fft, fftBluestein, fftRadix2, ifft } from "../../src/index.js";
import { asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("fft_arbitrary");

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

function deterministicSignal(length: number, frequencyA = 0.37, frequencyB = 0.11): Float64Array {
  const samples = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    samples[i] = Math.sin(frequencyA * i) + 0.25 * Math.cos(frequencyB * i);
  }
  return samples;
}

function spectrumOfGoldenCase(goldenCase: GoldenCase): Complex {
  return {
    re: Float64Array.from(asNumberArray(goldenCase.expected.re, "expected.re")),
    im: Float64Array.from(asNumberArray(goldenCase.expected.im, "expected.im")),
  };
}

describe("fft_arbitrary fixture", () => {
  it("loads the committed fft_arbitrary fixture", () => {
    expect(golden.algorithm).toBe("fft_arbitrary");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "random_n6_seed42",
      "random_n997_seed43",
      "random_n1000_seed44",
      "random_n4801_seed45",
    ]);
  });
});

describe("fftBluestein (golden)", () => {
  it.each(golden.cases)("matches forward spectrum for $name", (goldenCase: GoldenCase) => {
    const samples = Float64Array.from(goldenCase.input.samples);
    const expectedRe = asNumberArray(goldenCase.expected.re, "expected.re");
    const expectedIm = asNumberArray(goldenCase.expected.im, "expected.im");
    const actual = fftBluestein(samples);

    expect(actual.re.length).toBe(expectedRe.length);
    expect(actual.im.length).toBe(expectedIm.length);
    expectedRe.forEach((expected, k) => {
      expectClose(valueAt(actual.re, k), expected, goldenCase.tolerance, `re[${k}]`);
    });
    expectedIm.forEach((expected, k) => {
      expectClose(valueAt(actual.im, k), expected, goldenCase.tolerance, `im[${k}]`);
    });
  });
});

describe("ifft (golden)", () => {
  it.each(golden.cases)("inverts golden spectrum for $name", (goldenCase: GoldenCase) => {
    const expectedIfft = asNumberArray(goldenCase.expected.ifft, "expected.ifft");
    const actual = ifft(spectrumOfGoldenCase(goldenCase));

    expect(actual.length).toBe(expectedIfft.length);
    expectedIfft.forEach((expected, n) => {
      expectClose(valueAt(actual, n), expected, goldenCase.tolerance, `ifft[${n}]`);
    });
  });
});

describe("fft / ifft properties", () => {
  it.each([5, 6, 7])("fft agrees with dftNaive for N = %i within 1e-10", (size: number) => {
    const samples = deterministicSignal(size);
    const fast = fft(samples);
    const reference = dftNaive(samples);
    for (let k = 0; k < size; k += 1) {
      expectClose(
        valueAt(fast.re, k),
        valueAt(reference.re, k),
        { rtol: 0, atol: 1e-10 },
        `re[${k}]`,
      );
      expectClose(
        valueAt(fast.im, k),
        valueAt(reference.im, k),
        { rtol: 0, atol: 1e-10 },
        `im[${k}]`,
      );
    }
  });

  it.each(golden.cases)(
    "round-trips the golden samples through fft and ifft for $name",
    (goldenCase: GoldenCase) => {
      const samples = Float64Array.from(goldenCase.input.samples);
      const restored = ifft(fft(samples));

      let maxError = 0;
      for (let n = 0; n < samples.length; n += 1) {
        maxError = Math.max(maxError, Math.abs(valueAt(restored, n) - valueAt(samples, n)));
      }
      expect(maxError).toBeLessThanOrEqual(1e-12);
    },
  );

  it("handles N = 1 in fftBluestein as the identity", () => {
    const spectrum = fftBluestein(Float64Array.from([0.5]));
    expect(Array.from(spectrum.re)).toEqual([0.5]);
    expect(Array.from(spectrum.im)).toEqual([0]);
  });

  it("dispatches N = 1024 to fftRadix2 with bit-identical output", () => {
    const samples = deterministicSignal(1024);
    const dispatched = fft(samples);
    const direct = fftRadix2(samples);

    for (let k = 0; k < samples.length; k += 1) {
      expect(valueAt(dispatched.re, k), `re[${k}]`).toBe(valueAt(direct.re, k));
      expect(valueAt(dispatched.im, k), `im[${k}]`).toBe(valueAt(direct.im, k));
    }
  });

  it("does not mutate the input samples", () => {
    const samples = deterministicSignal(6);
    const original = Float64Array.from(samples);
    fftBluestein(samples);
    fft(samples);
    expect(samples).toEqual(original);
  });

  it("does not mutate the input spectrum", () => {
    const spectrum = fftBluestein(deterministicSignal(6));
    const re = Float64Array.from(spectrum.re);
    const im = Float64Array.from(spectrum.im);
    ifft(spectrum);
    expect(spectrum.re).toEqual(re);
    expect(spectrum.im).toEqual(im);
  });
});

describe("fft / ifft edge cases", () => {
  it("returns zero-length results for empty input", () => {
    const bluesteinSpectrum = fftBluestein(new Float64Array(0));
    expect(bluesteinSpectrum.re.length).toBe(0);
    expect(bluesteinSpectrum.im.length).toBe(0);

    const dispatchedSpectrum = fft(new Float64Array(0));
    expect(dispatchedSpectrum.re.length).toBe(0);
    expect(dispatchedSpectrum.im.length).toBe(0);

    expect(ifft({ re: new Float64Array(0), im: new Float64Array(0) }).length).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws TypeError for a non-finite sample (%s)",
    (badSample: number) => {
      const samples = Float64Array.from([1, 0, badSample, 0, 0, 0]);
      expect(() => fftBluestein(samples)).toThrow(TypeError);
      expect(() => fft(samples)).toThrow(TypeError);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws TypeError for a non-finite spectrum value (%s)",
    (badValue: number) => {
      expect(() =>
        ifft({ re: Float64Array.from([1, badValue, 0]), im: new Float64Array(3) }),
      ).toThrow(TypeError);
      expect(() =>
        ifft({ re: Float64Array.from([1, 0, 0]), im: Float64Array.from([badValue, 0, 0]) }),
      ).toThrow(TypeError);
    },
  );

  it("throws TypeError when re and im lengths differ", () => {
    expect(() => ifft({ re: new Float64Array(2), im: new Float64Array(3) })).toThrow(TypeError);
  });
});
