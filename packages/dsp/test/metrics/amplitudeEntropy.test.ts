import { describe, expect, it } from "vitest";

import { quantizedAmplitudeEntropy } from "../../src/index.js";

describe("quantizedAmplitudeEntropy", () => {
  it("returns zero entropy and an all-zero histogram for empty input", () => {
    const result = quantizedAmplitudeEntropy(new Float32Array(0), 8);
    expect(result.sampleCount).toBe(0);
    expect(result.bitsPerSymbol).toBe(8);
    expect(result.entropyBitsPerSample).toBe(0);
    expect(result.histogram).toHaveLength(256);
    expect(result.histogram.every((count) => count === 0)).toBe(true);
  });

  it("returns zero entropy for a constant signal", () => {
    const result = quantizedAmplitudeEntropy(Float32Array.from([0.25, 0.25, 0.25]), 8);
    expect(result.sampleCount).toBe(3);
    expect(result.entropyBitsPerSample).toBe(0);
    expect(result.histogram.reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it("returns one bit for alternating full-scale samples", () => {
    const result = quantizedAmplitudeEntropy(Float32Array.from([1, -1, 1, -1]), 8);
    expect(result.entropyBitsPerSample).toBe(1);
    expect(result.histogram[0]).toBe(2);
    expect(result.histogram[255]).toBe(2);
  });

  it("returns two bits for four equally likely amplitude bins", () => {
    const result = quantizedAmplitudeEntropy(Float32Array.from([1, 0.5, 0, -0.5]), 8);
    expect(result.entropyBitsPerSample).toBe(2);
    expect(result.histogram.reduce((sum, count) => sum + count, 0)).toBe(4);
  });

  it("supports 12-bit and 16-bit alphabets without exceeding the ceiling", () => {
    const samples = Float32Array.from({ length: 32 }, (_, index) => Math.sin(index));
    for (const bits of [8, 12, 16] as const) {
      const result = quantizedAmplitudeEntropy(samples, bits);
      expect(result.histogram).toHaveLength(2 ** bits);
      expect(result.entropyBitsPerSample).toBeGreaterThanOrEqual(0);
      expect(result.entropyBitsPerSample).toBeLessThanOrEqual(bits);
    }
  });

  it("clips values outside full scale", () => {
    const result = quantizedAmplitudeEntropy(Float32Array.from([-4, 4, -4, 4]), 8);
    expect(result.entropyBitsPerSample).toBe(1);
    expect(result.histogram[0]).toBe(2);
    expect(result.histogram[255]).toBe(2);
  });

  it("rejects invalid bit depths", () => {
    for (const bits of [0, 1.5, 17]) {
      expect(() => quantizedAmplitudeEntropy(new Float32Array([0]), bits)).toThrow(RangeError);
    }
  });

  it("rejects non-finite samples", () => {
    expect(() => quantizedAmplitudeEntropy(Float32Array.from([0, Number.NaN]), 8)).toThrow(
      TypeError,
    );
    expect(() =>
      quantizedAmplitudeEntropy(Float32Array.from([Number.POSITIVE_INFINITY]), 8),
    ).toThrow(TypeError);
  });

  it("does not mutate the input", () => {
    const samples = Float32Array.from([0.75, -0.75, 0.75]);
    quantizedAmplitudeEntropy(samples, 8);
    expect(Array.from(samples)).toEqual([0.75, -0.75, 0.75]);
  });
});
