import { describe, expect, it } from "vitest";
import { generateSyntheticIr, rfft } from "../../src/index.js";

const BASE = {
  kind: "hall" as const,
  sampleRateHz: 48_000,
  durationSeconds: 1,
  rt60Seconds: 0.6,
  seed: 7,
};

function bandRms(
  magnitudes: Float64Array,
  lowHz: number,
  highHz: number,
  sampleRateHz: number,
  sampleCount: number,
): number {
  const lowBin = Math.max(1, Math.ceil((lowHz * sampleCount) / sampleRateHz));
  const highBin = Math.min(
    magnitudes.length - 1,
    Math.floor((highHz * sampleCount) / sampleRateHz),
  );
  let sum = 0;
  let count = 0;
  for (let k = lowBin; k <= highBin; k += 1) {
    const magnitude = magnitudes[k] ?? 0;
    sum += magnitude * magnitude;
    count += 1;
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

function rmsOf(samples: Float64Array, start: number, end: number): number {
  let sum = 0;
  for (let n = start; n < end; n += 1) {
    const sample = samples[n] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}

describe("generateSyntheticIr", () => {
  it("is deterministic for the same seed and differs for another seed", () => {
    const first = generateSyntheticIr(BASE);
    const second = generateSyntheticIr(BASE);
    const other = generateSyntheticIr({ ...BASE, seed: BASE.seed + 1 });
    expect(first).toEqual(second);
    expect(first).not.toEqual(other);
  });

  it("produces the rounded duration in samples", () => {
    const ir = generateSyntheticIr({ ...BASE, durationSeconds: 0.25 });
    expect(ir.length).toBe(12_000);
  });

  it("normalizes energy to one", () => {
    for (const kind of ["room", "hall", "plate", "telephone"] as const) {
      const ir = generateSyntheticIr({ ...BASE, kind });
      let energy = 0;
      for (const sample of ir) {
        energy += sample * sample;
      }
      expect(energy).toBeCloseTo(1, 12);
    }
  });

  it("decays: the late window has less RMS than the early window", () => {
    const ir = generateSyntheticIr({ ...BASE, durationSeconds: 2, rt60Seconds: 0.5 });
    const early = rmsOf(ir, 0, 2_400);
    const late = rmsOf(ir, 72_000, 96_000);
    expect(late).toBeLessThan(early * 0.1);
  });

  it("band-limits the telephone IR below 300 Hz and above 3400 Hz", () => {
    const ir = generateSyntheticIr({ ...BASE, kind: "telephone" });
    const spectrum = rfft(ir);
    const magnitudes = new Float64Array(spectrum.re.length);
    for (let k = 0; k < magnitudes.length; k += 1) {
      magnitudes[k] = Math.hypot(spectrum.re[k] ?? 0, spectrum.im[k] ?? 0);
    }
    const low = bandRms(magnitudes, 80, 120, BASE.sampleRateHz, ir.length);
    const mid = bandRms(magnitudes, 900, 1_100, BASE.sampleRateHz, ir.length);
    const high = bandRms(magnitudes, 4_800, 5_200, BASE.sampleRateHz, ir.length);
    expect(low).toBeLessThan(mid * 0.35);
    expect(high).toBeLessThan(mid * 0.7);
  });

  it("rejects invalid parameters", () => {
    expect(() => generateSyntheticIr({ ...BASE, sampleRateHz: 0 })).toThrow(RangeError);
    expect(() => generateSyntheticIr({ ...BASE, sampleRateHz: 48_000.5 })).toThrow(RangeError);
    expect(() => generateSyntheticIr({ ...BASE, durationSeconds: 0 })).toThrow(RangeError);
    expect(() => generateSyntheticIr({ ...BASE, durationSeconds: Number.NaN })).toThrow(RangeError);
    expect(() => generateSyntheticIr({ ...BASE, rt60Seconds: 0 })).toThrow(RangeError);
    expect(() => generateSyntheticIr({ ...BASE, rt60Seconds: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => generateSyntheticIr({ ...BASE, seed: Number.NaN })).toThrow(RangeError);
  });

  it("rejects an all-zero response (duration rounds to zero samples)", () => {
    expect(() => generateSyntheticIr({ ...BASE, sampleRateHz: 1, durationSeconds: 0.1 })).toThrow(
      RangeError,
    );
  });
});
