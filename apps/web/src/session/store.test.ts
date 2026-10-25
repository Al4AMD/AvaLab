/**
 * Session-store tests over the shared FakeTransport (testDoubles.ts): the
 * store drives a REAL `createDspRpc` instance through it, so supersede/cancel
 * semantics, buffer transfers and typed rejections behave exactly as they do
 * against the browser worker. Frames are asserted at the transport level.
 *
 * Naming conventions from the briefs: cache key = `op \u0000 canonicalJson(
 * params) \u0000 inputHash`; the T2 rpc supersede key is `op \u0000 canonicalJson(
 * params)` (hashless — that is the layer that makes the newest call of the
 * same op+params win). Ping semantics are store-state diagnostics, not
 * derives (R23 pragma).
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { TransferablePayload } from "./protocol";
import { createDspRpc, DspRpcError } from "./rpc";
import type {
  DerivedLookup,
  DeriveTicket,
  JobEntry,
  LoadSourceResult,
  SessionStore,
  SourceKind,
} from "./store";
import { createSessionStore, MAX_DURATION_SECONDS, MAX_SAMPLE_RATE_HZ } from "./store";
import {
  cancelFramesOf,
  type FakeTransport,
  makeFakeTransport,
  requestAt,
  requestsOf,
} from "./testDoubles";

type Harness = {
  store: ReturnType<typeof createSessionStore>;
  transport: FakeTransport;
};

function makeStore(): Harness {
  const transport = makeFakeTransport("silent");
  return { store: createSessionStore(createDspRpc(transport)), transport };
}

/** Deterministic pseudo-audio: LCG sine + low-level noise over N samples. */
function fakeAudio(sampleCount: number, seedOffset = 1): Float32Array {
  let state = (0x183f2b + seedOffset * 7919) >>> 0;
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    samples[index] =
      Math.sin((2 * Math.PI * 440 * index) / 48000) * 0.4 + ((state % 2001) - 1000) / 100000;
  }
  return samples;
}

function expectOk(result: LoadSourceResult): void {
  expect(result).toEqual({ ok: true });
}

function expectCode(result: LoadSourceResult, code: string): void {
  expect(result).toEqual({ ok: false, code });
}

/** Seed the ping response the way the worker does (descriptor with the same
 * 4-byte buffer transferred back out of the "worker"). */
function pingPayloadFrame(id: number): unknown {
  const bytes = new Uint8Array(4);
  return {
    id,
    ok: true,
    result: {
      meta: { received: true },
      payload: { buffer: bytes.buffer, byteOffset: 0, byteLength: 4 } satisfies TransferablePayload,
    },
  };
}

