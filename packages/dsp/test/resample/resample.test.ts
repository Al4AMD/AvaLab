import { describe, expect, it } from "vitest";
import {
  designLowpassSinc,
  energyOf,
  fft,
  generateSine,
  type ResampleFilter,
  resampleRational,
} from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("resample");

const BETA = 8.6;

function paramNumber(goldenCase: GoldenCase, key: string): number {
  return asNumber(goldenCase.params[key], `params.${key} of ${goldenCase.name}`);
}

function paramFilter(goldenCase: GoldenCase): ResampleFilter {
  const value = goldenCase.params.filter;
  if (value !== "kaiserSinc" && value !== "none") {
    throw new Error(`unexpected filter ${String(value)} in ${goldenCase.name}`);
  }
  return value;
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

function dominantFrequencyHz(samples: Float64Array, sampleRateHz: number): number {
  const spectrum = fft(samples);
  const binCount = spectrum.re.length;
  let peakBin = 1;
  let peakPower = Number.NEGATIVE_INFINITY;
  for (let bin = 1; bin < binCount / 2; bin += 1) {
    const re = spectrum.re[bin] ?? 0;
    const im = spectrum.im[bin] ?? 0;
    const power = re * re + im * im;
    if (power > peakPower) {
      peakPower = power;
      peakBin = bin;
    }
  }
  return (peakBin * sampleRateHz) / binCount;
}

describe("resample fixture", () => {
  it("loads the committed resample fixture in stable order", () => {
    expect(golden.algorithm).toBe("resample");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "resample_48000_to_24000_sine5000hz",
      "resample_44100_to_48000_sine1000hz",
      "resample_48000_to_8000_sine1000hz",
    ]);
    for (const goldenCase of golden.cases) {
      expect(goldenCase.tolerance.rtol).toBe(1e-7);
      expect(goldenCase.tolerance.atol).toBe(1e-12);
    }
  });
});

describe("designLowpassSinc", () => {
  it("returns 2*halfLengthSamples+1 taps with unity sum and even symmetry", () => {
    const taps = designLowpassSinc({
      cutoffNormalized: 0.5,
      halfLengthSamples: 16,
      beta: BETA,
    });

    expect(taps.length).toBe(2 * 16 + 1);
    let sum = 0;
    for (const tap of taps) {
      expect(Number.isFinite(tap)).toBe(true);
      sum += tap;
    }
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-12);

    const centre = 16;
    expect(taps[centre] ?? 0).toBeGreaterThan(0);
    for (let k = 0; k < taps.length; k += 1) {
      expect(Math.abs((taps[k] ?? 0) - (taps[taps.length - 1 - k] ?? 0))).toBeLessThanOrEqual(
        1e-15,
      );
    }
  });

  it("uses the symmetric Kaiser window (beta 0 degenerates to a rectangular taper)", () => {
    const rectangular = designLowpassSinc({
      cutoffNormalized: 0.25,
      halfLengthSamples: 4,
      beta: 0,
    });
    // With beta = 0 the window is 1 everywhere, so the taps are the plain
    // truncated sinc values renormalized to unity DC gain.
    const normalizedSinc = (value: number): number =>
      value === 0 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);
    const offsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
    const raw = offsets.map((offset) => 0.25 * normalizedSinc(0.25 * offset));
    const rawSum = raw.reduce((total, value) => total + value, 0);
    for (let k = 0; k < rectangular.length; k += 1) {
      expect(Math.abs((rectangular[k] ?? 0) - (raw[k] ?? 0) / rawSum)).toBeLessThanOrEqual(1e-12);
    }
  });

  it("guards the cutoff, half-length and beta domains", () => {
    const valid = { cutoffNormalized: 0.5, halfLengthSamples: 16, beta: BETA };
    for (const cutoffNormalized of [0, -0.25, 1.0001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => designLowpassSinc({ ...valid, cutoffNormalized })).toThrow(RangeError);
    }
    for (const halfLengthSamples of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => designLowpassSinc({ ...valid, halfLengthSamples })).toThrow(RangeError);
    }
    for (const beta of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => designLowpassSinc({ ...valid, beta })).toThrow(RangeError);
    }
    expect(() => designLowpassSinc({ ...valid, cutoffNormalized: 1 })).not.toThrow();
    expect(() => designLowpassSinc({ ...valid, halfLengthSamples: 1, beta: 0 })).not.toThrow();
  });
});

describe("resampleRational (golden)", () => {
  it.each(golden.cases)("matches the scipy reference for $name", (goldenCase: GoldenCase) => {
    const inputRateHz = paramNumber(goldenCase, "inputRateHz");
    const outputRateHz = paramNumber(goldenCase, "outputRateHz");
    const input = Float64Array.from(goldenCase.input.samples);
    const expected = expectedSamplesOf(goldenCase);

    const actual = resampleRational(input, {
      inputRateHz,
      outputRateHz,
      filter: paramFilter(goldenCase),
    });

    expect(actual.length).toBe(Math.round((input.length * outputRateHz) / inputRateHz));
    expectSamplesClose(actual, expected, goldenCase.tolerance, goldenCase.name);
  });
});

