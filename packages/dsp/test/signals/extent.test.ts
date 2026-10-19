import { describe, expect, it } from "vitest";
import {
  averagePower,
  classifySignalType,
  fft,
  reverse,
  signalEnergy,
  support,
  timeScale,
  timeShift,
  truncate,
  zeroPad,
} from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("extent");

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

function paramNumber(goldenCase: GoldenCase, key: string): number {
  return asNumber(goldenCase.params[key], `params.${key} of ${goldenCase.name}`);
}

function paramOperation(goldenCase: GoldenCase): string {
  const value = goldenCase.params.operation;
  if (typeof value !== "string") {
    throw new Error(`params.operation of ${goldenCase.name} is not a string`);
  }
  return value;
}

function runSampleOperation(goldenCase: GoldenCase): Float64Array {
  const samples = Float64Array.from(goldenCase.input.samples);
  switch (paramOperation(goldenCase)) {
    case "timeShift":
      return timeShift(samples, paramNumber(goldenCase, "shiftSamples"));
    case "timeScale":
      return timeScale(samples, paramNumber(goldenCase, "factor"));
    case "reverse":
      return reverse(samples);
    case "truncate":
      return truncate(
        samples,
        paramNumber(goldenCase, "startSampleIndex"),
        paramNumber(goldenCase, "lengthSamples"),
      );
    case "zeroPad":
      return zeroPad(
        samples,
        paramNumber(goldenCase, "padStartSamples"),
        paramNumber(goldenCase, "padEndSamples"),
      );
    default:
      throw new Error(`unsupported sample operation ${paramOperation(goldenCase)}`);
  }
}

function magnitudeSpectrum(samples: Float64Array): Float64Array {
  const spectrum = fft(samples);
  const magnitudes = new Float64Array(spectrum.re.length);
  for (let k = 0; k < magnitudes.length; k += 1) {
    const real = spectrum.re[k] ?? 0;
    const imaginary = spectrum.im[k] ?? 0;
    magnitudes[k] = Math.hypot(real, imaginary);
  }
  return magnitudes;
}

describe("extent fixture", () => {
  it("loads the committed extent fixture with the pinned cases", () => {
    expect(golden.algorithm).toBe("extent");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "time_shift_plus3_ramp10",
      "time_shift_minus3_ramp10",
      "time_scale_half_ramp10",
      "time_scale_double_ramp10",
      "reverse_ramp10",
      "truncate_ramp10_start2_length5",
      "truncate_ramp10_start8_length5_clamped",
      "zero_pad_ramp10_start2_end3",
      "support_nonzero_threshold0",
      "support_silence_threshold0",
      "support_threshold_strict_0.5",
    ]);
  });

  it("pins rtol = 1e-12 and atol = 0 (exact arithmetic expected)", () => {
    for (const goldenCase of golden.cases) {
      expect(goldenCase.tolerance).toEqual({ rtol: 1e-12, atol: 0 });
    }
  });
});

describe("extent operations (golden)", () => {
  const sampleCases = golden.cases.filter(
    (goldenCase) => goldenCase.expected.samples !== undefined,
  );
  const supportCases = golden.cases.filter(
    (goldenCase) => goldenCase.expected.samples === undefined,
  );

  it.each(sampleCases)("matches golden samples for $name", (goldenCase: GoldenCase) => {
    const expected = asNumberArray(goldenCase.expected.samples, "expected.samples");
    const actual = runSampleOperation(goldenCase);

    expect(actual.length).toBe(expected.length);
    expected.forEach((value, n) => {
      expectClose(valueAt(actual, n), value, goldenCase.tolerance, `y[${n}]`);
    });
  });

  it.each(supportCases)("matches golden support for $name", (goldenCase: GoldenCase) => {
    const samples = Float64Array.from(goldenCase.input.samples);
    const actual = support(samples, { threshold: paramNumber(goldenCase, "threshold") });
    expect(actual.startSampleIndex).toBe(
      asNumber(goldenCase.expected.startSampleIndex, "expected.startSampleIndex"),
    );
    expect(actual.endSampleIndex).toBe(
      asNumber(goldenCase.expected.endSampleIndex, "expected.endSampleIndex"),
    );
  });
});

