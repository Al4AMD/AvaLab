import { describe, expect, it } from "vitest";

import { dspOps, WAVEFORM_ENTROPY_DISPLAY_BINS, waveformEntropy } from "./ops";
import { float32PayloadOf } from "./testDoubles";

function displayOf(payload: ReturnType<typeof waveformEntropy>["payload"]): Uint32Array {
  if (payload === undefined) {
    throw new Error("waveformEntropy must return a histogram payload");
  }
  return new Uint32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
}

describe("waveformEntropy handler", () => {
  it("computes entropy and returns a 256-bin display histogram", () => {
    const result = waveformEntropy(
      { bitsPerSample: 8, startSample: 10, endSample: 14 },
      float32PayloadOf([1, -1, 1, -1]),
    );
    expect(result.meta).toEqual({
      sampleCount: 4,
      startSample: 10,
      endSample: 14,
      bitsPerSample: 8,
      entropyBitsPerSample: 1,
      maxEntropyBitsPerSample: 8,
      displayBinCount: WAVEFORM_ENTROPY_DISPLAY_BINS,
    });
    const display = displayOf(result.payload);
    expect(display).toHaveLength(256);
    expect(display[0]).toBe(2);
    expect(display[255]).toBe(2);
    expect(display.reduce((sum, count) => sum + count, 0)).toBe(4);
  });

  it("aggregates a 16-bit alphabet into the display bins without changing entropy", () => {
    const result = waveformEntropy(
      { bitsPerSample: 16, startSample: 0, endSample: 4 },
      float32PayloadOf([1, 0.5, 0, -0.5]),
    );
    expect(result.meta.entropyBitsPerSample).toBe(2);
    expect(result.meta.maxEntropyBitsPerSample).toBe(16);
    expect(displayOf(result.payload).reduce((sum, count) => sum + count, 0)).toBe(4);
  });

  it("returns zero entropy for an empty selection", () => {
    const result = waveformEntropy(
      { bitsPerSample: 12, startSample: 5, endSample: 5 },
      float32PayloadOf([]),
    );
    expect(result.meta.sampleCount).toBe(0);
    expect(result.meta.entropyBitsPerSample).toBe(0);
    expect(displayOf(result.payload)).toHaveLength(256);
  });

  it("rejects invalid params and non-finite payloads", () => {
    expect(() =>
      waveformEntropy(
        { bitsPerSample: 10 as unknown as 8, startSample: 0, endSample: 1 },
        float32PayloadOf([0]),
      ),
    ).toThrowError(/params/i);
    expect(() =>
      waveformEntropy({ bitsPerSample: 8, startSample: 2, endSample: 1 }, float32PayloadOf([0])),
    ).toThrowError(/params/i);
    expect(() =>
      waveformEntropy(
        { bitsPerSample: 8, startSample: 0, endSample: 1 },
        float32PayloadOf([Number.NaN]),
      ),
    ).toThrowError(/finite/i);
    expect(() => waveformEntropy({ bitsPerSample: 8, startSample: 0, endSample: 1 })).toThrowError(
      /payload/i,
    );
  });

  it("is registered in the op table", () => {
    expect(dspOps.waveformEntropy.handler).toBe(waveformEntropy);
  });
});
