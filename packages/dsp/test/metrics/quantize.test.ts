import { describe, expect, it } from "vitest";
import {
  generateSine,
  quantizationError,
  quantizeUniform,
  quantizeWithTpdfDither,
  snrDb,
} from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("quantize");

function goldenCaseNamed(name: string): GoldenCase {
  const found = golden.cases.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`fixture is missing case "${name}"`);
  }
  return found;
}

function paramNumber(goldenCase: GoldenCase, key: string): number {
  return asNumber(goldenCase.params[key], `params.${key} of ${goldenCase.name}`);
}

function expectedSamplesOf(goldenCase: GoldenCase): number[] {
  return asNumberArray(goldenCase.expected.samples, `expected.samples of ${goldenCase.name}`);
}

function expectSamplesClose(
  actual: Float64Array,
  expected: readonly number[],
  tolerance: { rtol: number; atol: number },
  label: string,
): void {
  expect(actual.length).toBe(expected.length);
  for (let n = 0; n < expected.length; n += 1) {
    const actualSample = actual[n] ?? Number.NaN;
    const expectedSample = expected[n] ?? Number.NaN;
    const difference = Math.abs(actualSample - expectedSample);
    const allowed = tolerance.atol + tolerance.rtol * Math.abs(expectedSample);
    expect(
      difference,
      `${label}[${n}]: |${actualSample} - ${expectedSample}| = ${difference} exceeds ${allowed}`,
    ).toBeLessThanOrEqual(allowed);
  }
}

/** Pearson correlation coefficient; test helper only (no public API). */
function correlationCoefficient(first: Float64Array, second: Float64Array): number {
  const count = first.length;
  let meanFirst = 0;
  let meanSecond = 0;
  for (let n = 0; n < count; n += 1) {
    meanFirst += first[n] ?? 0;
    meanSecond += second[n] ?? 0;
  }
  meanFirst /= count;
  meanSecond /= count;

  let covariance = 0;
  let varianceFirst = 0;
  let varianceSecond = 0;
  for (let n = 0; n < count; n += 1) {
    const centeredFirst = (first[n] ?? 0) - meanFirst;
    const centeredSecond = (second[n] ?? 0) - meanSecond;
    covariance += centeredFirst * centeredSecond;
    varianceFirst += centeredFirst * centeredFirst;
    varianceSecond += centeredSecond * centeredSecond;
  }
  return covariance / Math.sqrt(varianceFirst * varianceSecond);
}

function fullScaleTestTone(): Float64Array {
  // 1 kHz is the standard audio test tone. At 48 kHz it is exactly 48
  // samples per cycle, so the measurement is stable across engines.
  return generateSine({
    durationSeconds: 1,
    sampleRateHz: 48000,
    frequencyHz: 1000,
    amplitude: 1,
  });
}

describe("quantize fixture", () => {
  it("loads the committed quantize fixture with the pinned cases", () => {
    expect(golden.algorithm).toBe("quantize");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "quantize_ramp9_bits3",
      "quantize_sine_440hz_bits8",
      "quantize_clipping_bits4",
    ]);
  });

  it("pins rtol = 1e-12 and atol = 1e-12", () => {
    for (const goldenCase of golden.cases) {
      expect(goldenCase.tolerance).toEqual({ rtol: 1e-12, atol: 1e-12 });
    }
  });
});

describe("quantizeUniform (golden)", () => {
  it("matches the exact b = 3 ramp codes", () => {
    const goldenCase = goldenCaseNamed("quantize_ramp9_bits3");
    const actual = quantizeUniform(Float64Array.from(goldenCase.input.samples), {
      bits: paramNumber(goldenCase, "bits"),
    });
    expectSamplesClose(actual, expectedSamplesOf(goldenCase), goldenCase.tolerance, "ramp3");
  });

  it("matches the b = 8 sine codes", () => {
    const goldenCase = goldenCaseNamed("quantize_sine_440hz_bits8");
    const actual = quantizeUniform(Float64Array.from(goldenCase.input.samples), {
      bits: paramNumber(goldenCase, "bits"),
    });
    expectSamplesClose(actual, expectedSamplesOf(goldenCase), goldenCase.tolerance, "sine8");
  });

  it("clips inputs outside [−1, 1] after rounding", () => {
    const goldenCase = goldenCaseNamed("quantize_clipping_bits4");
    const actual = quantizeUniform(Float64Array.from(goldenCase.input.samples), {
      bits: paramNumber(goldenCase, "bits"),
    });
    expectSamplesClose(actual, expectedSamplesOf(goldenCase), goldenCase.tolerance, "clipping4");
    for (const sample of actual) {
      expect(sample).toBeGreaterThanOrEqual(-1);
      expect(sample).toBeLessThanOrEqual(1);
    }
  });
});