describe("timeShift", () => {
  const ramp = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it("returns the same length and zero-fills beyond the edges", () => {
    const delayed = timeShift(ramp, 3);
    const advanced = timeShift(ramp, -3);
    expect(delayed.length).toBe(ramp.length);
    expect(advanced.length).toBe(ramp.length);
    expect(Array.from(delayed)).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 5, 6]);
    expect(Array.from(advanced)).toEqual([3, 4, 5, 6, 7, 8, 9, 0, 0, 0]);
  });

  it("preserves the |FFT| when the shifted signal stays inside the window", () => {
    // Zero-padding margins make the zero-filled shift a true time shift of a
    // finite signal, so the DFT magnitude theorem applies exactly.
    const samples = new Float64Array(64);
    for (let n = 16; n < 48; n += 1) {
      samples[n] = Math.sin((2 * Math.PI * 3 * n) / 64) + (0.25 * (n - 16)) / 32;
    }
    const reference = magnitudeSpectrum(samples);

    for (const shift of [-5, -3, 3, 5]) {
      const shifted = magnitudeSpectrum(timeShift(samples, shift));
      expect(shifted.length).toBe(reference.length);
      for (let k = 0; k < reference.length; k += 1) {
        const expected = valueAt(reference, k, "reference magnitude");
        expectClose(
          valueAt(shifted, k, "shifted magnitude"),
          expected,
          { rtol: 1e-12, atol: 1e-12 },
          `bin ${k}`,
        );
      }
    }
  });

  it("returns all zeros when the shift exceeds the length and never round-trips", () => {
    expect(Array.from(timeShift(ramp, 100))).toEqual(Array.from(new Float64Array(ramp.length)));
    expect(Array.from(timeShift(ramp, -100))).toEqual(Array.from(new Float64Array(ramp.length)));
  });

  it("returns an empty array for empty input", () => {
    expect(timeShift(new Float64Array(0), 3).length).toBe(0);
  });

  const invalidShifts: Array<[string, number]> = [
    ["1.5", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ];

  it.each(invalidShifts)("throws RangeError for shiftSamples = %s", (_label, shift) => {
    expect(() => timeShift(ramp, shift)).toThrow(RangeError);
  });
});

describe("timeScale", () => {
  const ramp = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it("factor 0.5 halves the speed and doubles the duration", () => {
    const stretched = timeScale(ramp, 0.5);
    expect(stretched.length).toBe(20);
    // Even output samples land exactly on input samples; odd samples are the
    // midpoint interpolants.
    expect(Array.from(stretched)).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9,
    ]);
  });

  it("factor 2 doubles the speed and halves the duration", () => {
    const compressed = timeScale(ramp, 2);
    expect(compressed.length).toBe(5);
    expect(Array.from(compressed)).toEqual([0, 2, 4, 6, 8]);
  });

  it("clamps positions past the last input sample instead of wrapping", () => {
    const stretched = timeScale(Float64Array.from([0, 10]), 0.25);
    // positions 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75 -> last two clamp to 10.
    expect(Array.from(stretched)).toEqual([0, 2.5, 5, 7.5, 10, 10, 10, 10]);
  });

  it("returns an empty array for empty input", () => {
    expect(timeScale(new Float64Array(0), 0.5).length).toBe(0);
  });

  const invalidFactors: Array<[string, number]> = [
    ["0", 0],
    ["-1", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["1e-300 (unsafe output length)", 1e-300],
  ];

  it.each(invalidFactors)("throws RangeError for factor = %s", (_label, factor) => {
    expect(() => timeScale(ramp, factor)).toThrow(RangeError);
  });
});

