import { describe, expect, it } from "vitest";
import {
  type Complex,
  fft,
  generateAm,
  generateChirp,
  generateFm,
  generateImpulse,
  generateSawtooth,
  generateSine,
  generateSquare,
  generateStep,
  generateTriangle,
  generateTwoTone,
  type SignalSpec,
} from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("generators");
const TAU = 2 * Math.PI;

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

function dominantFrequencyHz(window: Float64Array, sampleRateHz: number): number {
  const spectrum: Complex = fft(window);
  const binCount = spectrum.re.length;
  let peakBin = 0;
  let peakPower = Number.NEGATIVE_INFINITY;
  for (let bin = 1; bin < binCount / 2; bin += 1) {
    const re = valueAt(spectrum.re, bin, "chirp spectrum re");
    const im = valueAt(spectrum.im, bin, "chirp spectrum im");
    const power = re * re + im * im;
    if (power > peakPower) {
      peakPower = power;
      peakBin = bin;
    }
  }
  return (peakBin * sampleRateHz) / binCount;
}

function expectChirpEndpoints(sweep: "linear" | "logarithmic"): void {
  const sampleRateHz = 8000;
  const durationSeconds = 4;
  const windowLength = 512;
  const startFrequencyHz = 500;
  const endFrequencyHz = 2000;
  const toleranceHz = (2 * sampleRateHz) / windowLength;

  const chirp = generateChirp({
    durationSeconds,
    sampleRateHz,
    startFrequencyHz,
    endFrequencyHz,
    sweep,
  });
  const startPeakHz = dominantFrequencyHz(chirp.slice(0, windowLength), sampleRateHz);
  const endPeakHz = dominantFrequencyHz(chirp.slice(chirp.length - windowLength), sampleRateHz);

  expect(
    Math.abs(startPeakHz - startFrequencyHz),
    `${sweep} start peak ${startPeakHz} Hz`,
  ).toBeLessThanOrEqual(toleranceHz);
  expect(
    Math.abs(endPeakHz - endFrequencyHz),
    `${sweep} end peak ${endPeakHz} Hz`,
  ).toBeLessThanOrEqual(toleranceHz);
}

function paramNumber(goldenCase: GoldenCase, key: string): number {
  return asNumber(goldenCase.params[key], `params.${key} of ${goldenCase.name}`);
}

function paramSweep(goldenCase: GoldenCase): "linear" | "logarithmic" {
  const value = goldenCase.params.sweep;
  if (value === "linear" || value === "logarithmic") {
    return value;
  }
  throw new Error(`golden sweep is not a chirp sweep: ${String(value)}`);
}

function paramPair(goldenCase: GoldenCase, key: string): [number, number] {
  const value = goldenCase.params[key];
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`golden params.${key} of ${goldenCase.name} is not a pair`);
  }
  return [
    asNumber(value[0], `params.${key}[0] of ${goldenCase.name}`),
    asNumber(value[1], `params.${key}[1] of ${goldenCase.name}`),
  ];
}

function specOf(goldenCase: GoldenCase): SignalSpec {
  return {
    durationSeconds: paramNumber(goldenCase, "durationSeconds"),
    sampleRateHz: paramNumber(goldenCase, "sampleRateHz"),
  };
}

