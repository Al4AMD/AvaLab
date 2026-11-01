import { describe, expect, it } from "vitest";

import { waveformRange } from "./ops";
import { float32PayloadOf, float32ValuesOf } from "./testDoubles";

describe("waveformRange handler", () => {
  it("buckets the transferred slice and echoes the range metadata", () => {
    const result = waveformRange(
      { bucketCount: 2, sampleRateHz: 48_000, startSample: 4, endSample: 8 },
      float32PayloadOf([0.5, -0.5, 1, -1]),
    );
    expect(result.meta).toEqual({
      sampleCount: 4,
      sampleRateHz: 48_000,
      bucketCount: 2,
      startSample: 4,
      endSample: 8,
    });
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("waveformRange must return a minMax payload");
    }
    expect(float32ValuesOf(payload)).toEqual([-0.5, 0.5, -1, 1]);
  });

  it("requires a payload", () => {
    expect(() =>
      waveformRange({ bucketCount: 2, sampleRateHz: 48_000, startSample: 0, endSample: 2 }),
    ).toThrowError(/payload/i);
  });
});
