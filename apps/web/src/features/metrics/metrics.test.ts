import { describe, expect, it } from "vitest";

import {
  computeQualityMetrics,
  formatMetric,
  MetricsError,
  PSNR_PEAK,
  SEGMENTAL_FRAME_SECONDS,
} from "./metrics";

describe("computeQualityMetrics", () => {
  it("returns zero error and infinite ratios for identical signals", () => {
    const samples = new Float32Array([0.5, -0.5, 0.25]);
    const metrics = computeQualityMetrics(samples, samples.slice(), 48_000);

    expect(metrics).toEqual({
      mse: 0,
      snrDb: Number.POSITIVE_INFINITY,
      segmentalSnrDb: Number.POSITIVE_INFINITY,
      psnrDb: Number.POSITIVE_INFINITY,
      sampleCount: 3,
    });
  });

  it("computes the documented constant-offset values with peak 1", () => {
    const reference = new Float32Array([0.5, 0.5]);
    const test = new Float32Array([0.25, 0.25]);
    const metrics = computeQualityMetrics(reference, test, 48_000);

    expect(metrics.mse).toBeCloseTo(0.0625, 12);
    expect(metrics.snrDb).toBeCloseTo(10 * Math.log10(4), 12);
    expect(metrics.psnrDb).toBeCloseTo(10 * Math.log10(1 / 0.0625), 12);
    expect(metrics.segmentalSnrDb).toBeCloseTo(10 * Math.log10(4), 12);
    expect(PSNR_PEAK).toBe(1);
    expect(SEGMENTAL_FRAME_SECONDS).toBe(0.02);
  });

  it.each<[string, Float32Array, Float32Array, number, string]>([
    ["empty", new Float32Array(), new Float32Array(), 48_000, "empty"],
    ["length mismatch", new Float32Array(2), new Float32Array(3), 48_000, "lengthMismatch"],
    ["bad rate", new Float32Array(2), new Float32Array(2), 0, "invalidRate"],
    ["NaN rate", new Float32Array(2), new Float32Array(2), Number.NaN, "invalidRate"],
  ])("rejects %s with a typed code", (_label, reference, test, rate, code) => {
    expect(() => computeQualityMetrics(reference, test, rate)).toThrowError(
      expect.objectContaining({ code }),
    );
    try {
      computeQualityMetrics(reference, test, rate);
    } catch (error) {
      expect(error).toBeInstanceOf(MetricsError);
    }
  });
});

describe("formatMetric", () => {
  it("formats finite values, infinities and NaN", () => {
    expect(formatMetric(Number.POSITIVE_INFINITY)).toBe("∞");
    expect(formatMetric(Number.NEGATIVE_INFINITY)).toBe("-∞");
    expect(formatMetric(Number.NaN)).toBe("—");
    expect(formatMetric(1.23456, 3)).toBe("1.235");
  });
});
