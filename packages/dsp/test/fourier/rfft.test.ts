import { describe, expect, it } from "vitest";
import { type Complex, fft, irfft, rfft } from "../../src/index.js";
import { asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("rfft");

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

function halfSpectrumOfGoldenCase(goldenCase: GoldenCase): Complex {
  return {
    re: Float64Array.from(asNumberArray(goldenCase.expected.re, "expected.re")),
    im: Float64Array.from(asNumberArray(goldenCase.expected.im, "expected.im")),
  };
}

describe("rfft fixture", () => {
  it("loads the committed rfft fixture", () => {
    expect(golden.algorithm).toBe("rfft");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "random_n1024_seed42",
      "random_n997_seed43",
      "single_sample_n1",
    ]);
  });
});

describe("rfft (golden)", () => {
  it.each(golden.cases)("matches the scipy half-spectrum for $name", (goldenCase: GoldenCase) => {
    const samples = Float64Array.from(goldenCase.input.samples);
    const expectedRe = asNumberArray(goldenCase.expected.re, "expected.re");
    const expectedIm = asNumberArray(goldenCase.expected.im, "expected.im");
    const actual = rfft(samples);

    expect(actual.re.length).toBe(Math.floor(samples.length / 2) + 1);
    expect(actual.im.length).toBe(actual.re.length);
    expectedRe.forEach((expected, k) => {
      expectClose(valueAt(actual.re, k), expected, goldenCase.tolerance, `re[${k}]`);
    });
    expectedIm.forEach((expected, k) => {
      expectClose(valueAt(actual.im, k), expected, goldenCase.tolerance, `im[${k}]`);
    });
  });
});

describe("irfft (golden)", () => {
  it.each(golden.cases)(
    "reconstructs the scipy inverse for $name directly",
    (goldenCase: GoldenCase) => {
      const expectedSamples = asNumberArray(goldenCase.expected.irfft, "expected.irfft");
      const actual = irfft(halfSpectrumOfGoldenCase(goldenCase), expectedSamples.length);

      expect(actual.length).toBe(expectedSamples.length);
      expectedSamples.forEach((expected, n) => {
        expectClose(valueAt(actual, n), expected, goldenCase.tolerance, `irfft[${n}]`);
      });
    },
  );
});

describe("rfft / irfft properties", () => {
  it.each([64, 63])("rfft equals the first bins of fft for N = %i", (size: number) => {
    const samples = deterministicSignal(size);
    const half = rfft(samples);
    const full = fft(samples);

    expect(half.re.length).toBe(Math.floor(size / 2) + 1);
    for (let k = 0; k < half.re.length; k += 1) {
      expectClose(valueAt(half.re, k), valueAt(full.re, k), { rtol: 0, atol: 1e-9 }, `re[${k}]`);
      expectClose(valueAt(half.im, k), valueAt(full.im, k), { rtol: 0, atol: 1e-9 }, `im[${k}]`);
    }
  });

  it.each([64, 63])("gives real DC (and Nyquist) bins for N = %i", (size: number) => {
    const half = rfft(deterministicSignal(size));

    expect(Math.abs(valueAt(half.im, 0))).toBeLessThanOrEqual(1e-12);
    if (size % 2 === 0) {
      expect(Math.abs(valueAt(half.im, size / 2))).toBeLessThanOrEqual(1e-12);
    }
  });

  it.each([64, 63])("round-trips irfft(rfft(x), N) = x for N = %i", (size: number) => {
    const samples = deterministicSignal(size);
    const restored = irfft(rfft(samples), size);

    expect(restored.length).toBe(size);
    let maxError = 0;
    for (let n = 0; n < size; n += 1) {
      maxError = Math.max(maxError, Math.abs(valueAt(restored, n) - valueAt(samples, n)));
    }
    expect(maxError).toBeLessThanOrEqual(1e-12);
  });

  it("does not mutate the input samples", () => {
    const samples = deterministicSignal(63);
    const original = Float64Array.from(samples);
    rfft(samples);
    expect(samples).toEqual(original);
  });

  it("does not mutate the input spectrum", () => {
    const spectrum = rfft(deterministicSignal(64));
    const re = Float64Array.from(spectrum.re);
    const im = Float64Array.from(spectrum.im);
    irfft(spectrum, 64);
    expect(spectrum.re).toEqual(re);
    expect(spectrum.im).toEqual(im);
  });
});

describe("rfft / irfft edge cases", () => {
  it("handles the empty signal and empty spectrum", () => {
    const half = rfft(new Float64Array(0));
    expect(half.re.length).toBe(0);
    expect(half.im.length).toBe(0);

    const restored = irfft({ re: new Float64Array(0), im: new Float64Array(0) }, 0);
    expect(restored.length).toBe(0);
  });

  it("handles N = 1 as a single real bin", () => {
    const half = rfft(Float64Array.from([0.5]));
    expect(Array.from(half.re)).toEqual([0.5]);
    expect(Array.from(half.im)).toEqual([0]);

    const restored = irfft(half, 1);
    expect(Array.from(restored)).toEqual([0.5]);
  });

  it.each([1, 2, 3, 4, 6, 7])(
    "throws RangeError for a half-spectrum with the wrong bin count (N = %i)",
    (size: number) => {
      const wrongBinCount = Math.floor(size / 2) + 2;
      expect(() =>
        irfft({ re: new Float64Array(wrongBinCount), im: new Float64Array(wrongBinCount) }, size),
      ).toThrow(RangeError);
    },
  );

  it("throws RangeError when re and im lengths differ", () => {
    expect(() => irfft({ re: new Float64Array(3), im: new Float64Array(2) }, 4)).toThrow(
      RangeError,
    );
  });

  it("throws RangeError for a non-integer or negative originalLength", () => {
    expect(() => irfft({ re: new Float64Array(1), im: new Float64Array(1) }, -1)).toThrow(
      RangeError,
    );
    expect(() => irfft({ re: new Float64Array(1), im: new Float64Array(1) }, 2.5)).toThrow(
      RangeError,
    );
  });

  it("throws RangeError when the DC bin has a non-negligible imaginary part", () => {
    const spectrum = rfft(deterministicSignal(8));
    spectrum.im[0] = 0.1;
    expect(() => irfft(spectrum, 8)).toThrow(RangeError);
  });

  it("throws RangeError when the Nyquist bin has a non-negligible imaginary part", () => {
    const spectrum = rfft(deterministicSignal(8));
    spectrum.im[4] = 0.1;
    expect(() => irfft(spectrum, 8)).toThrow(RangeError);
  });

  it("allows roundoff-level imaginary residue in the edge bins", () => {
    const samples = deterministicSignal(8);
    const spectrum = rfft(samples);
    spectrum.im[0] = 1e-15;
    spectrum.im[4] = -1e-15;
    expect(() => irfft(spectrum, 8)).not.toThrow();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws TypeError for a non-finite sample (%s)",
    (badSample: number) => {
      const samples = Float64Array.from([1, 0, badSample, 0, 0, 0]);
      expect(() => rfft(samples)).toThrow(TypeError);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws TypeError for a non-finite half-spectrum value (%s)",
    (badValue: number) => {
      expect(() =>
        irfft({ re: Float64Array.from([1, badValue, 0]), im: new Float64Array(3) }, 4),
      ).toThrow(TypeError);
      expect(() =>
        irfft({ re: Float64Array.from([1, 0, 0]), im: Float64Array.from([badValue, 0, 0]) }, 4),
      ).toThrow(TypeError);
    },
  );
});
