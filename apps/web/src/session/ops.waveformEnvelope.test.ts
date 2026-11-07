import { describe, expect, it } from "vitest";

import { DspOpError, waveformEnvelope } from "./ops";

function payloadOf(samples: Float32Array) {
  return {
    buffer: samples.buffer as ArrayBuffer,
    byteOffset: 0,
    byteLength: samples.byteLength,
  };
}

function valuesOf(result: {
  payload?: { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
}) {
  if (result.payload === undefined) {
    throw new Error("expected a payload");
  }
  return Array.from(
    new Float32Array(
      result.payload.buffer,
      result.payload.byteOffset,
      result.payload.byteLength / 4,
    ),
  );
}

describe("waveformEnvelope", () => {
  it("returns min/max pairs for four buckets", () => {
    const samples = new Float32Array([0, 1, -1, 0.5, -0.5, 0.25, -0.25, 0]);
    const result = waveformEnvelope({ bucketCount: 4 }, payloadOf(samples));
    expect(result.meta.bucketCount).toBe(4);
    expect(valuesOf(result)).toEqual([0, 1, -1, 0.5, -0.5, 0.25, -0.25, 0]);
  });

  it("returns one zero pair for empty input", () => {
    const result = waveformEnvelope({ bucketCount: 4 }, payloadOf(new Float32Array(0)));
    expect(result.meta.bucketCount).toBe(1);
    expect(valuesOf(result)).toEqual([0, 0]);
  });

  it("rejects a missing payload and bad bucket count", () => {
    expect(() => waveformEnvelope({ bucketCount: 4 })).toThrow(DspOpError);
    expect(() => waveformEnvelope({ bucketCount: 0 }, payloadOf(new Float32Array([1])))).toThrow(
      DspOpError,
    );
  });
});
