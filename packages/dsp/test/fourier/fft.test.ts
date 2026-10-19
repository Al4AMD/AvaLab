import { describe, expect, it } from "vitest";
import { type Complex, dftNaive, fftRadix2, ifftRadix2 } from "../../src/index.js";
import { asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("fft");

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

describe("fftRadix2 (golden)", () => {
  it("loads the committed fft fixture", () => {
    expect(golden.algorithm).toBe("fft");
    expect(golden.cases.length).toBeGreaterThan(0);
  });

  it.each(golden.cases)("matches forward spectrum for $name", (goldenCase: GoldenCase) => {
    const samples = Float64Array.from(goldenCase.input.samples);
    const expectedRe = asNumberArray(goldenCase.expected.re, "expected.re");
    const expectedIm = asNumberArray(goldenCase.expected.im, "expected.im");
    const actual = fftRadix2(samples);

    expect(actual.re.length).toBe(expectedRe.length);
    expect(actual.im.length).toBe(expectedIm.length);
    expectedRe.forEach((expected, k) => {
      expectClose(valueAt(actual.re, k), expected, goldenCase.tolerance, `re[${k}]`);
    });
    expectedIm.forEach((expected, k) => {
      expectClose(valueAt(actual.im, k), expected, goldenCase.tolerance, `im[${k}]`);
    });
  });

  it.each(golden.cases)("inverts golden spectrum for $name", (goldenCase: GoldenCase) => {
    const expectedIfft = asNumberArray(goldenCase.expected.ifft, "expected.ifft");
    const actual = ifftRadix2(spectrumOfGoldenCase(goldenCase));

    expect(actual.length).toBe(expectedIfft.length);
    expectedIfft.forEach((expected, n) => {
      expectClose(valueAt(actual, n), expected, goldenCase.tolerance, `ifft[${n}]`);
    });
  });
});

describe("fftRadix2 properties", () => {
  it("agrees with dftNaive for N = 64 within 1e-10", () => {
    const samples = deterministicSignal(64);
    const fast = fftRadix2(samples);
    const reference = dftNaive(samples);
    for (let k = 0; k < samples.length; k += 1) {
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

  it("round-trips a deterministic signal through fft and ifft within 1e-12", () => {
    const samples = deterministicSignal(64);
    const original = Float64Array.from(samples);
    const restored = ifftRadix2(fftRadix2(samples));

    expect(samples).toEqual(original);
    let maxError = 0;
    for (let n = 0; n < samples.length; n += 1) {
      const error = Math.abs(valueAt(restored, n) - valueAt(samples, n));
      maxError = Math.max(maxError, error);
    }
    expect(maxError).toBeLessThanOrEqual(1e-12);
  });

  it("satisfies Parseval's theorem: sum |x|^2 = (1/N) sum |X|^2", () => {
    const samples = deterministicSignal(64);
    const spectrum = fftRadix2(samples);
    let timeEnergy = 0;
    let frequencyEnergy = 0;
    for (let n = 0; n < samples.length; n += 1) {
      timeEnergy += valueAt(samples, n) ** 2;
      frequencyEnergy += valueAt(spectrum.re, n) ** 2 + valueAt(spectrum.im, n) ** 2;
    }
    expectClose(
      timeEnergy,
      frequencyEnergy / samples.length,
      { rtol: 1e-12, atol: 1e-12 },
      "energy",
    );
  });

  it("is linear", () => {
    const length = 32;
    const x = deterministicSignal(length);
    const y = deterministicSignal(length, 0.71, 0.23);
    const scaleX = 0.75;
    const scaleY = -1.25;
    const combined = new Float64Array(length);
    for (let n = 0; n < length; n += 1) {
      combined[n] = scaleX * valueAt(x, n) + scaleY * valueAt(y, n);
    }

    const spectrumOfSum = fftRadix2(combined);
    const spectrumX = fftRadix2(x);
    const spectrumY = fftRadix2(y);
    for (let k = 0; k < length; k += 1) {
      const expectedRe = scaleX * valueAt(spectrumX.re, k) + scaleY * valueAt(spectrumY.re, k);
      const expectedIm = scaleX * valueAt(spectrumX.im, k) + scaleY * valueAt(spectrumY.im, k);
      expectClose(
        valueAt(spectrumOfSum.re, k),
        expectedRe,
        { rtol: 1e-12, atol: 1e-12 },
        `linear re[${k}]`,
      );
      expectClose(
        valueAt(spectrumOfSum.im, k),
        expectedIm,
        { rtol: 1e-12, atol: 1e-12 },
        `linear im[${k}]`,
      );
    }
  });

  it("applies a phase ramp under circular time shift and preserves magnitude", () => {
    const length = 32;
    const shift = 5;
    const samples = deterministicSignal(length);
    const shifted = new Float64Array(length);
    for (let n = 0; n < length; n += 1) {
      shifted[(n + shift) % length] = valueAt(samples, n);
    }

    const spectrum = fftRadix2(samples);
    const shiftedSpectrum = fftRadix2(shifted);
    for (let k = 0; k < length; k += 1) {
      const angle = (-2 * Math.PI * k * shift) / length;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const re = valueAt(spectrum.re, k);
      const im = valueAt(spectrum.im, k);
      const expectedRe = re * cosine - im * sine;
      const expectedIm = re * sine + im * cosine;
      expectClose(
        valueAt(shiftedSpectrum.re, k),
        expectedRe,
        { rtol: 1e-12, atol: 1e-12 },
        `shifted re[${k}]`,
      );
      expectClose(
        valueAt(shiftedSpectrum.im, k),
        expectedIm,
        { rtol: 1e-12, atol: 1e-12 },
        `shifted im[${k}]`,
      );

      const magnitude = Math.hypot(re, im);
      const shiftedMagnitude = Math.hypot(
        valueAt(shiftedSpectrum.re, k),
        valueAt(shiftedSpectrum.im, k),
      );
      expectClose(shiftedMagnitude, magnitude, { rtol: 1e-12, atol: 1e-12 }, `|X[${k}]|`);
    }
  });

  it("does not mutate the input samples", () => {
    const samples = deterministicSignal(16);
    const original = Float64Array.from(samples);
    fftRadix2(samples);
    expect(samples).toEqual(original);
  });

  it("does not mutate the input spectrum", () => {
    const spectrum = fftRadix2(deterministicSignal(16));
    const re = Float64Array.from(spectrum.re);
    const im = Float64Array.from(spectrum.im);
    ifftRadix2(spectrum);
    expect(spectrum.re).toEqual(re);
    expect(spectrum.im).toEqual(im);
  });
});

describe("fftRadix2 edge cases", () => {
  it("returns a zero-length Complex for empty input", () => {
    const spectrum = fftRadix2(new Float64Array(0));
    expect(spectrum.re.length).toBe(0);
    expect(spectrum.im.length).toBe(0);
    expect(ifftRadix2({ re: new Float64Array(0), im: new Float64Array(0) }).length).toBe(0);
  });

  it("handles N = 1 as the identity", () => {
    const spectrum = fftRadix2(Float64Array.from([0.5]));
    expect(Array.from(spectrum.re)).toEqual([0.5]);
    expect(Array.from(spectrum.im)).toEqual([0]);
    expect(Array.from(ifftRadix2(spectrum))).toEqual([0.5]);
  });

  it.each([6, 7, 1000])("throws RangeError for non-power-of-two size %i", (size: number) => {
    expect(() => fftRadix2(new Float64Array(size))).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws TypeError for a non-finite sample (%s)",
    (badSample: number) => {
      expect(() => fftRadix2(Float64Array.from([1, 0, badSample, 0]))).toThrow(TypeError);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws TypeError for a non-finite spectrum value (%s)",
    (badValue: number) => {
      expect(() =>
        ifftRadix2({ re: Float64Array.from([1, badValue]), im: new Float64Array(2) }),
      ).toThrow(TypeError);
      expect(() =>
        ifftRadix2({ re: Float64Array.from([1, 0]), im: Float64Array.from([badValue, 0]) }),
      ).toThrow(TypeError);
    },
  );

  it("throws TypeError when re and im lengths differ", () => {
    expect(() => ifftRadix2({ re: new Float64Array(2), im: new Float64Array(3) })).toThrow(
      TypeError,
    );
  });
});