describe("loadSource guards", () => {
  it("accepts a valid source with caps met and resets session state", () => {
    const { store } = makeStore();
    const samples = fakeAudio(3);
    expectOk(store.getState().loadSource(samples, 48000, "clip.wav", "demoClip"));
    const state = store.getState();
    expect(state.original).toEqual({
      samples,
      sampleRateHz: 48000,
      name: "clip.wav",
      sourceKind: "demoClip",
    });
    expect(state.inputHash).toMatch(/^[0-9a-f]{16}$/);
    // Selection widens to the whole (half-open) source range.
    expect(state.selection).toEqual({ startSample: 0, endSample: 3 });
    expect(state.derived.size).toBe(0);
    expect(state.jobs.size).toBe(0);
    expect(state.backendOnline).toBe(false);
  });

  it("rejects a non-Float32Array with invalidType", () => {
    const { store } = makeStore();
    const asSamples = [0.1, 0.2] as unknown as Float32Array;
    expectCode(store.getState().loadSource(asSamples, 48000, "x.wav", "demoClip"), "invalidType");
  });

  it("rejects malformed name/sourceKind arg types with invalidType", () => {
    const { store } = makeStore();
    const samples = fakeAudio(2);
    expectCode(
      store.getState().loadSource(samples, 48000, 42 as unknown as string, "demoClip"),
      "invalidType",
    );
    expectCode(
      store.getState().loadSource(samples, 48000, "x.wav", "mystery" as unknown as SourceKind),
      "invalidType",
    );
  });

  it("rejects non-finite samples and non-finite rate with notFinite", () => {
    const { store } = makeStore();
    expectCode(
      store.getState().loadSource(new Float32Array([1, Number.NaN]), 48000, "x.wav", "demoClip"),
      "notFinite",
    );
    expectCode(
      store
        .getState()
        .loadSource(new Float32Array([1, Number.POSITIVE_INFINITY]), 48000, "x.wav", "demoClip"),
      "notFinite",
    );
    expectCode(
      store.getState().loadSource(fakeAudio(2), Number.NaN, "x.wav", "demoClip"),
      "notFinite",
    );
    expectCode(
      store.getState().loadSource(fakeAudio(2), Number.POSITIVE_INFINITY, "x.wav", "demoClip"),
      "notFinite",
    );
  });

  it("rejects a non-positive rate with invalidType (domain error, per store docs)", () => {
    const { store } = makeStore();
    expectCode(store.getState().loadSource(fakeAudio(2), 0, "x.wav", "demoClip"), "invalidType");
    expectCode(
      store.getState().loadSource(fakeAudio(2), -48000, "x.wav", "demoClip"),
      "invalidType",
    );
  });

  it("rejects a rate above the 96 kHz cap with rateTooHigh (96000 itself is accepted)", () => {
    const { store } = makeStore();
    expectCode(
      store.getState().loadSource(fakeAudio(2), 96_001, "x.wav", "demoClip"),
      "rateTooHigh",
    );
    expectOk(store.getState().loadSource(fakeAudio(2), MAX_SAMPLE_RATE_HZ, "x.wav", "demoClip"));
  });

  it("rejects sources longer than 300 s of samples with tooLong (300.000.. is accepted)", () => {
    const { store } = makeStore();
    // 1 Hz rate: 301 samples = 301 s → too long.
    expectCode(
      store.getState().loadSource(new Float32Array(301), 1, "x.wav", "demoClip"),
      "tooLong",
    );
    // Exactly 300 s stays legal.
    expectOk(store.getState().loadSource(new Float32Array(300), 1, "boundary.wav", "demoClip"));
    expect(MAX_DURATION_SECONDS).toBe(300);
  });

  it("a rejected load leaves a previously loaded source fully intact", () => {
    const { store } = makeStore();
    const first = fakeAudio(4);
    expectOk(store.getState().loadSource(first, 48000, "first.wav", "demoClip"));
    const before = store.getState();
    expectCode(
      store.getState().loadSource(new Float32Array(999_999), 1, "long.wav", "demoClip"),
      "tooLong",
    );
    const after = store.getState();
    expect(after.original?.samples).toBe(before.original?.samples);
    expect(after.inputHash).toBe(before.inputHash);
    expect(after.selection).toEqual(before.selection);
  });
});