describe("reverse", () => {
  const samples = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it("reverses sample order", () => {
    expect(Array.from(reverse(samples))).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it("is an involution: reverse(reverse(x)) = x", () => {
    expect(Array.from(reverse(reverse(samples)))).toEqual(Array.from(samples));
    expect(reverse(reverse(samples))).not.toBe(samples);
  });

  it("returns an empty array for empty input", () => {
    expect(reverse(new Float64Array(0)).length).toBe(0);
  });
});

describe("truncate", () => {
  const ramp = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it("returns exactly the requested window", () => {
    expect(Array.from(truncate(ramp, 2, 5))).toEqual([2, 3, 4, 5, 6]);
  });

  it("clamps the end to the available samples (no zero-fill)", () => {
    expect(Array.from(truncate(ramp, 8, 5))).toEqual([8, 9]);
    expect(Array.from(truncate(ramp, 8, 200))).toEqual([8, 9]);
  });

  it("accepts start = N and length 0 as empty windows", () => {
    expect(truncate(ramp, 10, 5).length).toBe(0);
    expect(truncate(ramp, 3, 0).length).toBe(0);
  });

  it("returns an empty array for empty input", () => {
    expect(truncate(new Float64Array(0), 0, 5).length).toBe(0);
  });

  const invalidRanges: Array<[string, number, number]> = [
    ["start < 0", -1, 2],
    ["start > N", 11, 2],
    ["start non-integer", 1.5, 2],
    ["start NaN", Number.NaN, 2],
    ["start Infinity", Number.POSITIVE_INFINITY, 2],
    ["length < 0", 0, -1],
    ["length non-integer", 0, 1.5],
    ["length NaN", 0, Number.NaN],
    ["length Infinity", 0, Number.POSITIVE_INFINITY],
  ];

  it.each(invalidRanges)("throws RangeError for %s", (_label, start, length) => {
    expect(() => truncate(ramp, start, length)).toThrow(RangeError);
  });
});

describe("zeroPad", () => {
  const ramp = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it("adds exactly padStart + padEnd samples and preserves the signal", () => {
    const padded = zeroPad(ramp, 2, 3);
    expect(padded.length).toBe(ramp.length + 2 + 3);
    expect(Array.from(padded)).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0]);
  });

  it("pads empty input to exactly the requested length", () => {
    const padded = zeroPad(new Float64Array(0), 2, 3);
    expect(padded.length).toBe(5);
    expect(Array.from(padded)).toEqual([0, 0, 0, 0, 0]);
  });

  it("is a no-op length-wise with zero pads", () => {
    expect(Array.from(zeroPad(ramp, 0, 0))).toEqual(Array.from(ramp));
  });

  const invalidPads: Array<[string, number, number]> = [
    ["start < 0", -1, 0],
    ["end < 0", 0, -1],
    ["start non-integer", 1.5, 0],
    ["end non-integer", 0, 1.5],
    ["start NaN", Number.NaN, 0],
    ["end Infinity", 0, Number.POSITIVE_INFINITY],
  ];

  it.each(invalidPads)("throws RangeError for %s", (_label, start, end) => {
    expect(() => zeroPad(ramp, start, end)).toThrow(RangeError);
  });
});

