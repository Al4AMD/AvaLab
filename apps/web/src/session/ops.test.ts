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
  sessionPing,
  waveformOverview,
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
    expect(result.meta).toEqual({ sampleCount: 0, sampleRateHz: 44_100, bucketCount: 8 });
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
  });

  it("derives typed params/results from the table (the add-one-entry lens)", () => {
    expectTypeOf<DspOpName>().toEqualTypeOf<"sessionPing" | "waveformOverview">();
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
  });

  it("type-level: unknown ops are not table keys", () => {
    // @ts-expect-error an op no plan ever adds — table keys stay closed.
    void dspOps.definitelyNotAnOp;
  });
});
