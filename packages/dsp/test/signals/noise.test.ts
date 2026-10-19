import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { fft, generatePinkNoise, generateWhiteNoise, mulberry32 } from "../../src/index.js";

const SAMPLE_RATE_HZ = 48000;

function bytesOf(values: Float64Array): Buffer {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function valueAt(values: ArrayLike<number>, index: number, label: string): number {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`${label}[${index}] read out of bounds`);
  }
  return value;
}

function maxAbs(values: Float64Array): number {
  let peak = 0;
  for (let index = 0; index < values.length; index += 1) {
    peak = Math.max(peak, Math.abs(valueAt(values, index, "values")));
  }
  return peak;
}

function mean(values: Float64Array): number {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += valueAt(values, index, "values");
  }
  return values.length === 0 ? 0 : sum / values.length;
}

function standardDeviation(values: Float64Array): number {
  const average = mean(values);
  let sumOfSquares = 0;
  for (let index = 0; index < values.length; index += 1) {
    const deviation = valueAt(values, index, "values") - average;
    sumOfSquares += deviation * deviation;
  }
  return values.length === 0 ? 0 : Math.sqrt(sumOfSquares / values.length);
}

/**
 * Mean power per FFT bin inside each octave band. Pink noise has PSD ~ 1/f,
 * so this mean falls by ~3 dB per octave; the total energy *sum* of an octave
 * band would instead stay flat because its bandwidth doubles.
 */
function octaveBandMeanPowers(
  samples: Float64Array,
  sampleRateHz: number,
  bandEdgesHz: readonly number[],
): number[] {
  const spectrum = fft(samples);
  const binCount = samples.length;
  const binWidthHz = sampleRateHz / binCount;
  const means: number[] = [];
  for (let band = 0; band < bandEdgesHz.length - 1; band += 1) {
    const startHz = valueAt(bandEdgesHz, band, "bandEdgesHz");
    const endHz = valueAt(bandEdgesHz, band + 1, "bandEdgesHz");
    const startBin = Math.max(1, Math.ceil(startHz / binWidthHz));
    const endBin = Math.min(binCount / 2 - 1, Math.floor(endHz / binWidthHz));
    let powerSum = 0;
    for (let bin = startBin; bin <= endBin; bin += 1) {
      const re = valueAt(spectrum.re, bin, "spectrum.re");
      const im = valueAt(spectrum.im, bin, "spectrum.im");
      powerSum += re * re + im * im;
    }
    means.push(powerSum / (endBin - startBin + 1));
  }
  return means;
}

describe("mulberry32", () => {
  it("matches the pinned mulberry32 sequence for seed 42", () => {
    const random = mulberry32(42);
    expect([random(), random(), random(), random()]).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
    ]);
  });

  it("returns values in [0, 1) for many draws", () => {
    for (const seed of [0, 1, 42, 1234, 0xffff_ffff]) {
      const random = mulberry32(seed);
      let smallest = Number.POSITIVE_INFINITY;
      let largest = Number.NEGATIVE_INFINITY;
      for (let draw = 0; draw < 5000; draw += 1) {
        const value = random();
        smallest = Math.min(smallest, value);
        largest = Math.max(largest, value);
      }
      expect(smallest).toBeGreaterThanOrEqual(0);
      expect(largest).toBeLessThan(1);
    }
  });

  it("produces the same stream for the same seed", () => {
    const first = mulberry32(2026);
    const second = mulberry32(2026);
    const firstValues = Array.from({ length: 32 }, () => first());
    const secondValues = Array.from({ length: 32 }, () => second());
    expect(firstValues).toEqual(secondValues);
  });

  it("produces a different stream for a different seed", () => {
    const first = mulberry32(2026);
    const second = mulberry32(2027);
    const firstValues = Array.from({ length: 32 }, () => first());
    const secondValues = Array.from({ length: 32 }, () => second());
    expect(firstValues).not.toEqual(secondValues);
  });

  it.each([
    ["NaN", Number.NaN],
    ["+Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a non-integer", 1.5],
  ])("rejects a seed that is %s", (_label, seed) => {
    expect(() => mulberry32(seed)).toThrow(RangeError);
  });
});