describe("derive cache and tickets", () => {
  it("requires a source: derive before load returns null and posts nothing", () => {
    const { store, transport } = makeStore();
    expect(store.getState().derive("sessionPing", { count: 1 })).toBeNull();
    expect(requestsOf(transport)).toHaveLength(0);
  });

  it("round-trips a miss through the transport into ready state (meta {empty:true} echo)", async () => {
    const { store, transport } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(16), 48000, "a.wav", "demoClip"));

    const ticket = store.getState().derive("sessionPing", { count: 1 });
    expect(ticket).not.toBeNull();
    const key = ticket?.key ?? "";
    // Key shape: op ∝ canonical params ∝ input hash, NUL-separated.
    expect(key.startsWith(`sessionPing\u0000{"count":1}\u0000`)).toBe(true);
    expect(key.split("\u0000")).toHaveLength(3);
    expect(store.getState().getDerived(key)).toEqual({ status: "pending" });
    // While pending: a job with the worker seam and no progress signal yet.
    const job = store.getState().jobs.get(key) as JobEntry;
    expect(job.progressPct).toBeNull();
    expect(typeof job.cancel).toBe("function");
    expect(requestsOf(transport)).toHaveLength(1);

    transport.deliver({ id: 0, ok: true, result: { meta: { empty: true } } });
    await expect(ticket?.outcome).resolves.toEqual({ meta: { empty: true } });
    await vi.waitFor(() => {
      expect(store.getState().getDerived(key).status).toBe("ready");
    });
    const lookup: DerivedLookup = store.getState().getDerived(key);
    if (lookup.status !== "ready") {
      throw new Error(`expected ready, got ${String(lookup.status)}`);
    }
    expect(lookup.entry.result).toEqual({ meta: { empty: true } });
    expect(lookup.entry.key).toBe(key);
    // The settled job leaves the map; nothing else stays behind.
    expect(store.getState().jobs.size).toBe(0);
  });

  it("cache hit resolves synchronously without a second worker frame", async () => {
    const { store, transport } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(16), 48000, "a.wav", "demoClip"));

    const ticket1 = store.getState().derive("sessionPing", { count: 1 });
    expect(ticket1).not.toBeNull();
    const key = ticket1?.key ?? "";
    transport.deliver({ id: 0, ok: true, result: { meta: { empty: true } } });
    await vi.waitFor(() => expect(store.getState().getDerived(key).status).toBe("ready"));

    const ticket2 = store.getState().derive("sessionPing", { count: 1 });
    expect(ticket2).not.toBeNull();
    expect(ticket2?.key).toBe(key);
    expect(store.getState().jobs.size).toBe(0); // no new pending job
    expect(requestsOf(transport)).toHaveLength(1); // no second round trip
    await expect(ticket2?.outcome).resolves.toEqual({ meta: { empty: true } });
  });

  it("parameter order canonicalizes to the same key (params are key-sorted JSON)", async () => {
    const { store, transport } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(16), 48000, "a.wav", "demoClip"));
    const ticketA = store.getState().derive("sessionPing", { count: 0, label: "x" } as never);
    expect(ticketA).not.toBeNull();
    const keyA = ticketA?.key ?? "";
    transport.deliver({ id: 0, ok: true, result: { meta: { empty: true } } });
    await vi.waitFor(() => expect(store.getState().getDerived(keyA).status).toBe("ready"));

    // Same values, different write order → same canonical key → cache hit.
    const ticketB = store.getState().derive("sessionPing", { label: "x", count: 0 } as never);
    expect(ticketB?.key).toBe(keyA);
    expect(requestsOf(transport)).toHaveLength(1);
  });

  it("throws TypeError loudly on params that cannot canonicalize, before any frame", () => {
    const { store, transport } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(16), 48000, "a.wav", "demoClip"));
    expect(() => store.getState().derive("sessionPing", { count: Number.NaN })).toThrow(TypeError);
    expect(() => store.getState().derive("sessionPing", { count: [new Map()] as never })).toThrow(
      TypeError,
    );
    expect(requestsOf(transport)).toHaveLength(0);
    expect(store.getState().jobs.size).toBe(0);
  });

  it("double derive with the same params supersedes: first resolves cancelled, cache unaffected", async () => {
    const { store, transport } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(16), 48000, "a.wav", "demoClip"));

    const first = store.getState().derive("sessionPing", { count: 1 });
    const second = store.getState().derive("sessionPing", { count: 1 });
    expect(first?.key).toBe(second?.key); // same cache key…

    // …the rpc layer kept unaltered frame ids and auto-cancelled the loser.
    const ids = requestsOf(transport).map((request) => request.id);
    expect(ids).toEqual([0, 1]);
    expect(cancelFramesOf(transport)).toEqual([{ type: "cancel", id: 0 }]);
    await expect(first?.outcome).resolves.toEqual({ cancelled: true });

    // The job under the key is the LIVE (second) call: cancel targets IT.
    const job = store.getState().jobs.get(second?.key ?? "") as JobEntry;
    expect(job.callId).toBe(1);

    transport.deliver({ id: 1, ok: true, result: { meta: { empty: true } } });
    await vi.waitFor(() =>
      expect(store.getState().getDerived(second?.key ?? "").status).toBe("ready"),
    );
    // The superseded call's late frame can never resurrect anything.
    transport.deliver({ id: 0, ok: true, result: { meta: { poisoned: true } } });
    expect(store.getState().getDerived(second?.key ?? "").status).toBe("ready");
    await expect(first?.outcome).resolves.toEqual({ cancelled: true });
    const lookup = store.getState().getDerived(second?.key ?? "");
    if (lookup.status !== "ready") {
      throw new Error(`expected ready, got ${String(lookup.status)}`);
    }
    expect(lookup.entry.result).toEqual({ meta: { empty: true } }); // cache unaffected by the loser
  });
});

