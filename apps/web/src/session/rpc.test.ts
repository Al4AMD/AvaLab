/**
 * rpc tests. No real Worker in node (T1 ruling): a fake transport implements
 * the same seam but runs a REAL structured clone with a transfer list, so
 * buffer-neutering and exact-slice semantics hold like they do in the browser.
 * Export-shape tests stand in for the worker-URL wiring; the `vite preview`
 * e2e proves the real worker end to end. The transport fake and its frame
 * helpers live in `testDoubles.ts` (shared with the session-store tests).
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { TransferablePayload } from "./protocol";
import { createDspRpc, type DspRpc, DspRpcError } from "./rpc";
import {
  cancelFramesOf,
  type FakeTransport,
  float32PayloadOf,
  float32ValuesOf,
  makeFakeTransport,
  requestAt,
  requestsOf,
  uint8,
} from "./testDoubles";

function makeRpc(mode: "echo" | "silent" = "echo"): { rpc: DspRpc; transport: FakeTransport } {
  const transport = makeFakeTransport(mode);
  return { rpc: createDspRpc(transport), transport };
}

describe("request frames over the seam", () => {
  it("round-trips a whole-buffer payload through a real structured-clone transfer", async () => {
    const { rpc, transport } = makeRpc("echo");
    const payload = float32PayloadOf([1.5, -2.5, 0.25]);
    const originalBuffer = payload.buffer;

    const promise = rpc.call("sessionPing", { count: 2 }, payload);

    expect(promise.callId).toBe(0); // ids are monotonic from 0
    const sent = requestAt(transport, 0) as { payload?: TransferablePayload };
    expect(sent.payload?.buffer).toBe(originalBuffer); // zero-copy: the same buffer object rides the wire
    expect(transport.sent[0]?.transfer).toEqual([originalBuffer]);

    // The sender is neutered by the transfer, like postMessage in a browser.
    // (The buffer's byteLength reads 0 with an ArrayBuffer that was detached.)
    expect(originalBuffer.byteLength).toBe(0);

    await expect(promise).resolves.toMatchObject({ meta: { received: true } });
    const outcome = (await promise) as { payload?: TransferablePayload };
    expect(outcome.payload?.byteLength).toBe(12);
    expect(float32ValuesOf(outcome.payload ?? float32PayloadOf([0]))).toEqual([1.5, -2.5, 0.25]);
  });

  it("round-trips calls without a payload, transfer list empty", async () => {
    const { rpc, transport } = makeRpc("echo");
    const promise = rpc.call("sessionPing", { count: 1 });
    const sent = requestAt(transport, 0);
    expect("payload" in sent).toBe(false);
    expect(transport.sent[0]?.transfer).toEqual([]);
    await expect(promise).resolves.toEqual({ meta: { received: true } });
  });

  it("normalizes inner slices: exactly byteLength bytes move", async () => {
    const { rpc, transport } = makeRpc("echo");
    const source = new ArrayBuffer(12);
    const view = new Uint8Array(source);
    for (let index = 0; index < 12; index += 1) {
      view[index] = index + 1;
    }

    const promise = rpc.call(
      "sessionPing",
      { count: 1 },
      { buffer: source, byteOffset: 4, byteLength: 4 },
    );

    const payload = (requestAt(transport, 0) as { payload?: TransferablePayload }).payload;
    expect(payload).toBeDefined();
    expect(payload?.byteOffset).toBe(0);
    expect(payload?.byteLength).toBe(4);
    expect(transport.sent[0]?.transfer).toEqual([payload?.buffer]);
    // The rpc's slice copy was neutered by the simulated postMessage — its
    // move is the whole point (buffer detached ⇒ byteLength reads 0).
    expect(payload?.buffer.byteLength).toBe(0);

    // The source buffer survived the COPY but its payload region is consumed
    // (per the protocol ownership doc).
    expect(source.byteLength).toBe(12);
    expect(uint8(source)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // Exactly byteLength bytes moved: the worker's view holds the slice alone.
    const receivedFrame = transport.receivedFrames[0];
    expect(receivedFrame?.payloadBytes).toEqual(new Uint8Array([5, 6, 7, 8]));

    // And the echo carries the same bytes back out of the worker.
    await expect(promise).resolves.toMatchObject({ meta: { received: true } });
    const outcome = (await promise) as { payload?: TransferablePayload };
    expect(outcome.payload?.buffer.byteLength).toBe(4);
    expect(uint8(outcome.payload?.buffer ?? new ArrayBuffer(0))).toEqual([5, 6, 7, 8]);
  });

  it("rejects typed errors as DspRpcError with the wire code", async () => {
    const { rpc, transport } = makeRpc("silent");
    const promise = rpc.call("sessionPing", { count: 1 });
    transport.deliver({ id: 0, ok: false, error: { code: "badParams", message: "boom" } });

    await expect(promise).rejects.toBeInstanceOf(DspRpcError);
    await expect(promise).rejects.toMatchObject({ code: "badParams", message: "boom" });
  });

  it("rejects malformed outgoing payload descriptors and params instead of throwing", async () => {
    const { rpc, transport } = makeRpc("silent");
    const outOfRange = rpc.call(
      "sessionPing",
      { count: 1 },
      { buffer: new ArrayBuffer(4), byteOffset: 3, byteLength: 4 },
    );
    await expect(outOfRange).rejects.toMatchObject({ code: "badPayload" });

    const nonInteger = rpc.call(
      "sessionPing",
      { count: 1 },
      { buffer: new ArrayBuffer(4), byteOffset: 1.5, byteLength: 2 },
    );
    await expect(nonInteger).rejects.toMatchObject({ code: "badPayload" });

    // Non-JSON params (canonicalJson throws) reject as badParams.
    const badParams = rpc.call("sessionPing", { count: Number.NaN });
    await expect(badParams).rejects.toMatchObject({ code: "badParams" });

    expect(requestsOf(transport)).toHaveLength(0);
  });

  it("allocates ids from a monotonic counter across calls", () => {
    const { rpc, transport } = makeRpc("silent");
    void rpc.call("sessionPing", { count: 1 });
    void rpc.call("sessionPing", { count: 2 });
    void rpc.call("sessionPing", { count: 3 });
    const ids = requestsOf(transport).map((request) => request.id);
    expect(ids).toEqual([0, 1, 2]);
  });
});

describe("supersede and cancel semantics", () => {
  it("supersedes identical op+params: old resolves cancelled, cancel frame sent, new call wins", async () => {
    const { rpc, transport } = makeRpc("silent");
    const first = rpc.call("sessionPing", { count: 1 });
    const second = rpc.call("sessionPing", { count: 1 });

    await expect(first).resolves.toEqual({ cancelled: true });
    expect(cancelFramesOf(transport)).toEqual([{ type: "cancel", id: 0 }]);
    expect(requestsOf(transport).map((request) => request.id)).toEqual([0, 1]);

    // Late result for the superseded id can never reach the caller…
    transport.deliver({ id: 0, ok: true, result: { meta: { received: true } } });
    // …and the live call settles normally.
    transport.deliver({ id: 1, ok: true, result: { meta: { received: true } } });
    await expect(second).resolves.toEqual({ meta: { received: true } });
  });

  it("does NOT supersede different params: both pending calls settle independently", async () => {
    const { rpc, transport } = makeRpc("silent");
    const first = rpc.call("sessionPing", { count: 1 });
    const second = rpc.call("sessionPing", { count: 2 });

    expect(cancelFramesOf(transport)).toEqual([]);
    expect(requestsOf(transport)).toHaveLength(2);

    transport.deliver({ id: 0, ok: true, result: { meta: { received: true } } });
    await expect(first).resolves.toEqual({ meta: { received: true } });
    transport.deliver({ id: 1, ok: true, result: { meta: { received: true } } });
    await expect(second).resolves.toEqual({ meta: { received: true } });
  });

  it("a settled call leaves no supersede key behind", async () => {
    const { rpc, transport } = makeRpc("silent");
    const first = rpc.call("sessionPing", { count: 1 });
    transport.deliver({ id: 0, ok: true, result: { meta: { received: true } } });
    await expect(first).resolves.toEqual({ meta: { received: true } });

    const second = rpc.call("sessionPing", { count: 1 });
    expect(cancelFramesOf(transport)).toEqual([]); // nothing pending to supersede
    expect(requestsOf(transport)).toHaveLength(2);
    transport.deliver({ id: 1, ok: true, result: { meta: { received: true } } });
    await expect(second).resolves.toEqual({ meta: { received: true } });
  });

  it("cancel(id) resolves cancelled, informs the worker, drops late frames", async () => {
    const { rpc, transport } = makeRpc("silent");
    const promise = rpc.call("sessionPing", { count: 1 });
    rpc.cancel(promise.callId);

    await expect(promise).resolves.toEqual({ cancelled: true });
    expect(cancelFramesOf(transport)).toEqual([{ type: "cancel", id: 0 }]);
    // Late success frame for the cancelled id: dropped silently.
    expect(() =>
      transport.deliver({ id: 0, ok: true, result: { meta: { received: true } } }),
    ).not.toThrow();
    await expect(promise).resolves.toEqual({ cancelled: true });
  });

  it("cancelling an already-settled or unknown id sends no frame", async () => {
    const { rpc, transport } = makeRpc("silent");
    rpc.cancel(42);
    expect(requestsOf(transport)).toHaveLength(0);
    expect(cancelFramesOf(transport)).toEqual([]);

    const promise = rpc.call("sessionPing", { count: 1 });
    transport.deliver({ id: 0, ok: true, result: { meta: { received: true } } });
    await expect(promise).resolves.toEqual({ meta: { received: true } });
    rpc.cancel(0); // already settled
    expect(cancelFramesOf(transport)).toEqual([]);
  });

  it("terminate settles every pending call cancelled and kills the transport", async () => {
    const { rpc, transport } = makeRpc("silent");
    const pending1 = rpc.call("sessionPing", { count: 1 });
    void rpc.call("sessionPing", { count: 2 });
    const pending3 = rpc.call("sessionPing", { count: 3 });
    rpc.terminate();

    await expect(pending1).resolves.toEqual({ cancelled: true });
    await expect(pending3).resolves.toEqual({ cancelled: true });
    expect(transport.terminated).toBe(true);
    // No late frame can resurrect a pending id on a terminated rpc.
    transport.deliver({ id: 0, ok: true, result: { meta: { received: true } } });
    await expect(pending1).resolves.toEqual({ cancelled: true });
  });

  it("warns and keeps the pending call intact on malformed response frames", async () => {
    const { rpc, transport } = makeRpc("silent");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const promise = rpc.call("sessionPing", { count: 1 });

    transport.deliver("not a frame");
    transport.deliver({});
    transport.deliver({ id: "x", ok: true });
    transport.deliver({ id: 0, ok: true /* neither result nor cancelled */ });
    expect(warn).toHaveBeenCalledTimes(4);

    transport.deliver({ id: 0, ok: true, result: { meta: { received: true } } });
    await expect(promise).resolves.toEqual({ meta: { received: true } });
    warn.mockRestore();
  });
});