describe("support", () => {
  it("returns the first and last nonzero indices (inclusive)", () => {
    const samples = Float64Array.from([0, 0, 1, -2, 0, 3, 0, 0, 0, 0]);
    expect(support(samples, { threshold: 0 })).toEqual({
      startSampleIndex: 2,
      endSampleIndex: 5,
    });
  });

  it("returns the empty support {N, N-1} for silence", () => {
    const silence = new Float64Array(10);
    expect(support(silence, { threshold: 0 })).toEqual({
      startSampleIndex: 10,
      endSampleIndex: 9,
    });
  });

  it("uses a strict comparison: |x[n]| == threshold is outside the support", () => {
    const samples = Float64Array.from([0, 0.5, 0.75, -0.5, 0.25]);
    expect(support(samples, { threshold: 0.5 })).toEqual({
      startSampleIndex: 2,
      endSampleIndex: 2,
    });
  });

  it("returns the empty support for an empty signal", () => {
    expect(support(new Float64Array(0), { threshold: 0 })).toEqual({
      startSampleIndex: 0,
      endSampleIndex: -1,
    });
  });

  const invalidThresholds: Array<[string, number]> = [
    ["-0.1", -0.1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ];

  it.each(invalidThresholds)("throws RangeError for threshold = %s", (_label, threshold) => {
    const samples = Float64Array.from([1, 0, -1]);
    expect(() => support(samples, { threshold })).toThrow(RangeError);
  });
});

describe("classifySignalType, signalEnergy and averagePower", () => {
  it("classifies an impulse as an energy signal", () => {
    const impulse = Float64Array.from([0, 0, 1, 0]);
    expect(signalEnergy(impulse)).toBe(1);
    expect(averagePower(impulse)).toBe(0.25);
    expect(classifySignalType(impulse)).toBe("energy");
  });

  it("classifies a constant spanning the window as a power signal", () => {
    const constant = new Float64Array(4).fill(2);
    expect(signalEnergy(constant)).toBe(16);
    expect(averagePower(constant)).toBe(4);
    expect(classifySignalType(constant)).toBe("power");
  });

  it("treats silence and empty input as power signals with zero energy and power", () => {
    const silence = new Float64Array(4);
    expect(signalEnergy(silence)).toBe(0);
    expect(averagePower(silence)).toBe(0);
    expect(classifySignalType(silence)).toBe("power");

    const empty = new Float64Array(0);
    expect(signalEnergy(empty)).toBe(0);
    expect(averagePower(empty)).toBe(0);
    expect(classifySignalType(empty)).toBe("power");
  });

  it("classifies a windowed transient as an energy signal", () => {
    const transient = Float64Array.from([0, 1, 2, 0]);
    expect(signalEnergy(transient)).toBe(5);
    expect(averagePower(transient)).toBe(1.25);
    expect(classifySignalType(transient)).toBe("energy");
  });

  it("accepts Float32 input and accumulates in Float64", () => {
    const samples = Float32Array.from([0.5, -0.5, 1]);
    expect(signalEnergy(samples)).toBeCloseTo(1.5, 15);
    expect(averagePower(samples)).toBeCloseTo(0.5, 15);
  });
});

describe("extent guards", () => {
  it("throws TypeError for non-finite samples in every operation", () => {
    const bad = Float64Array.from([0, Number.NaN, 1]);
    const infinite = Float64Array.from([0, Number.POSITIVE_INFINITY, 1]);
    const calls: Array<(samples: Float64Array) => unknown> = [
      (samples) => timeShift(samples, 1),
      (samples) => timeScale(samples, 2),
      (samples) => reverse(samples),
      (samples) => truncate(samples, 0, 2),
      (samples) => zeroPad(samples, 1, 1),
      (samples) => support(samples, { threshold: 0 }),
      (samples) => classifySignalType(samples),
      (samples) => signalEnergy(samples),
      (samples) => averagePower(samples),
    ];

    for (const call of calls) {
      expect(() => call(bad)).toThrow(TypeError);
      expect(() => call(infinite)).toThrow(TypeError);
    }
  });

  it("does not mutate its input", () => {
    const samples = Float64Array.from([0, 1, 2, 3, 4]);
    const copy = Float64Array.from(samples);

    timeShift(samples, 2);
    timeScale(samples, 0.5);
    reverse(samples);
    truncate(samples, 1, 2);
    zeroPad(samples, 1, 1);
    support(samples, { threshold: 0 });
    classifySignalType(samples);
    signalEnergy(samples);
    averagePower(samples);

    expect(Array.from(samples)).toEqual(Array.from(copy));
  });
});
