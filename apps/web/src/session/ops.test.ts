/**
 * Op table tests: sessionPing echo semantics, badParams typed throws, and
 * the type-lens wiring (params/result types + worker switch exhaustiveness)
 * that the "add one entry" rule leans on (ops.ts header).
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DspOpError,
  type DspOpName,
  type DspOpParams,
  type DspOpResult,
  dspOps,
  fftSelection,
  generateSynth,
  sessionPing,
  spectrogramTiles,
  waveformOverview,
  waveformRange,
  windowProfiles,
} from "./ops";
import type { TransferablePayload } from "./protocol";
import { float32PayloadOf, float32ValuesOf } from "./testDoubles";

describe("sessionPing handler", () => {
  it("echoes the payload descriptor with meta.received", () => {
    const bytes = new Uint8Array(8);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index + 1;
    }
    const payload: TransferablePayload = {
      buffer: bytes.buffer,
      byteOffset: 0,
      byteLength: bytes.byteLength,
    };
    const result = sessionPing({ count: 3 }, payload);

    expect(result.meta).toEqual({ received: true });
    // Same bytes, via the echoed descriptor's own range.
    expect(result.payload?.byteOffset).toBe(0);
    expect(result.payload?.byteLength).toBe(8);
    expect([...new Uint8Array(result.payload?.buffer ?? new ArrayBuffer(0))]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("answers with meta only when there is no payload", () => {
    const result = sessionPing({ count: 0 });
    expect(result).toEqual({ meta: { received: true } });
    expect(result.payload).toBeUndefined();
  });

  it("throws a typed badParams error for non-integer, negative or missing counts", () => {
    const expectBadParams = (act: () => unknown): void => {
      try {
        act();
        expect.unreachable("sessionPing must throw");
      } catch (error) {
        expect(error).toBeInstanceOf(DspOpError);
        expect((error as DspOpError).code).toBe("badParams");
      }
    };
    expectBadParams(() => sessionPing({ count: 1.5 }));
    expectBadParams(() => sessionPing({ count: -1 }));
    expectBadParams(() => sessionPing({ count: Number.NaN }));
    expectBadParams(() => sessionPing({ count: Number.POSITIVE_INFINITY }));
    // Wire frames can carry a missing params object; the handler owns the guard.
    expectBadParams(() => sessionPing(undefined as unknown as { count: number }));
  });
});

describe("waveformOverview handler", () => {
  it("buckets the source payload with meta/sampleCount read off the frame", () => {
    // Same hand-computed 5-sample/3-bucket vector as the dsp peaks test.
    const result = waveformOverview(
      { bucketCount: 3, sampleRateHz: 48_000 },
      float32PayloadOf([1, -2, 3, -0.5, 0.25]),
    );
    expect(result.meta).toEqual({ sampleCount: 5, sampleRateHz: 48_000, bucketCount: 3 });
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("waveformOverview must return a minMax payload");
    }
    expect(payload.byteLength).toBe(6 * 4);
    expect(payload.byteOffset).toBe(0);
    expect(float32ValuesOf(payload)).toEqual([1, 1, -2, 3, -0.5, 0.25]);
  });

  it("answers an empty source with an empty (zero-byte) minMax payload", () => {
    const result = waveformOverview({ bucketCount: 8, sampleRateHz: 44_100 }, {
      buffer: new ArrayBuffer(0),
      byteOffset: 0,
      byteLength: 0,
    } satisfies TransferablePayload);
    // meta self-description: an empty source yields 0 buckets even though
    // params requested 8 — meta describes the payload actually returned.
    expect(result.meta).toEqual({ sampleCount: 0, sampleRateHz: 44_100, bucketCount: 0 });
    expect(result.payload?.byteLength).toBe(0);
  });

  it("throws a typed badParams error for an invalid bucketCount or sampleRateHz", () => {
    const expectBadParams = (act: () => unknown): void => {
      try {
        act();
        expect.unreachable("waveformOverview must throw");
      } catch (error) {
        expect(error).toBeInstanceOf(DspOpError);
        expect((error as DspOpError).code).toBe("badParams");
      }
    };
    expectBadParams(() => waveformOverview({ bucketCount: 0, sampleRateHz: 48_000 }));
    expectBadParams(() => waveformOverview({ bucketCount: 2.5, sampleRateHz: 48_000 }));
    expectBadParams(() => waveformOverview({ bucketCount: Number.NaN, sampleRateHz: 48_000 }));
    expectBadParams(() => waveformOverview({ bucketCount: 8, sampleRateHz: 0 }));
    expectBadParams(() => waveformOverview({ bucketCount: 8, sampleRateHz: Number.NaN }));
    // Wire frames can carry a missing params object; the handler owns the guard.
    expectBadParams(() =>
      waveformOverview(undefined as unknown as { bucketCount: number; sampleRateHz: number }),
    );
  });

  it("throws a typed badPayload error for a missing/misaligned payload", () => {
    const expectBadPayload = (act: () => unknown): void => {
      try {
        act();
        expect.unreachable("waveformOverview must throw");
      } catch (error) {
        expect(error).toBeInstanceOf(DspOpError);
        expect((error as DspOpError).code).toBe("badPayload");
      }
    };
    expectBadPayload(() => waveformOverview({ bucketCount: 8, sampleRateHz: 48_000 }));
    // Not a multiple of 4 bytes → not a whole Float32 sample count.
    expectBadPayload(() =>
      waveformOverview(
        { bucketCount: 8, sampleRateHz: 48_000 },
        {
          buffer: new ArrayBuffer(6),
          byteOffset: 0,
          byteLength: 6,
        },
      ),
    );
    // Non-Float32-aligned inner slice (misaligned view into a bigger buffer).
    expectBadPayload(() =>
      waveformOverview(
        { bucketCount: 8, sampleRateHz: 48_000 },
        {
          buffer: new ArrayBuffer(16),
          byteOffset: 2,
          byteLength: 8,
        },
      ),
    );
  });
});

describe("op table wiring", () => {
  it("carries the handler for dispatch", () => {
    expect(dspOps.sessionPing.handler).toBe(sessionPing);
    expect(dspOps.waveformOverview.handler).toBe(waveformOverview);
    expect(dspOps.waveformRange.handler).toBe(waveformRange);
    expect(dspOps.spectrogramTiles.handler).toBe(spectrogramTiles);
    expect(dspOps.fftSelection.handler).toBe(fftSelection);
    expect(dspOps.windowProfiles.handler).toBe(windowProfiles);
    expect(dspOps.generateSynth.handler).toBe(generateSynth);
  });

  it("derives typed params/results from the table (the add-one-entry lens)", () => {
    expectTypeOf<DspOpName>().toEqualTypeOf<
      | "sessionPing"
      | "spectrogramTiles"
      | "waveformOverview"
      | "waveformRange"
      | "fftSelection"
      | "windowProfiles"
      | "generateSynth"
    >();
    expectTypeOf<DspOpParams<"sessionPing">>().toEqualTypeOf<{ count: number }>();
    expectTypeOf<DspOpResult<"sessionPing">>().toEqualTypeOf<{
      meta: { received: true };
      payload?: TransferablePayload;
    }>();
    expectTypeOf<DspOpParams<"waveformOverview">>().toEqualTypeOf<{
      bucketCount: number;
      sampleRateHz: number;
    }>();
    expectTypeOf<DspOpResult<"waveformOverview">>().toEqualTypeOf<{
      meta: { sampleCount: number; sampleRateHz: number; bucketCount: number };
      payload?: TransferablePayload;
    }>();
    expectTypeOf<DspOpParams<"waveformRange">>().toEqualTypeOf<{
      bucketCount: number;
      sampleRateHz: number;
      startSample: number;
      endSample: number;
    }>();
    expectTypeOf<DspOpResult<"waveformRange">>().toEqualTypeOf<{
      meta: {
        sampleCount: number;
        sampleRateHz: number;
        bucketCount: number;
        startSample: number;
        endSample: number;
      };
      payload?: TransferablePayload;
    }>();
    expectTypeOf<DspOpParams<"spectrogramTiles">>().toEqualTypeOf<{
      sampleRateHz: number;
      windowFamily: "rect" | "hann" | "hamming" | "blackman" | "kaiser";
      windowLengthSamples: number;
      hopFraction: number;
      dbFloorDb: number;
      rowStart: number;
      rowCount: number;
      frameStride?: number;
      sourceStartSample: number;
    }>();
    expectTypeOf<DspOpResult<"spectrogramTiles">>().toEqualTypeOf<{
      meta: {
        rowStart: number;
        rowCount: number;
        frameStride: number;
        columnCount: number;
        hopLengthSamples: number;
        fftLengthSamples: number;
        sampleRateHz: number;
        dbFloorDb: number;
        sourceStartSample: number;
      };
      payload?: TransferablePayload;
    }>();
  });

  it("type-level: unknown ops are not table keys", () => {
    // @ts-expect-error an op no plan ever adds — table keys stay closed.
    void dspOps.definitelyNotAnOp;
  });
});

describe("fftSelection handler", () => {
  const SAMPLE_RATE = 8192;
  const TONE_HZ = 1000;
  const SAMPLES = 8192;

  function toneSamples(frequencyHz: number): TransferablePayload {
    const values = Array.from({ length: SAMPLES }, (_, index) =>
      Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE),
    );
    return float32PayloadOf(values);
  }

  function run(frequencyHz: number, family: "rect" | "hann") {
    return fftSelection(
      {
        sampleRateHz: SAMPLE_RATE,
        startSample: 0,
        endSample: SAMPLES,
        windowFamily: family,
        windowLengthSamples: SAMPLES,
        magnitudeMode: "db",
        phaseMode: "wrapped",
      },
      toneSamples(frequencyHz),
    );
  }

  it("puts a bin-centred full-scale tone at 0 dB in its bin", () => {
    const result = run(TONE_HZ, "hann");
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = new Float64Array(payload.buffer, payload.byteOffset, payload.byteLength / 8);
    const binCount = result.meta.binCount;
    const magnitudes = values.subarray(binCount, binCount * 2);
    let peakBin = 0;
    for (let bin = 1; bin < binCount; bin += 1) {
      if ((magnitudes[bin] ?? -Infinity) > (magnitudes[peakBin] ?? -Infinity)) {
        peakBin = bin;
      }
    }
    expect(peakBin).toBe(TONE_HZ);
    expect(Math.abs(magnitudes[peakBin] ?? 0)).toBeLessThan(0.1);
    expect(result.meta.fftLengthSamples).toBe(SAMPLES);
    expect(result.meta.zeroPadSamples).toBe(0);
    expect(result.meta.capped).toBe(false);
  });

  it("changes leakage when the window changes (off-bin tone)", () => {
    const rect = run(TONE_HZ + 0.5, "rect");
    const hann = run(TONE_HZ + 0.5, "hann");
    const binCount = rect.meta.binCount;
    const valuesOf = (result: typeof rect): Float64Array => {
      const payload = result.payload;
      if (payload === undefined) {
        throw new Error("missing payload");
      }
      return new Float64Array(payload.buffer, payload.byteOffset, payload.byteLength / 8);
    };
    const rectValues = valuesOf(rect);
    const hannValues = valuesOf(hann);
    const rectLeak = rectValues[binCount + TONE_HZ + 100] ?? 0;
    const hannLeak = hannValues[binCount + TONE_HZ + 100] ?? 0;
    expect(hannLeak).toBeLessThan(rectLeak);
  });

  it("rejects an empty selection with a typed badParams", () => {
    expect(() =>
      fftSelection(
        {
          sampleRateHz: SAMPLE_RATE,
          startSample: 0,
          endSample: 0,
          windowFamily: "hann",
          windowLengthSamples: 1024,
          magnitudeMode: "db",
          phaseMode: "wrapped",
        },
        float32PayloadOf([]),
      ),
    ).toThrowError(DspOpError);
  });
});

describe("windowProfiles handler", () => {
  it("measures the textbook Hann side lobe and main-lobe width", () => {
    const result = windowProfiles({ sampleRateHz: 48000, windowLengthSamples: 256 });
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const hannIndex = result.meta.families.indexOf("hann");
    expect(hannIndex).toBeGreaterThanOrEqual(0);
    expect(result.meta.sideLobeLevelsDb[hannIndex] ?? 0).toBeCloseTo(-31.5, 0);
    const expectedWidthHz = (4 * 48000) / 256;
    expect(result.meta.mainLobeWidthsHz[hannIndex] ?? 0).toBeCloseTo(expectedWidthHz, -1);
    expect(result.meta.binCount).toBe(result.meta.fftLengthSamples / 2 + 1);
    expect(payload.byteLength / 8).toBe(result.meta.families.length * result.meta.binCount);
  });
});

describe("generateSynth handler", () => {
  it("returns exact-duration sine samples for load-as-source", () => {
    const result = generateSynth({
      waveform: "sine",
      sampleRateHz: 8000,
      durationSeconds: 0.1,
      amplitude: 0.5,
      frequencyHz: 440,
      previewBucketCount: 0,
    });
    expect(result.meta.mode).toBe("source");
    expect(result.meta.sampleCount).toBe(800);
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = float32ValuesOf(payload);
    expect(values).toHaveLength(800);
    let energy = 0;
    for (const value of values) {
      energy += value * value;
    }
    const rms = Math.sqrt(energy / values.length);
    expect(rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("returns min/max buckets for the preview mode", () => {
    const result = generateSynth({
      waveform: "chirp",
      sampleRateHz: 8000,
      durationSeconds: 0.5,
      amplitude: 0.8,
      chirpFromHz: 100,
      chirpToHz: 2000,
      chirpLog: true,
      previewBucketCount: 64,
    });
    expect(result.meta.mode).toBe("preview");
    expect(result.meta.bucketCount).toBe(64);
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    expect(float32ValuesOf(payload)).toHaveLength(128);
  });
});