describe("wiring and type surface", () => {
  it("exposes the app singleton wiring (lazy: node must not spawn a Worker)", async () => {
    const mod = await import("./rpc");
    expect(typeof mod.createDspRpc).toBe("function");
    expect(typeof mod.createDspWorkerTransport).toBe("function");
    expect(typeof mod.getDspWorkerRpc).toBe("function");
    expect(typeof mod.dspWorkerRpc.call).toBe("function");
    expect(typeof mod.dspWorkerRpc.cancel).toBe("function");
    expect(typeof mod.dspWorkerRpc.terminate).toBe("function");
    // The real worker URL wiring (same-origin module worker) is proven by the
    // `vite preview` e2e: the waveform stub ping data-testid can only appear
    // if the built worker answers.
  });

  it("rejects typed workerUnavailable when the Worker constructor throws, then retries", async () => {
    const mod = await import("./rpc");
    // Node has no real Worker (T1 ruling): stub one at the global. First
    // construction throws like a blocked worker / CSP does in the browser;
    // the retry stands in for "transport construction now works".
    class StubWorker {
      static attempts = 0;
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() {
        StubWorker.attempts += 1;
        if (StubWorker.attempts === 1) {
          throw new Error("blocked (test stand-in)");
        }
      }
      postMessage(): void {} // silent: the recovered call hangs until terminate
      terminate(): void {}
    }
    vi.stubGlobal("Worker", StubWorker as unknown as typeof Worker);

    // Unguarded call: if construction threw synchronously the test would die
    // here — instead the promise settles later, like a wire error frame.
    const first = mod.dspWorkerRpc.call("sessionPing", { count: 1 });
    await expect(first).rejects.toBeInstanceOf(DspRpcError);
    await expect(first).rejects.toMatchObject({ code: "workerUnavailable" });

    // Recovery: no half-initialized singleton was cached — the retry builds
    // a fresh rpc and posts the frame normally (ids restart at 0).
    const recovered = mod.dspWorkerRpc.call("sessionPing", { count: 2 });
    expect(StubWorker.attempts).toBe(2);
    expect(recovered.callId).toBe(0);
    mod.dspWorkerRpc.terminate(); // settle the pending call + reset singleton
    await expect(recovered).resolves.toEqual({ cancelled: true });
    expect(StubWorker.attempts).toBe(2); // terminate does not re-construct

    vi.unstubAllGlobals();
  });

  it("allows exactly one transport subscription", () => {
    const transport = makeFakeTransport("silent");
    createDspRpc(transport);
    expect(() => {
      createDspRpc(transport);
    }).toThrow(/subscribed once/);
  });

  it("type-level: call is typed against the op table", async () => {
    const { rpc } = makeRpc("silent");
    expectTypeOf(rpc.call<"sessionPing">).toBeFunction();
    // @ts-expect-error op must be a table key (an op no plan ever adds)
    const unknownOp = rpc.call("definitelyNotAnOp", { bucketCount: 8 });
    // @ts-expect-error params must match the op's params type
    const wrongShape = rpc.call("sessionPing", { bucketCount: 8 });
    // These two would post bogus op frames that a silent fake never answers,
    // so the leaked pending is consumed with an ignored rejection.
    unknownOp.catch(() => undefined);
    wrongShape.catch(() => undefined);

    // @ts-expect-error params are required
    const missingParams = rpc.call("sessionPing");
    // The runtime counterpart of the missing-params compile error: rejects
    // typed, never throws synchronously.
    await expect(missingParams).rejects.toMatchObject({ code: "badParams" });
  });
});
