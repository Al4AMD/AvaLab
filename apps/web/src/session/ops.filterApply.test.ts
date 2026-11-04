import { designFirWindow } from "@avalab/dsp";
import { describe, expect, it } from "vitest";

import { DspOpError, type FilterApplyParams, type FilterApplyResult, filterApply } from "./ops";
import type { TransferablePayload } from "./protocol";

const SAMPLE_RATE_HZ = 48_000;

function payload(samples: readonly number[]): TransferablePayload {
  const values = Float32Array.from(samples);
  return { buffer: values.buffer, byteOffset: 0, byteLength: values.byteLength };
}

function params(overrides: Partial<FilterApplyParams> = {}): FilterApplyParams {
  return {
    b: [1],
    a: [1],
    fir: true,
    sampleRateHz: SAMPLE_RATE_HZ,
    compensateDelay: false,
    ...overrides,
  };
}

function samplesOf(result: FilterApplyResult): number[] {
  return Array.from(result.samples);
}

function sine(samples: number, frequencyHz: number): number[] {
  return Array.from({ length: samples }, (_, index) =>
    Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE_HZ),
  );
}

function rms(values: readonly number[], start: number): number {
  let sum = 0;
  for (let index = start; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, values.length - start));
}

function expectBadParams(run: () => unknown): void {
  expect(run).toThrow(DspOpError);
  expect(run).toThrow(expect.objectContaining({ code: "badParams" }));
}

describe("filterApply", () => {
  it("runs an impulse through a known FIR and preserves the convolution", () => {
    const b = [1 / 9, 2 / 9, 3 / 9, 2 / 9, 1 / 9];
    const input = [1, ...Array.from({ length: 15 }, () => 0)];
    const result = filterApply(params({ b, compensateDelay: false }), payload(input));

    expect(result.delaySamples).toBe(2);
    expect(result.samples).toHaveLength(input.length + b.length - 1);
    const output = samplesOf(result);
    for (let index = 0; index < b.length; index += 1) {
      expect(output[index]).toBeCloseTo(b[index] ?? 0, 6);
    }
    for (let index = b.length; index < output.length; index += 1) {
      expect(output[index]).toBeCloseTo(0, 6);
    }
  });

  it("trims the linear-phase delay to keep the input length when asked", () => {
    const b = [1 / 9, 2 / 9, 3 / 9, 2 / 9, 1 / 9];
    const input = [1, ...Array.from({ length: 31 }, () => 0)];
    const result = filterApply(params({ b, compensateDelay: true }), payload(input));

    expect(result.samples).toHaveLength(input.length);
    expect(result.delaySamples).toBe(2);
    expect(result.samples[0]).toBeCloseTo(3 / 9, 6);
  });

  it("attenuates a stopband sine but passes a passband sine", () => {
    const b = Array.from(
      designFirWindow({
        band: "lowpass",
        cutoffHz: [1_000],
        taps: 101,
        sampleRateHz: SAMPLE_RATE_HZ,
        windowFilter: { kind: "hamming" },
      }),
    );
    const passband = filterApply(params({ b, compensateDelay: false }), payload(sine(9_600, 500)));
    const stopband = filterApply(
      params({ b, compensateDelay: false }),
      payload(sine(9_600, 8_000)),
    );

    expect(rms(samplesOf(passband), 2_000)).toBeGreaterThan(0.6);
    expect(rms(samplesOf(stopband), 2_000)).toBeLessThan(0.05);
  });

  it("runs an IIR without changing length and reports its low-frequency delay", () => {
    const input = sine(2_400, 500);
    const result = filterApply(
      params({
        b: [0.067_455, 0.134_91, 0.067_455],
        a: [1, -1.143, 0.412_8],
        fir: false,
        compensateDelay: true,
      }),
      payload(input),
    );

    expect(result.samples).toHaveLength(input.length);
    expect(Number.isFinite(result.delaySamples)).toBe(true);
    expect(result.delaySamples).toBeGreaterThanOrEqual(0);
  });

  it("rejects empty input, non-finite samples, and impossible coefficients", () => {
    expectBadParams(() => filterApply(params(), payload([])));
    expectBadParams(() => filterApply(params(), payload([0, Number.NaN])));
    expectBadParams(() => filterApply(params({ b: [] }), payload([1, 0])));
    expectBadParams(() => filterApply(params({ b: [1], a: [0] }), payload([1, 0])));
    expectBadParams(() => filterApply(params({ sampleRateHz: 0 }), payload([1, 0])));
    expectBadParams(() => filterApply(params({ fir: false, b: [1], a: [] }), payload([1, 0])));
  });
});