function generateFromGolden(goldenCase: GoldenCase): Float64Array {
  const generator = goldenCase.params.generator;
  if (typeof generator !== "string") {
    throw new Error(`golden params.generator of ${goldenCase.name} is not a string`);
  }
  const spec = specOf(goldenCase);
  switch (generator) {
    case "sine":
      return generateSine({
        ...spec,
        frequencyHz: paramNumber(goldenCase, "frequencyHz"),
        amplitude: paramNumber(goldenCase, "amplitude"),
      });
    case "square":
      return generateSquare({
        ...spec,
        frequencyHz: paramNumber(goldenCase, "frequencyHz"),
        amplitude: paramNumber(goldenCase, "amplitude"),
        dutyCycle: paramNumber(goldenCase, "dutyCycle"),
      });
    case "sawtooth":
      return generateSawtooth({
        ...spec,
        frequencyHz: paramNumber(goldenCase, "frequencyHz"),
        amplitude: paramNumber(goldenCase, "amplitude"),
      });
    case "triangle":
      return generateTriangle({
        ...spec,
        frequencyHz: paramNumber(goldenCase, "frequencyHz"),
        amplitude: paramNumber(goldenCase, "amplitude"),
      });
    case "impulse":
      return generateImpulse({
        ...spec,
        impulseSampleIndex: paramNumber(goldenCase, "impulseSampleIndex"),
        amplitude: paramNumber(goldenCase, "amplitude"),
      });
    case "step":
      return generateStep({
        ...spec,
        stepSampleIndex: paramNumber(goldenCase, "stepSampleIndex"),
        amplitudeBefore: paramNumber(goldenCase, "amplitudeBefore"),
        amplitudeAfter: paramNumber(goldenCase, "amplitudeAfter"),
      });
    case "chirp":
      return generateChirp({
        ...spec,
        startFrequencyHz: paramNumber(goldenCase, "startFrequencyHz"),
        endFrequencyHz: paramNumber(goldenCase, "endFrequencyHz"),
        sweep: paramSweep(goldenCase),
      });
    case "twoTone":
      return generateTwoTone({
        ...spec,
        frequenciesHz: paramPair(goldenCase, "frequenciesHz"),
        amplitude: paramNumber(goldenCase, "amplitude"),
      });
    case "am":
      return generateAm({
        ...spec,
        carrierHz: paramNumber(goldenCase, "carrierHz"),
        modulationHz: paramNumber(goldenCase, "modulationHz"),
        modulationIndex: paramNumber(goldenCase, "modulationIndex"),
        amplitude: paramNumber(goldenCase, "amplitude"),
      });
    case "fm":
      return generateFm({
        ...spec,
        carrierHz: paramNumber(goldenCase, "carrierHz"),
        modulationHz: paramNumber(goldenCase, "modulationHz"),
        frequencyDeviationHz: paramNumber(goldenCase, "frequencyDeviationHz"),
        amplitude: paramNumber(goldenCase, "amplitude"),
      });
    default:
      throw new Error(`golden generator is not a known generator: ${generator}`);
  }
}

describe("generators fixture", () => {
  it("loads the committed generators fixture", () => {
    expect(golden.algorithm).toBe("generators");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "sine_100hz_amplitude0.5",
      "square_100hz_amplitude0.75_duty0.25",
      "sawtooth_100hz_amplitude0.5",
      "triangle_100hz_amplitude0.5",
      "impulse_index3_amplitude0.75",
      "step_index4_before-0.25_after0.5",
      "chirp_linear_100to400hz",
      "chirp_logarithmic_100to400hz",
      "two_tone_100_250hz_amplitude0.5",
      "am_carrier100_mod10_index0.5_amplitude0.75",
      "fm_carrier100_mod10_deviation25_amplitude0.75",
    ]);
  });
});

describe("signal generators (golden)", () => {
  it.each(golden.cases)("matches golden samples for $name", (goldenCase: GoldenCase) => {
    const expected = asNumberArray(goldenCase.expected.samples, "expected.samples");
    const actual = generateFromGolden(goldenCase);

    expect(actual.length).toBe(expected.length);
    expected.forEach((value, n) => {
      expectClose(valueAt(actual, n), value, goldenCase.tolerance, `x[${n}]`);
    });
  });
});

