import { describe, expect, it } from "vitest";
import {
  bitrateKbps,
  compressionRatio,
  generateSine,
  mse,
  mulberry32,
  psnrDb,
  segmentalSnrDb,
  signalEnergy,
  snrDb,
} from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("metrics");

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

function testSamplesOf(goldenCase: GoldenCase): Float64Array {
  return Float64Array.from(asNumberArray(goldenCase.params.testSamples, "params.testSamples"));
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

describe("metrics fixture", () => {
  it("loads the committed metrics fixture with the pinned basic cases", () => {
    expect(golden.algorithm).toBe("metrics");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "mse_sine_vs_quantized_sine",
      "snr_sine_vs_quantized_sine",
      "psnr_sine_vs_quantized_sine_peak1",
      "segmental_snr_silent_frame_partial_tail",
      "entropy_skewed_histogram",
    ]);
  });

  it("pins rtol = 1e-9 and atol = 1e-12", () => {
    for (const goldenCase of golden.cases) {
      expect(goldenCase.tolerance).toEqual({ rtol: 1e-9, atol: 1e-12 });
    }
  });
});

describe("basic metrics (golden)", () => {
  it("matches golden mse for sine vs quantized sine", () => {
    const goldenCase = goldenCaseNamed("mse_sine_vs_quantized_sine");
    const reference = Float64Array.from(goldenCase.input.samples);
    const actual = mse(reference, testSamplesOf(goldenCase));
    expectClose(
      actual,
      asNumber(goldenCase.expected.mse, "expected.mse"),
      goldenCase.tolerance,
      "mse",
    );
  });

  it("matches golden snrDb for sine vs quantized sine", () => {
    const goldenCase = goldenCaseNamed("snr_sine_vs_quantized_sine");
    const reference = Float64Array.from(goldenCase.input.samples);
    const actual = snrDb(reference, testSamplesOf(goldenCase));
    expectClose(
      actual,
      asNumber(goldenCase.expected.snrDb, "expected.snrDb"),
      goldenCase.tolerance,
      "snrDb",
    );
  });

  it("matches golden psnrDb for sine vs quantized sine with peak = 1", () => {
    const goldenCase = goldenCaseNamed("psnr_sine_vs_quantized_sine_peak1");
    const reference = Float64Array.from(goldenCase.input.samples);
    const actual = psnrDb(reference, testSamplesOf(goldenCase), {
      peak: paramNumber(goldenCase, "peak"),
    });
    expectClose(
      actual,
      asNumber(goldenCase.expected.psnrDb, "expected.psnrDb"),
      goldenCase.tolerance,
      "psnrDb",
    );
  });

  it("matches golden segmentalSnrDb with one silent frame and a partial tail", () => {
    const goldenCase = goldenCaseNamed("segmental_snr_silent_frame_partial_tail");
    const reference = Float64Array.from(goldenCase.input.samples);
    const actual = segmentalSnrDb(reference, testSamplesOf(goldenCase), {
      frameLengthSamples: paramNumber(goldenCase, "frameLengthSamples"),
    });
    expectClose(
      actual,
      asNumber(goldenCase.expected.segmentalSnrDb, "expected.segmentalSnrDb"),
      goldenCase.tolerance,
      "segmentalSnrDb",
    );
  });
});

describe("mse", () => {
  it("computes the mean of squared differences", () => {
    expect(mse(Float64Array.from([1, 2, 3]), Float64Array.from([1, 2, 5]))).toBeCloseTo(4 / 3, 15);
  });

  it("returns 0 for identical signals", () => {
    expect(mse(Float64Array.from([1, -2, 3]), Float64Array.from([1, -2, 3]))).toBe(0);
  });

  it("accepts Float32 input and never mutates it", () => {
    const reference = Float32Array.from([1, 2, 3]);
    const test = Float32Array.from([1, 2, 5]);
    expect(mse(reference, test)).toBeCloseTo(4 / 3, 6);
    expect(Array.from(reference)).toEqual([1, 2, 3]);
    expect(Array.from(test)).toEqual([1, 2, 5]);
  });

  it("returns NaN for empty input (documented 0/0 convention)", () => {
    expect(mse(new Float64Array(0), new Float64Array(0))).toBeNaN();
  });

  it("throws RangeError on a length mismatch", () => {
    expect(() => mse(Float64Array.from([1, 2]), Float64Array.from([1]))).toThrow(RangeError);
  });

  it("throws TypeError on non-finite samples", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => mse(Float64Array.from([1, bad]), Float64Array.from([1, 1]))).toThrow(TypeError);
      expect(() => mse(Float64Array.from([1, 1]), Float64Array.from([1, bad]))).toThrow(TypeError);
    }
  });
});