describe("cancel(jobKey)", () => {
  it("cancels the rpc id, clears the pending job and stays a no-op afterwards", async () => {
    const { store, transport } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(16), 48000, "a.wav", "demoClip"));
    const ticket = store.getState().derive("sessionPing", { count: 1 });
    expect(ticket).not.toBeNull();
    const key = ticket?.key ?? "";

    store.getState().cancel(key);
    await expect(ticket?.outcome).resolves.toEqual({ cancelled: true });
    expect(cancelFramesOf(transport)).toEqual([{ type: "cancel", id: 0 }]);
    await vi.waitFor(() => expect(store.getState().jobs.size).toBe(0));
    expect(store.getState().getDerived(key)).toEqual({ status: "miss" });

    // Second cancel: the job is gone (or its promise already settled) — no
    // throw, no extra frame, and a late frame is dropped by the rpc layer.
    expect(() => store.getState().cancel(key)).not.toThrow();
    expect(cancelFramesOf(transport)).toHaveLength(1);
    transport.deliver({ id: 0, ok: true, result: { meta: { late: true } } });
    expect(store.getState().getDerived(key)).toEqual({ status: "miss" });
    await expect(ticket?.outcome).resolves.toEqual({ cancelled: true });
  });

  it("cancelling an unknown key neither throws nor sends frames", () => {
    const { store, transport } = makeStore();
    expect(() => store.getState().cancel("no such key")).not.toThrow();
    expect(requestsOf(transport)).toHaveLength(0);
    expect(cancelFramesOf(transport)).toHaveLength(0);
  });
});

describe("failures keep the cache clean and reject the ticket", () => {
  it("an opFailed error frame deletes the job, keeps getDerived a miss and rejects DspRpcError", async () => {
    const { store, transport } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(16), 48000, "a.wav", "demoClip"));
    const ticket = store.getState().derive("sessionPing", { count: 1 });
    const key = ticket?.key ?? "";

    transport.deliver({ id: 0, ok: false, error: { code: "opFailed", message: "boom" } });
    await expect(ticket?.outcome).rejects.toBeInstanceOf(DspRpcError);
    await expect(ticket?.outcome).rejects.toMatchObject({ code: "opFailed" });
    await vi.waitFor(() => expect(store.getState().jobs.size).toBe(0));
    // Not cached: a re-derive starts a fresh worker round trip.
    expect(store.getState().getDerived(key)).toEqual({ status: "miss" });
    const retry = store.getState().derive("sessionPing", { count: 1 });
    expect(requestsOf(transport)).toHaveLength(2);
    expect(retry?.key).toBe(key);
    transport.deliver({ id: 1, ok: true, result: { meta: { empty: true } } });
    await expect(retry?.outcome).resolves.toEqual({ meta: { empty: true } });
  });
});

describe("reload invalidates everything", () => {
  it("empties the derived cache and jobs, and changes the input hash", async () => {
    const { store, transport } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(4), 48000, "first.wav", "demoClip"));
    const firstHash = store.getState().inputHash;
    const firstTicket = store.getState().derive("sessionPing", { count: 1 });
    const firstKey = firstTicket?.key ?? "";
    transport.deliver({ id: 0, ok: true, result: { meta: { empty: true } } });
    await vi.waitFor(() => expect(store.getState().getDerived(firstKey).status).toBe("ready"));

    expectOk(store.getState().loadSource(fakeAudio(4, 2), 48000, "second.wav", "demoClip"));
    const state = store.getState();
    expect(state.derived.size).toBe(0);
    expect(state.jobs.size).toBe(0);
    expect(state.getDerived(firstKey)).toEqual({ status: "miss" }); // old key dead
    expect(state.inputHash).not.toBe(firstHash); // different bytes → different hash
    expect(state.selection).toEqual({ startSample: 0, endSample: 4 });
    // The previous source buffer was never mutated by the store.
    expect(requestsOf(transport)).toHaveLength(1); // no cancellations were even necessary
  });

  it("a late settle from the old source cannot resurrect into the emptied cache", async () => {
    const { store, transport } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(4), 48000, "first.wav", "demoClip"));
    const staleTicket = store.getState().derive("sessionPing", { count: 1 });
    expectOk(store.getState().loadSource(fakeAudio(4, 2), 48000, "second.wav", "demoClip"));

    // The old call's result arrives AFTER the reload…
    transport.deliver({ id: 0, ok: true, result: { meta: { stale: true } } });
    // …its promise settles, but BOTH maps stay empty: no job of a dead
    // source survives, no stale result poisons the new source's cache.
    await expect(staleTicket?.outcome).resolves.toEqual({ meta: { stale: true } });
    expect(store.getState().derived.size).toBe(0);
    expect(store.getState().jobs.size).toBe(0);
  });
});