describe("quantizeUniform", () => {
  it("is mid-tread: zero maps to zero and codes are multiples of Δ", () => {
    const input = Float64Array.from([-0.9, -0.4, 0, 0.4, 0.9]);
    const output = quantizeUniform(input, { bits: 2 });
    const step = 2 / (2 ** 2 - 1);
    expect(Array.from(output)).toEqual([-2 / 3, -2 / 3, 0, 2 / 3, 2 / 3]);
    for (const sample of output) {
      expect(Math.abs(sample / step - Math.round(sample / step))).toBeLessThan(1e-12);
    }
  });

  it("returns a fresh array and never mutates the input", () => {
    const input = Float64Array.from([0.1, -0.2, 0.3]);
    const copy = Float64Array.from(input);
    const output = quantizeUniform(input, { bits: 8 });
    expect(Array.from(input)).toEqual(Array.from(copy));
    expect(output).not.toBe(input);
    expect(Array.from(output)).toHaveLength(3);
  });

  it("returns an empty array for empty input", () => {
    expect(quantizeUniform(new Float64Array(0), { bits: 8 })).toHaveLength(0);
  });

  it("accepts the boundary bit depths 1 and 24", () => {
    for (const bits of [1, 24]) {
      const output = quantizeUniform(Float64Array.from([0.5, -0.5]), { bits });
      expect(output).toHaveLength(2);
      for (const sample of output) {
        expect(Number.isFinite(sample)).toBe(true);
      }
    }
  });

  it("rejects bits outside the integer range [1, 24]", () => {
    const input = Float64Array.from([0.25]);
    for (const bits of [0, 25, -1, 4.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => quantizeUniform(input, { bits })).toThrow(RangeError);
    }
    expect(() => quantizeUniform(input, undefined as unknown as { bits: number })).toThrow(
      RangeError,
    );
  });

  it("throws TypeError on non-finite samples", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => quantizeUniform(Float64Array.from([0.5, bad]), { bits: 8 })).toThrow(TypeError);
    }
  });

  it("keeps clipped input inside [−1, 1]", () => {
    const input = Float64Array.from([-100, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 100]);
    for (const bits of [1, 4, 8]) {
      for (const sample of quantizeUniform(input, { bits })) {
        expect(sample).toBeGreaterThanOrEqual(-1);
        expect(sample).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("quantizeUniform SNR verification", () => {
  it("matches 6.02·b + 1.76 dB within ±0.5 dB for a full-scale sine (b = 4, 8, 12)", () => {
    const reference = fullScaleTestTone();
    for (const bits of [4, 8, 12]) {
      const measuredSnrDb = snrDb(reference, quantizeUniform(reference, { bits }));
      const theoreticalSnrDb = 6.02 * bits + 1.76;
      expect(
        Math.abs(measuredSnrDb - theoreticalSnrDb),
        `bits=${bits}: measured ${measuredSnrDb} dB vs theoretical ${theoreticalSnrDb} dB`,
      ).toBeLessThanOrEqual(0.5);
    }
  });

  it("increases SNR monotonically with the bit depth", () => {
    const reference = fullScaleTestTone();
    const bitDepths = [2, 4, 6, 8, 10, 12];
    let previousSnrDb = Number.NEGATIVE_INFINITY;
    for (const bits of bitDepths) {
      const measuredSnrDb = snrDb(reference, quantizeUniform(reference, { bits }));
      expect(measuredSnrDb, `bits=${bits}`).toBeGreaterThan(previousSnrDb);
      previousSnrDb = measuredSnrDb;
    }
  });
});

describe("quantizeWithTpdfDither", () => {
  it("decorrelates the quantization error from a b = 4 sine", () => {
    // Amplitude 0.6 leaves headroom so TPDF dither never clips at ±1; at full
    // scale the clipping overload itself reintroduces error-signal correlation.
    const reference = generateSine({
      durationSeconds: 1,
      sampleRateHz: 48000,
      frequencyHz: 440,
      amplitude: 0.6,
    });
    const unditheredError = quantizationError(reference, quantizeUniform(reference, { bits: 4 }));
    const ditheredError = quantizationError(
      reference,
      quantizeWithTpdfDither(reference, { bits: 4, seed: 20261020 }),
    );

    const unditheredRho = Math.abs(correlationCoefficient(reference, unditheredError));
    const ditheredRho = Math.abs(correlationCoefficient(reference, ditheredError));

    expect(unditheredRho).toBeGreaterThan(0.3);
    expect(ditheredRho).toBeLessThan(0.05);
  });

  it("keeps SNR within ±0.5 dB of the dithered theoretical value at b = 8", () => {
    // Total error with TPDF dither is dither (Δ²/6) + quantizer error
    // (Δ²/12) = Δ²/4, i.e. 10·log10(3) ≈ 4.77 dB below the undithered curve.
    const reference = fullScaleTestTone();
    const measuredSnrDb = snrDb(
      reference,
      quantizeWithTpdfDither(reference, { bits: 8, seed: 20261020 }),
    );
    const theoreticalSnrDb = 6.02 * 8 + 1.76 - 10 * Math.log10(3);
    expect(
      Math.abs(measuredSnrDb - theoreticalSnrDb),
      `measured ${measuredSnrDb} dB vs dithered theoretical ${theoreticalSnrDb} dB`,
    ).toBeLessThanOrEqual(0.5);
  });

  it("is deterministic per seed and differs across seeds", () => {
    const input = generateSine({
      durationSeconds: 0.01,
      sampleRateHz: 8000,
      frequencyHz: 440,
      amplitude: 0.9,
    });
    const first = quantizeWithTpdfDither(input, { bits: 4, seed: 12345 });
    const second = quantizeWithTpdfDither(input, { bits: 4, seed: 12345 });
    const other = quantizeWithTpdfDither(input, { bits: 4, seed: 54321 });

    expect(Array.from(first)).toEqual(Array.from(second));
    expect(Array.from(other)).not.toEqual(Array.from(first));
  });

  it("never mutates the input and returns a fresh array", () => {
    const input = Float64Array.from([0.1, -0.2, 0.3]);
    const copy = Float64Array.from(input);
    const output = quantizeWithTpdfDither(input, { bits: 8, seed: 7 });
    expect(Array.from(input)).toEqual(Array.from(copy));
    expect(output).not.toBe(input);
  });

  it("rejects invalid bits and seeds", () => {
    const input = Float64Array.from([0.25]);
    for (const bits of [0, 25, 4.5, Number.NaN]) {
      expect(() => quantizeWithTpdfDither(input, { bits, seed: 1 })).toThrow(RangeError);
    }
    for (const seed of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => quantizeWithTpdfDither(input, { bits: 8, seed })).toThrow(RangeError);
    }
  });

  it("throws TypeError on non-finite samples", () => {
    expect(() =>
      quantizeWithTpdfDither(Float64Array.from([Number.NaN]), { bits: 8, seed: 1 }),
    ).toThrow(TypeError);
  });
});

describe("quantizationError", () => {
  it("returns original − quantized", () => {
    const original = Float64Array.from([1, -1, 0.5]);
    const quantized = Float64Array.from([0.9, -0.8, 0.4]);
    expect(Array.from(quantizationError(original, quantized))).toEqual([
      1 - 0.9,
      -1 + 0.8,
      0.5 - 0.4,
    ]);
  });

  it("does not mutate its inputs and returns a fresh array", () => {
    const original = Float64Array.from([0.1, 0.2]);
    const quantized = Float64Array.from([0, 0]);
    const originalCopy = Float64Array.from(original);
    const quantizedCopy = Float64Array.from(quantized);
    const output = quantizationError(original, quantized);
    expect(Array.from(original)).toEqual(Array.from(originalCopy));
    expect(Array.from(quantized)).toEqual(Array.from(quantizedCopy));
    expect(output).not.toBe(original);
  });

  it("returns an empty array for empty input", () => {
    expect(quantizationError(new Float64Array(0), new Float64Array(0))).toHaveLength(0);
  });

  it("throws RangeError on a length mismatch and TypeError on non-finite samples", () => {
    expect(() => quantizationError(Float64Array.from([1, 2]), Float64Array.from([1]))).toThrow(
      RangeError,
    );
    expect(() =>
      quantizationError(Float64Array.from([1, Number.NaN]), Float64Array.from([1, 1])),
    ).toThrow(TypeError);
    expect(() =>
      quantizationError(
        Float64Array.from([1, 1]),
        Float64Array.from([1, Number.POSITIVE_INFINITY]),
      ),
    ).toThrow(TypeError);
  });
});