describe("generateWhiteNoise", () => {
  const spec = { durationSeconds: 1, sampleRateHz: SAMPLE_RATE_HZ, amplitude: 0.5 };

  it("returns byte-identical arrays for the same seed", () => {
    const first = generateWhiteNoise({ ...spec, seed: 1234 });
    const second = generateWhiteNoise({ ...spec, seed: 1234 });
    expect(first.length).toBe(SAMPLE_RATE_HZ);
    expect(bytesOf(first).equals(bytesOf(second))).toBe(true);
  });

  it("returns different arrays for different seeds", () => {
    const first = generateWhiteNoise({ ...spec, seed: 1234 });
    const second = generateWhiteNoise({ ...spec, seed: 4321 });
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it("has near-zero mean and the theoretical standard deviation", () => {
    const samples = generateWhiteNoise({ ...spec, seed: 20261020 });
    const expectedStandardDeviation = spec.amplitude / Math.sqrt(3);
    expect(Math.abs(mean(samples))).toBeLessThan(0.02);
    expect(
      Math.abs(standardDeviation(samples) - expectedStandardDeviation) / expectedStandardDeviation,
    ).toBeLessThan(0.03);
  });

  it("keeps every sample inside the amplitude bounds", () => {
    const samples = generateWhiteNoise({ ...spec, seed: 99 });
    let smallest = Number.POSITIVE_INFINITY;
    let largest = Number.NEGATIVE_INFINITY;
    for (const value of samples) {
      smallest = Math.min(smallest, value);
      largest = Math.max(largest, value);
    }
    expect(smallest).toBeGreaterThanOrEqual(-spec.amplitude);
    expect(largest).toBeLessThanOrEqual(spec.amplitude);
  });

  it("returns an empty array for zero duration", () => {
    expect(generateWhiteNoise({ ...spec, durationSeconds: 0, seed: 7 }).length).toBe(0);
  });

  it.each([
    ["sampleRateHz = 0", { sampleRateHz: 0 }, RangeError],
    ["sampleRateHz = -1", { sampleRateHz: -1 }, RangeError],
    ["sampleRateHz = NaN", { sampleRateHz: Number.NaN }, TypeError],
    ["sampleRateHz = Infinity", { sampleRateHz: Number.POSITIVE_INFINITY }, TypeError],
    ["durationSeconds = -1", { durationSeconds: -1 }, RangeError],
    ["durationSeconds = NaN", { durationSeconds: Number.NaN }, TypeError],
    ["durationSeconds = Infinity", { durationSeconds: Number.POSITIVE_INFINITY }, TypeError],
    ["amplitude = NaN", { amplitude: Number.NaN }, TypeError],
    ["amplitude = Infinity", { amplitude: Number.POSITIVE_INFINITY }, TypeError],
    ["seed = NaN", { seed: Number.NaN }, RangeError],
    ["seed = 1.25", { seed: 1.25 }, RangeError],
  ])("rejects invalid input: %s", (_label, override, errorType) => {
    expect(() => generateWhiteNoise({ ...spec, seed: 1, ...override })).toThrow(errorType);
  });

  it("rejects a sample count that exceeds the safe integer range", () => {
    expect(() =>
      generateWhiteNoise({
        durationSeconds: Number.MAX_SAFE_INTEGER,
        sampleRateHz: 2,
        seed: 1,
        amplitude: 1,
      }),
    ).toThrow(RangeError);
  });
});

describe("generatePinkNoise", () => {
  const spec = { durationSeconds: 1, sampleRateHz: SAMPLE_RATE_HZ, amplitude: 1 };

  it("returns byte-identical arrays for the same seed", () => {
    const first = generatePinkNoise({ ...spec, seed: 1234 });
    const second = generatePinkNoise({ ...spec, seed: 1234 });
    expect(first.length).toBe(SAMPLE_RATE_HZ);
    expect(bytesOf(first).equals(bytesOf(second))).toBe(true);
  });

  it("returns different arrays for different seeds", () => {
    const first = generatePinkNoise({ ...spec, seed: 1234 });
    const second = generatePinkNoise({ ...spec, seed: 4321 });
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it("normalizes the peak to at most the amplitude", () => {
    for (const amplitude of [1, 0.25]) {
      const samples = generatePinkNoise({ ...spec, seed: 7, amplitude });
      const peak = maxAbs(samples);
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(amplitude);
    }
  });

  it.each([1, 42, 12345])(
    "falls by about 3 dB per octave in octave-band mean power (seed %i)",
    (seed) => {
      const sampleCount = 65536;
      const samples = generatePinkNoise({
        durationSeconds: sampleCount / SAMPLE_RATE_HZ,
        sampleRateHz: SAMPLE_RATE_HZ,
        seed,
        amplitude: 1,
      });
      expect(samples.length).toBe(sampleCount);

      const bandEdgesHz = [93.75, 187.5, 375, 750, 1500, 3000, 6000];
      const means = octaveBandMeanPowers(samples, SAMPLE_RATE_HZ, bandEdgesHz);
      expect(means).toHaveLength(bandEdgesHz.length - 1);

      for (let band = 1; band < means.length; band += 1) {
        const slopeDbPerOctave =
          10 *
          Math.log10(
            valueAt(means, band - 1, "octave band mean power") /
              valueAt(means, band, "octave band mean power"),
          );
        expect(
          Math.abs(slopeDbPerOctave - 3),
          `seed ${seed}, band ${band}: ${slopeDbPerOctave.toFixed(2)} dB/octave`,
        ).toBeLessThanOrEqual(1.5);
      }
    },
  );

  it("returns an empty array for zero duration", () => {
    expect(generatePinkNoise({ ...spec, durationSeconds: 0, seed: 7 }).length).toBe(0);
  });

  it.each([
    ["sampleRateHz = 0", { sampleRateHz: 0 }, RangeError],
    ["durationSeconds = -1", { durationSeconds: -1 }, RangeError],
    ["durationSeconds = NaN", { durationSeconds: Number.NaN }, TypeError],
    ["amplitude = NaN", { amplitude: Number.NaN }, TypeError],
    ["seed = Infinity", { seed: Number.POSITIVE_INFINITY }, RangeError],
    ["seed = 2.5", { seed: 2.5 }, RangeError],
  ])("rejects invalid input: %s", (_label, override, errorType) => {
    expect(() => generatePinkNoise({ ...spec, seed: 1, ...override })).toThrow(errorType);
  });
});
