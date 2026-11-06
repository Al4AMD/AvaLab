import { describe, expect, it } from "vitest";

import { DspOpError, qualityMetrics } from "./ops";

function combined(reference: Float32Array, test: Float32Array): Float32Array {
  const merged = new Float32Array(reference.length + test.length);
  merged.set(reference, 0);
  merged.set(test, reference.length);
  return merged;
}

function payloadOf(samples: Float32Array) {
  return {
    buffer: samples.buffer as ArrayBuffer,
    byteOffset: 0,
    byteLength: samples.byteLength,
  };
}

describe("qualityMetrics", () => {
  it("computes zero error for identical signals", () => {
    const samples = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    const result = qualityMetrics(
      { sampleRateHz: 48_000, sampleCount: samples.length },
      payloadOf(combined(samples, samples)),
    );
    expect(result.mse).toBe(0);
    expect(result.snrDb).toBe(Number.POSITIVE_INFINITY);
    expect(result.meta.sampleCount).toBe(4);
  });

  it("computes the known SNR for a half-scaled signal", () => {
    const reference = new Float32Array([1, -1, 1, -1]);
    const test = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    const result = qualityMetrics(
      { sampleRateHz: 48_000, sampleCount: reference.length },
      payloadOf(combined(reference, test)),
    );
    expect(result.snrDb).toBeCloseTo(6.0206, 3);
  });

  it("rejects mismatched lanes and bad payloads", () => {
    const reference = new Float32Array([1, 2]);
    const test = new Float32Array([1, 2, 3]);
    expect(() =>
      qualityMetrics(
        { sampleRateHz: 48_000, sampleCount: reference.length },
        payloadOf(combined(reference, test)),
      ),
    ).toThrow(DspOpError);
    expect(() => qualityMetrics({ sampleRateHz: 0, sampleCount: 2 }, payloadOf(reference))).toThrow(
      DspOpError,
    );
  });
});