describe("setSelection clamps and orders", () => {
  it("clamps to [0, N] and orders ascending (half-open [start, end))", () => {
    const { store } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(1000), 48000, "a.wav", "demoClip"));
    store.getState().setSelection(-10, 2000);
    expect(store.getState().selection).toEqual({ startSample: 0, endSample: 1000 });
    store.getState().setSelection(500, 100);
    expect(store.getState().selection).toEqual({ startSample: 100, endSample: 500 });
    store.getState().setSelection(300, 400);
    expect(store.getState().selection).toEqual({ startSample: 300, endSample: 400 });
    // Rounding floats from canvas-space conversions stays integer-exact.
    store.getState().setSelection(250.6, 700.4);
    expect(store.getState().selection).toEqual({ startSample: 251, endSample: 700 });
  });

  it("non-finite input is a documented no-op", () => {
    const { store } = makeStore();
    expectOk(store.getState().loadSource(fakeAudio(1000), 48000, "a.wav", "demoClip"));
    store.getState().setSelection(10, 20);
    store.getState().setSelection(Number.NaN, 5);
    store.getState().setSelection(2, Number.POSITIVE_INFINITY);
    expect(store.getState().selection).toEqual({ startSample: 10, endSample: 20 });
  });

  it("without a source everything clamps to {0, 0}", () => {
    const { store } = makeStore();
    store.getState().setSelection(10, 20);
    expect(store.getState().selection).toEqual({ startSample: 0, endSample: 0 });
    store.getState().setSelection(-5, -1);
    expect(store.getState().selection).toEqual({ startSample: 0, endSample: 0 });
  });
});

describe("ping diagnostics (store-owned, not a derive)", () => {
  it("is guarded idempotent: one wire round trip across double/requesting storms", async () => {
    const { store, transport } = makeStore();
    store.getState().sessionTroubleshootingPing();
    // Double-mount (StrictMode) while the first is still pending: no-op.
    store.getState().sessionTroubleshootingPing();
    expect(requestsOf(transport)).toHaveLength(1);
    const sent = requestAt(transport, 0);
    expect(sent.op).toBe("sessionPing");
    expect(sent.payload?.byteLength).toBe(4);
    expect(store.getState().diagnostics.pingStatus).toBe("pending");

    transport.deliver(pingPayloadFrame(0));
    await vi.waitFor(() => expect(store.getState().diagnostics.pingStatus).toBe("done"));
    expect(store.getState().diagnostics.pingByteLength).toBe(4); // the e2e contract value

    // Done: once per browser session — revisits stay silent.
    store.getState().sessionTroubleshootingPing();
    expect(requestsOf(transport)).toHaveLength(1);
  });

  it("a failed ping resets to a retryable state (workerUnavailable case)", async () => {
    const { store, transport } = makeStore();
    store.getState().sessionTroubleshootingPing();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    transport.deliver({ id: 0, ok: false, error: { code: "workerUnavailable" } });
    await vi.waitFor(() => expect(store.getState().diagnostics.pingStatus).toBe("failed"));
    expect(store.getState().diagnostics.pingByteLength).toBeNull();
    warn.mockRestore();

    // Retry fires a fresh frame and can succeed.
    store.getState().sessionTroubleshootingPing();
    expect(requestsOf(transport)).toHaveLength(2);
    transport.deliver(pingPayloadFrame(1));
    await vi.waitFor(() => expect(store.getState().diagnostics.pingStatus).toBe("done"));
    expect(store.getState().diagnostics.pingByteLength).toBe(4);
  });
});

describe("backendOnline flag", () => {
  it("defaults to false and flips only via the mark actions", () => {
    const { store } = makeStore();
    expect(store.getState().backendOnline).toBe(false);
    store.getState().markBackendReachable();
    expect(store.getState().backendOnline).toBe(true);
    store.getState().markBackendUnreachable();
    expect(store.getState().backendOnline).toBe(false);
  });
});

describe("type surface", () => {
  it("derive is typed against the op table and the ticket is op-keyed", async () => {
    const { store } = makeStore();
    // @ts-expect-error op must be a table key ("waveformOverview" lands with T4)
    void store.getState().derive("waveformOverview", { bucketCount: 8 });
    // @ts-expect-error params must match the op's params type
    void store.getState().derive("sessionPing", { bucketCount: 8 });

    const ticket: DeriveTicket<"sessionPing"> | null = store
      .getState()
      .derive("sessionPing", { count: 1 });
    expectTypeOf(ticket).toEqualTypeOf<DeriveTicket<"sessionPing"> | null>();
    expectTypeOf<JobEntry["cancel"]>().toEqualTypeOf<() => void>();
    expectTypeOf<SessionStore["selection"]["startSample"]>().toEqualTypeOf<number>();
  });
});