describe("snrDb", () => {
  it("computes 10 log10(sum ref^2 / sum error^2)", () => {
    expect(snrDb(Float64Array.from([1, 1, 1, 1]), Float64Array.from([1, 1, 1, 0]))).toBeCloseTo(
      10 * Math.log10(4),
      12,
    );
  });

  it("returns Infinity for identical nonzero signals", () => {
    expect(snrDb(Float64Array.from([1, 2, 3]), Float64Array.from([1, 2, 3]))).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("returns NaN when both reference and error energies are zero", () => {
    expect(snrDb(new Float64Array(4), new Float64Array(4))).toBeNaN();
  });

  it("returns -Infinity for a silent reference with a nonzero test", () => {
    expect(snrDb(new Float64Array(4), Float64Array.from([0, 1, 0, 0]))).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it("returns 0 dB when the test is silent and the reference is nonzero", () => {
    expect(snrDb(Float64Array.from([0, 1, 0, 0]), new Float64Array(4))).toBe(0);
  });

  it("returns NaN for empty input (documented 0/0 convention)", () => {
    expect(snrDb(new Float64Array(0), new Float64Array(0))).toBeNaN();
  });

  it("throws RangeError on a length mismatch and TypeError on non-finite samples", () => {
    expect(() => snrDb(Float64Array.from([1, 2]), Float64Array.from([1]))).toThrow(RangeError);
    expect(() => snrDb(Float64Array.from([1, Number.NaN]), Float64Array.from([1, 1]))).toThrow(
      TypeError,
    );
    expect(() =>
      snrDb(Float64Array.from([1, 1]), Float64Array.from([1, Number.POSITIVE_INFINITY])),
    ).toThrow(TypeError);
  });
});

describe("segmentalSnrDb", () => {
  it("averages per-frame SNR over active frames", () => {
    const reference = Float64Array.from([1, 1, 2, 2]);
    const test = Float64Array.from([1.1, 0.9, 2.2, 1.8]);
    // Frame 0: ref energy 2, error energy 0.02 -> 20 dB.
    // Frame 1: ref energy 8, error energy 0.08 -> 20 dB.
    expect(segmentalSnrDb(reference, test, { frameLengthSamples: 2 })).toBeCloseTo(20, 12);
  });

  it("skips frames whose reference energy is zero", () => {
    const reference = Float64Array.from([1, 1, 0, 0, 2, 2]);
    const test = Float64Array.from([1.1, 0.9, 99, -99, 2.2, 1.8]);
    expect(segmentalSnrDb(reference, test, { frameLengthSamples: 2 })).toBeCloseTo(20, 12);
  });

  it("includes the partial last frame (R8)", () => {
    const reference = Float64Array.from([1, 1, 1]);
    const test = Float64Array.from([1.1, 0.9, 1.2]);
    // Frame 0 (2 samples): ref energy 2, error energy 0.02 -> 20 dB.
    // Frame 1 (1 sample): ref energy 1, error energy 0.04 -> 13.9794... dB.
    const expected = (20 + 10 * Math.log10(1 / 0.04)) / 2;
    expect(segmentalSnrDb(reference, test, { frameLengthSamples: 2 })).toBeCloseTo(expected, 12);
  });

  it("returns Infinity when no frame is active", () => {
    expect(
      segmentalSnrDb(new Float64Array(8), Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8]), {
        frameLengthSamples: 4,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      segmentalSnrDb(new Float64Array(0), new Float64Array(0), {
        frameLengthSamples: 4,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns Infinity when an active frame has zero error", () => {
    expect(
      segmentalSnrDb(Float64Array.from([1, 1]), Float64Array.from([1, 1]), {
        frameLengthSamples: 2,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("throws RangeError for invalid frame lengths", () => {
    const reference = Float64Array.from([1, 1]);
    for (const frameLengthSamples of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => segmentalSnrDb(reference, reference, { frameLengthSamples })).toThrow(
        RangeError,
      );
    }
    expect(() =>
      segmentalSnrDb(reference, reference, undefined as unknown as { frameLengthSamples: number }),
    ).toThrow(RangeError);
  });

  it("throws RangeError on a length mismatch and TypeError on non-finite samples", () => {
    expect(() =>
      segmentalSnrDb(Float64Array.from([1, 2]), Float64Array.from([1]), {
        frameLengthSamples: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      segmentalSnrDb(Float64Array.from([1, Number.NaN]), Float64Array.from([1, 1]), {
        frameLengthSamples: 1,
      }),
    ).toThrow(TypeError);
    expect(() =>
      segmentalSnrDb(Float64Array.from([1, 1]), Float64Array.from([1, Number.NaN]), {
        frameLengthSamples: 1,
      }),
    ).toThrow(TypeError);
  });
});

describe("psnrDb", () => {
  it("computes 10 log10(peak^2 / mse) and scales with peak", () => {
    const reference = new Float64Array(2);
    const test = Float64Array.from([1, 1]);
    expect(psnrDb(reference, test, { peak: 1 })).toBeCloseTo(0, 12);
    expect(psnrDb(reference, test, { peak: 2 })).toBeCloseTo(10 * Math.log10(4), 12);
  });

  it("returns Infinity for identical signals (mse = 0)", () => {
    expect(
      psnrDb(Float64Array.from([0.5, -0.5]), Float64Array.from([0.5, -0.5]), { peak: 1 }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns NaN for empty input (documented mse NaN)", () => {
    expect(psnrDb(new Float64Array(0), new Float64Array(0), { peak: 1 })).toBeNaN();
  });

  it("requires a finite peak > 0", () => {
    const reference = Float64Array.from([1, 1]);
    for (const peak of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => psnrDb(reference, reference, { peak })).toThrow(RangeError);
    }
    expect(() => psnrDb(reference, reference, undefined as unknown as { peak: number })).toThrow(
      RangeError,
    );
  });

  it("throws RangeError on a length mismatch and TypeError on non-finite samples", () => {
    expect(() => psnrDb(Float64Array.from([1, 2]), Float64Array.from([1]), { peak: 1 })).toThrow(
      RangeError,
    );
    expect(() =>
      psnrDb(Float64Array.from([1, Number.NaN]), Float64Array.from([1, 1]), { peak: 1 }),
    ).toThrow(TypeError);
    expect(() =>
      psnrDb(Float64Array.from([1, 1]), Float64Array.from([1, Number.POSITIVE_INFINITY]), {
        peak: 1,
      }),
    ).toThrow(TypeError);
  });
});

describe("compressionRatio", () => {
  it("divides the original size by the compressed size", () => {
    expect(compressionRatio(1000, 250)).toBe(4);
    expect(compressionRatio(100, 200)).toBe(0.5);
  });

  it("returns Infinity for a zero compressed size", () => {
    expect(compressionRatio(100, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(compressionRatio(100, -0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("rejects invalid byte counts", () => {
    for (const originalBytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => compressionRatio(originalBytes, 10)).toThrow(RangeError);
    }
    for (const compressedBytes of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => compressionRatio(100, compressedBytes)).toThrow(RangeError);
    }
  });
});

describe("bitrateKbps", () => {
  it("uses 1 kbps = 1000 bit/s", () => {
    expect(bitrateKbps(125_000, 10)).toBeCloseTo(100, 12);
  });

  it("returns 0 for zero bytes", () => {
    expect(bitrateKbps(0, 10)).toBe(0);
  });

  it("rejects invalid sizes and durations", () => {
    for (const bytes of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => bitrateKbps(bytes, 10)).toThrow(RangeError);
    }
    for (const durationSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => bitrateKbps(100, durationSeconds)).toThrow(RangeError);
    }
  });
});

describe("snrDb property (seeded Gaussian-ish noise at a known SNR)", () => {
  // Pinned noise transformation: Irwin-Hall approximation, the sum of 12
  // uniforms minus 6. It has mean 0 and variance 1 exactly in distribution
  // (each uniform has variance 1/12), which makes the requested noise power
  // the scale directly. No Gaussian generator is added to the public API.
  function noiseSamples(seed: number, sampleCount: number): Float64Array {
    const random = mulberry32(seed);
    const noise = new Float64Array(sampleCount);
    for (let n = 0; n < sampleCount; n += 1) {
      let sum = 0;
      for (let draw = 0; draw < 12; draw += 1) {
        sum += random();
      }
      noise[n] = sum - 6;
    }
    return noise;
  }

  it("recovers the requested SNR within +/- 0.1 dB", () => {
    const sampleRateHz = 48000;
    const sampleCount = 48000;
    const reference = generateSine({
      durationSeconds: 1,
      sampleRateHz,
      frequencyHz: 440,
      amplitude: 1,
    });
    const signalPower = signalEnergy(reference) / sampleCount;
    const noise = noiseSamples(20261020, sampleCount);

    for (const requestedSnrDb of [0, 10, 20, 30]) {
      const targetNoisePower = signalPower / 10 ** (requestedSnrDb / 10);
      const noiseScale = Math.sqrt(targetNoisePower);
      const test = new Float64Array(sampleCount);
      for (let n = 0; n < sampleCount; n += 1) {
        test[n] = (reference[n] ?? 0) + noiseScale * (noise[n] ?? 0);
      }
      const recoveredSnrDb = snrDb(reference, test);
      expect(
        Math.abs(recoveredSnrDb - requestedSnrDb),
        `requested ${requestedSnrDb} dB, recovered ${recoveredSnrDb} dB`,
      ).toBeLessThanOrEqual(0.1);
    }
  });
});