describe("resampleRational aliasing demo (filter: none)", () => {
  const inputRateHz = 16000;
  const outputRateHz = 8000;
  const aliasFrequencyHz = 2000;

  function inputTone(): Float64Array {
    return generateSine({
      durationSeconds: 0.05,
      sampleRateHz: inputRateHz,
      frequencyHz: 6000,
      amplitude: 0.9,
    });
  }

  it("folds a 6 kHz tone to exactly 2 kHz when decimating 2x without a filter", () => {
    const input = inputTone();
    const decimated = resampleRational(input, {
      inputRateHz,
      outputRateHz,
      filter: "none",
    });

    expect(decimated.length).toBe(400);
    // R4 pins the nearest-sample rule; at exactly 2x this is x[2n].
    for (let n = 0; n < decimated.length; n += 1) {
      expect(decimated[n]).toBe(input[2 * n]);
    }

    const peakHz = dominantFrequencyHz(decimated, outputRateHz);
    expect(Math.abs(peakHz - aliasFrequencyHz)).toBeLessThanOrEqual(10);
  });

  it("removes above-Nyquist energy with the kaiserSinc filter", () => {
    const input = inputTone();
    const unfiltered = resampleRational(input, {
      inputRateHz,
      outputRateHz,
      filter: "none",
    });
    const filtered = resampleRational(input, {
      inputRateHz,
      outputRateHz,
      filter: "kaiserSinc",
    });

    expect(filtered.length).toBe(unfiltered.length);
    expect(energyOf(filtered)).toBeLessThan(0.01 * energyOf(unfiltered));
  });
});

describe("resampleRational properties and edges", () => {
  it("returns an exact fresh copy at equal rates for both modes", () => {
    const input = Float64Array.from([1, -0.5, 0.25, 0, -1]);
    for (const filter of ["kaiserSinc", "none"] as const) {
      const output = resampleRational(input, {
        inputRateHz: 48000,
        outputRateHz: 48000,
        filter,
      });
      expect(output).not.toBe(input);
      expect(Array.from(output)).toEqual(Array.from(input));
    }
  });

  it("preserves duration to within one output sample", () => {
    const pairs: Array<[number, number]> = [
      [48000, 24000],
      [44100, 48000],
      [48000, 8000],
      [48000, 44100],
      [8000, 16000],
    ];
    for (const [inputRateHz, outputRateHz] of pairs) {
      const input = generateSine({
        durationSeconds: 0.03,
        sampleRateHz: inputRateHz,
        frequencyHz: 440,
        amplitude: 0.5,
      });
      for (const filter of ["kaiserSinc", "none"] as const) {
        const output = resampleRational(input, { inputRateHz, outputRateHz, filter });
        expect(output.length).toBe(Math.round((input.length * outputRateHz) / inputRateHz));
        const inputDurationS = input.length / inputRateHz;
        const outputDurationS = output.length / outputRateHz;
        expect(Math.abs(outputDurationS - inputDurationS)).toBeLessThanOrEqual(1 / outputRateHz);
      }
    }
  });

  it("handles extreme integer rates and empty results", () => {
    // Downsampling to 1 Hz rounds the output length to zero for a short input.
    expect(
      resampleRational(new Float64Array([1]), {
        inputRateHz: 48000,
        outputRateHz: 1,
        filter: "kaiserSinc",
      }).length,
    ).toBe(0);
    // Upsampling 1 -> 2 with the pinned half-up sample rule.
    expect(
      Array.from(
        resampleRational(Float64Array.from([1, 2, 3]), {
          inputRateHz: 1,
          outputRateHz: 2,
          filter: "none",
        }),
      ),
    ).toEqual([1, 2, 2, 3, 3, 3]);
    // The filtered path is allowed at tiny rates too.
    const filtered = resampleRational(Float64Array.from([1, -1, 0.5]), {
      inputRateHz: 1,
      outputRateHz: 2,
      filter: "kaiserSinc",
    });
    expect(filtered.length).toBe(6);
    expect(filtered.every((value) => Number.isFinite(value))).toBe(true);
    for (const filter of ["kaiserSinc", "none"] as const) {
      expect(
        resampleRational(new Float64Array(0), {
          inputRateHz: 48000,
          outputRateHz: 8000,
          filter,
        }).length,
      ).toBe(0);
    }
  });

  it("guards the rates, filter, samples and safe output length", () => {
    const input = Float64Array.from([1, 0, -1]);
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        resampleRational(input, { inputRateHz: rate, outputRateHz: 8000, filter: "none" }),
      ).toThrow(RangeError);
      expect(() =>
        resampleRational(input, { inputRateHz: 48000, outputRateHz: rate, filter: "none" }),
      ).toThrow(RangeError);
    }
    expect(() =>
      resampleRational(input, {
        inputRateHz: 44100.5,
        outputRateHz: 48000,
        filter: "kaiserSinc",
      }),
    ).toThrow(RangeError);
    expect(() =>
      resampleRational(input, {
        inputRateHz: 48000,
        outputRateHz: 8000,
        filter: "bogus" as ResampleFilter,
      }),
    ).toThrow(RangeError);
    expect(() =>
      resampleRational(Float64Array.from([1, Number.NaN]), {
        inputRateHz: 48000,
        outputRateHz: 8000,
        filter: "none",
      }),
    ).toThrow(TypeError);
    expect(() =>
      resampleRational(new Float64Array(2), {
        inputRateHz: 1,
        outputRateHz: Number.MAX_SAFE_INTEGER,
        filter: "none",
      }),
    ).toThrow(RangeError);
    // Empty input is still rate-validated: non-integer rates differ -> RangeError.
    expect(() =>
      resampleRational(new Float64Array(0), {
        inputRateHz: 44100.5,
        outputRateHz: 48000,
        filter: "none",
      }),
    ).toThrow(RangeError);
    // Output length is safe, but (outputLength - 1) * inputRateHz is not.
    expect(() =>
      resampleRational(new Float64Array(2), {
        inputRateHz: 2 ** 26,
        outputRateHz: 2 ** 53,
        filter: "none",
      }),
    ).toThrow(RangeError);
  });
});