describe("generator boundary samples", () => {
  it("sine starts at exactly 0 for phase 0 and reaches the amplitude at phase pi/2", () => {
    const spec: SignalSpec = { durationSeconds: 1, sampleRateHz: 1000 };
    const sine = generateSine({ ...spec, frequencyHz: 10, amplitude: 2 });
    expect(valueAt(sine, 0)).toBe(0);
    expectClose(
      valueAt(sine, 1),
      2 * Math.sin((TAU * 10) / 1000),
      { rtol: 0, atol: 1e-15 },
      "x[1]",
    );

    const quarterTurn = generateSine({
      ...spec,
      frequencyHz: 10,
      amplitude: 2,
      phaseRad: Math.PI / 2,
    });
    expect(valueAt(quarterTurn, 0)).toBe(2);
  });

  it("square pins both zero crossings of a period to +amplitude (sign(sin) with sign(0) = +1)", () => {
    const square = generateSquare({
      durationSeconds: 1,
      sampleRateHz: 1000,
      frequencyHz: 100,
      amplitude: 1.5,
    });
    // 100 Hz at 1000 Hz is exactly 10 samples per period: phase 0 and the
    // half-period sample 5 are the two zeros of sin in one period.
    expect(valueAt(square, 0)).toBe(1.5);
    expect(valueAt(square, 5)).toBe(1.5);
    expect(valueAt(square, 6)).toBe(-1.5);
    expect(valueAt(square, 10)).toBe(1.5);
  });

  it("square honours a custom duty cycle and the full-duty edge", () => {
    const spec: SignalSpec = { durationSeconds: 0.01, sampleRateHz: 1000 };
    const quarterDuty = generateSquare({
      ...spec,
      frequencyHz: 100,
      amplitude: 2,
      dutyCycle: 0.25,
    });
    // Phases 0, 0.1, 0.2 are high (<= 0.25), phase 0.3 onward is low.
    expect(Array.from(quarterDuty)).toEqual([2, 2, 2, -2, -2, -2, -2, -2, -2, -2]);

    const fullDuty = generateSquare({ ...spec, frequencyHz: 100, amplitude: 1, dutyCycle: 1 });
    expect(Array.from(fullDuty)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("sawtooth starts at -amplitude and stays in [-amplitude, amplitude)", () => {
    const sawtooth = generateSawtooth({
      durationSeconds: 0.1,
      sampleRateHz: 1000,
      frequencyHz: 100,
      amplitude: 2,
    });
    expect(valueAt(sawtooth, 0)).toBe(-2);
    expectClose(valueAt(sawtooth, 9), 1.6, { rtol: 0, atol: 1e-12 }, "x[9]");
    for (let n = 0; n < sawtooth.length; n += 1) {
      const sample = valueAt(sawtooth, n);
      expect(sample).toBeGreaterThanOrEqual(-2);
      expect(sample).toBeLessThan(2);
    }
  });

  it("triangle starts at 0 and hits +a, 0, -a at quarter, half and three-quarter period", () => {
    const triangle = generateTriangle({
      durationSeconds: 1,
      sampleRateHz: 1000,
      frequencyHz: 1,
      amplitude: 2,
    });
    expect(valueAt(triangle, 0)).toBe(0);
    expectClose(valueAt(triangle, 250), 2, { rtol: 0, atol: 1e-12 }, "x[250]");
    expectClose(valueAt(triangle, 500), 0, { rtol: 0, atol: 1e-12 }, "x[500]");
    expectClose(valueAt(triangle, 750), -2, { rtol: 0, atol: 1e-12 }, "x[750]");
    for (let n = 0; n < triangle.length; n += 1) {
      expect(Math.abs(valueAt(triangle, n))).toBeLessThanOrEqual(2);
    }
  });

  it("impulse puts the amplitude at the requested sample and zeros elsewhere", () => {
    const impulse = generateImpulse({
      durationSeconds: 0.01,
      sampleRateHz: 1000,
      impulseSampleIndex: 3,
      amplitude: 0.75,
    });
    expect(Array.from(impulse)).toEqual([0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0]);
  });

  it("step uses amplitudeBefore up to the index and amplitudeAfter from it", () => {
    const step = generateStep({
      durationSeconds: 0.01,
      sampleRateHz: 1000,
      stepSampleIndex: 4,
      amplitudeBefore: -0.25,
      amplitudeAfter: 0.5,
    });
    expect(Array.from(step)).toEqual([-0.25, -0.25, -0.25, -0.25, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);

    const leadingStep = generateStep({
      durationSeconds: 0.01,
      sampleRateHz: 1000,
      stepSampleIndex: 0,
      amplitudeBefore: -0.25,
      amplitudeAfter: 0.5,
    });
    expect(Array.from(leadingStep)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  it("chirp sweeps between the requested endpoint frequencies (linear)", () => {
    expectChirpEndpoints("linear");
  });

  it("chirp sweeps between the requested endpoint frequencies (logarithmic)", () => {
    expectChirpEndpoints("logarithmic");
  });

  it("two-tone is bounded by the amplitude and does not mutate the frequency pair", () => {
    const frequenciesHz: [number, number] = [100, 250];
    const twoTone = generateTwoTone({
      durationSeconds: 0.1,
      sampleRateHz: 1000,
      frequenciesHz,
      amplitude: 0.5,
    });
    expect(valueAt(twoTone, 0)).toBe(0);
    for (let n = 0; n < twoTone.length; n += 1) {
      expect(Math.abs(valueAt(twoTone, n))).toBeLessThanOrEqual(0.5 + 1e-12);
    }
    expect(frequenciesHz).toEqual([100, 250]);
  });

  it("AM and FM samples follow the pinned formulas", () => {
    const spec: SignalSpec = { durationSeconds: 0.1, sampleRateHz: 1000 };
    const am = generateAm({
      ...spec,
      carrierHz: 100,
      modulationHz: 10,
      modulationIndex: 0.5,
      amplitude: 0.75,
    });
    const fm = generateFm({
      ...spec,
      carrierHz: 100,
      modulationHz: 10,
      frequencyDeviationHz: 25,
      amplitude: 0.75,
    });
    expect(valueAt(am, 0)).toBe(0);
    expect(valueAt(fm, 0)).toBe(0);

    const timeSeconds = 3 / 1000;
    const amExpected =
      0.75 * (1 + 0.5 * Math.sin(TAU * 10 * timeSeconds)) * Math.sin(TAU * 100 * timeSeconds);
    const fmExpected =
      0.75 * Math.sin(TAU * 100 * timeSeconds + (25 / 10) * Math.sin(TAU * 10 * timeSeconds));
    expectClose(valueAt(am, 3), amExpected, { rtol: 0, atol: 1e-15 }, "am x[3]");
    expectClose(valueAt(fm, 3), fmExpected, { rtol: 0, atol: 1e-15 }, "fm x[3]");
  });

  it("a full-cycle sine has energy N/2 * amplitude^2", () => {
    const amplitude = 1.5;
    const sine = generateSine({
      durationSeconds: 1,
      sampleRateHz: 1000,
      frequencyHz: 10,
      amplitude,
    });
    let energy = 0;
    for (let n = 0; n < sine.length; n += 1) {
      const sample = valueAt(sine, n);
      energy += sample * sample;
    }
    const expected = (sine.length / 2) * amplitude * amplitude;
    expect(Math.abs(energy - expected) / expected).toBeLessThan(1e-12);
  });
});

describe("generator guards", () => {
  const base: SignalSpec = { durationSeconds: 0.01, sampleRateHz: 1000 };

  const invalidSpecCalls: Array<[string, () => Float64Array]> = [
    [
      "sine sampleRateHz = 0",
      () => generateSine({ ...base, sampleRateHz: 0, frequencyHz: 10, amplitude: 1 }),
    ],
    [
      "sine sampleRateHz = NaN",
      () => generateSine({ ...base, sampleRateHz: Number.NaN, frequencyHz: 10, amplitude: 1 }),
    ],
    [
      "sine sampleRateHz = Infinity",
      () =>
        generateSine({
          ...base,
          sampleRateHz: Number.POSITIVE_INFINITY,
          frequencyHz: 10,
          amplitude: 1,
        }),
    ],
    [
      "sine durationSeconds = -1",
      () => generateSine({ ...base, durationSeconds: -1, frequencyHz: 10, amplitude: 1 }),
    ],
    [
      "sine durationSeconds = NaN",
      () => generateSine({ ...base, durationSeconds: Number.NaN, frequencyHz: 10, amplitude: 1 }),
    ],
    [
      "sine durationSeconds = Infinity",
      () =>
        generateSine({
          ...base,
          durationSeconds: Number.POSITIVE_INFINITY,
          frequencyHz: 10,
          amplitude: 1,
        }),
    ],
    [
      "sine amplitude = NaN",
      () => generateSine({ ...base, frequencyHz: 10, amplitude: Number.NaN }),
    ],
    [
      "sine amplitude = Infinity",
      () => generateSine({ ...base, frequencyHz: 10, amplitude: Number.POSITIVE_INFINITY }),
    ],
    [
      "sine frequencyHz = NaN",
      () => generateSine({ ...base, frequencyHz: Number.NaN, amplitude: 1 }),
    ],
    [
      "sine phaseRad = Infinity",
      () =>
        generateSine({
          ...base,
          frequencyHz: 10,
          amplitude: 1,
          phaseRad: Number.POSITIVE_INFINITY,
        }),
    ],
    [
      "square dutyCycle = 0",
      () => generateSquare({ ...base, frequencyHz: 10, amplitude: 1, dutyCycle: 0 }),
    ],
    [
      "square dutyCycle = 1.5",
      () => generateSquare({ ...base, frequencyHz: 10, amplitude: 1, dutyCycle: 1.5 }),
    ],
    [
      "square dutyCycle = NaN",
      () => generateSquare({ ...base, frequencyHz: 10, amplitude: 1, dutyCycle: Number.NaN }),
    ],
    [
      "sawtooth amplitude = NaN",
      () => generateSawtooth({ ...base, frequencyHz: 10, amplitude: Number.NaN }),
    ],
    [
      "triangle frequencyHz = Infinity",
      () => generateTriangle({ ...base, frequencyHz: Number.POSITIVE_INFINITY, amplitude: 1 }),
    ],
    [
      "impulse index = 2.5",
      () => generateImpulse({ ...base, impulseSampleIndex: 2.5, amplitude: 1 }),
    ],
    [
      "impulse index = -1",
      () => generateImpulse({ ...base, impulseSampleIndex: -1, amplitude: 1 }),
    ],
    [
      "impulse index = 10 (out of range)",
      () => generateImpulse({ ...base, impulseSampleIndex: 10, amplitude: 1 }),
    ],
    [
      "step index = 10 (out of range)",
      () =>
        generateStep({
          ...base,
          stepSampleIndex: 10,
          amplitudeBefore: 0,
          amplitudeAfter: 1,
        }),
    ],
    [
      "step amplitudeAfter = NaN",
      () =>
        generateStep({
          ...base,
          stepSampleIndex: 4,
          amplitudeBefore: 0,
          amplitudeAfter: Number.NaN,
        }),
    ],
    [
      "chirp startFrequencyHz = NaN",
      () =>
        generateChirp({
          ...base,
          startFrequencyHz: Number.NaN,
          endFrequencyHz: 400,
          sweep: "linear",
        }),
    ],
    [
      "chirp endFrequencyHz = Infinity",
      () =>
        generateChirp({
          ...base,
          startFrequencyHz: 100,
          endFrequencyHz: Number.POSITIVE_INFINITY,
          sweep: "linear",
        }),
    ],
    [
      "logarithmic chirp startFrequencyHz = 0",
      () =>
        generateChirp({
          ...base,
          startFrequencyHz: 0,
          endFrequencyHz: 400,
          sweep: "logarithmic",
        }),
    ],
    [
      "logarithmic chirp endFrequencyHz = 0",
      () =>
        generateChirp({
          ...base,
          startFrequencyHz: 100,
          endFrequencyHz: 0,
          sweep: "logarithmic",
        }),
    ],
    [
      "logarithmic chirp with equal endpoints",
      () =>
        generateChirp({
          ...base,
          startFrequencyHz: 100,
          endFrequencyHz: 100,
          sweep: "logarithmic",
        }),
    ],
    [
      "logarithmic chirp with a negative endpoint",
      () =>
        generateChirp({
          ...base,
          startFrequencyHz: -100,
          endFrequencyHz: 400,
          sweep: "logarithmic",
        }),
    ],
    [
      "chirp with an unknown sweep",
      () =>
        generateChirp({
          ...base,
          startFrequencyHz: 100,
          endFrequencyHz: 400,
          sweep: "quadratic" as "linear" | "logarithmic",
        }),
    ],
    [
      "two-tone with a NaN frequency",
      () =>
        generateTwoTone({
          ...base,
          frequenciesHz: [Number.NaN, 250],
          amplitude: 1,
        }),
    ],
    [
      "two-tone with a malformed pair",
      () =>
        generateTwoTone({
          ...base,
          frequenciesHz: [100] as unknown as [number, number],
          amplitude: 1,
        }),
    ],
    [
      "two-tone amplitude = NaN",
      () => generateTwoTone({ ...base, frequenciesHz: [100, 250], amplitude: Number.NaN }),
    ],
    [
      "am modulationIndex = NaN",
      () =>
        generateAm({
          ...base,
          carrierHz: 100,
          modulationHz: 10,
          modulationIndex: Number.NaN,
          amplitude: 1,
        }),
    ],
    [
      "am carrierHz = Infinity",
      () =>
        generateAm({
          ...base,
          carrierHz: Number.POSITIVE_INFINITY,
          modulationHz: 10,
          modulationIndex: 0.5,
          amplitude: 1,
        }),
    ],
    [
      "fm modulationHz = 0",
      () =>
        generateFm({
          ...base,
          carrierHz: 100,
          modulationHz: 0,
          frequencyDeviationHz: 25,
          amplitude: 1,
        }),
    ],
    [
      "fm frequencyDeviationHz = NaN",
      () =>
        generateFm({
          ...base,
          carrierHz: 100,
          modulationHz: 10,
          frequencyDeviationHz: Number.NaN,
          amplitude: 1,
        }),
    ],
  ];

  it.each(invalidSpecCalls)("throws RangeError for %s", (_label, call) => {
    expect(call).toThrow(RangeError);
  });

  it("accepts a linear chirp with equal endpoints and a negative amplitude", () => {
    const chirp = generateChirp({
      ...base,
      startFrequencyHz: 100,
      endFrequencyHz: 100,
      sweep: "linear",
    });
    expect(chirp.length).toBe(10);
    const sine = generateSine({ ...base, frequencyHz: 100, amplitude: -1 });
    expect(valueAt(sine, 1)).toBeLessThan(0);
  });

  const zeroDurationCalls: Array<[string, () => Float64Array]> = [
    [
      "sine",
      () => generateSine({ durationSeconds: 0, sampleRateHz: 1000, frequencyHz: 10, amplitude: 1 }),
    ],
    [
      "square",
      () =>
        generateSquare({ durationSeconds: 0, sampleRateHz: 1000, frequencyHz: 10, amplitude: 1 }),
    ],
    [
      "sawtooth",
      () =>
        generateSawtooth({ durationSeconds: 0, sampleRateHz: 1000, frequencyHz: 10, amplitude: 1 }),
    ],
    [
      "triangle",
      () =>
        generateTriangle({ durationSeconds: 0, sampleRateHz: 1000, frequencyHz: 10, amplitude: 1 }),
    ],
    [
      "impulse (index ignored when N = 0, R7)",
      () =>
        generateImpulse({
          durationSeconds: 0,
          sampleRateHz: 1000,
          impulseSampleIndex: 99,
          amplitude: 1,
        }),
    ],
    [
      "step (index ignored when N = 0)",
      () =>
        generateStep({
          durationSeconds: 0,
          sampleRateHz: 1000,
          stepSampleIndex: 99,
          amplitudeBefore: 0,
          amplitudeAfter: 1,
        }),
    ],
    [
      "chirp",
      () =>
        generateChirp({
          durationSeconds: 0,
          sampleRateHz: 1000,
          startFrequencyHz: 100,
          endFrequencyHz: 400,
          sweep: "logarithmic",
        }),
    ],
    [
      "two-tone",
      () =>
        generateTwoTone({
          durationSeconds: 0,
          sampleRateHz: 1000,
          frequenciesHz: [100, 250],
          amplitude: 1,
        }),
    ],
    [
      "am",
      () =>
        generateAm({
          durationSeconds: 0,
          sampleRateHz: 1000,
          carrierHz: 100,
          modulationHz: 10,
          modulationIndex: 0.5,
          amplitude: 1,
        }),
    ],
    [
      "fm",
      () =>
        generateFm({
          durationSeconds: 0,
          sampleRateHz: 1000,
          carrierHz: 100,
          modulationHz: 10,
          frequencyDeviationHz: 25,
          amplitude: 1,
        }),
    ],
  ];

  it.each(zeroDurationCalls)("returns an empty array for zero duration (%s)", (_label, call) => {
    expect(call().length).toBe(0);
  });
});
