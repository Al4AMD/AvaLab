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
} from "./ops";
import type { TransferablePayload } from "./protocol";

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

describe("op table wiring", () => {
  it("carries the handler for dispatch", () => {
    expect(dspOps.sessionPing.handler).toBe(sessionPing);
  });

  it("derives typed params/results from the table (the add-one-entry lens)", () => {
    expectTypeOf<DspOpName>().toEqualTypeOf<"sessionPing">();
    expectTypeOf<DspOpParams<"sessionPing">>().toEqualTypeOf<{ count: number }>();
    expectTypeOf<DspOpResult<"sessionPing">>().toEqualTypeOf<{
      meta: { received: true };
      payload?: TransferablePayload;
    }>();
  });

  it("type-level: unknown ops are not table keys", () => {
    // @ts-expect-error "waveformOverview" lands with Task 4 — not a key yet.
    void dspOps.waveformOverview;
  });
});
