/**
 * Ingest-lane unit tests (F01, Wave-2 Plan 02 Task 1) against a stubbed
 * client following the session-layer testDoubles.ts conventions: typed fakes
 * that record their calls, real store instances over the shared FakeTransport
 * (no real Worker exists in node), and runtime-checked accessors instead of
 * casts. The decode seam is always injected — no Web Audio in node.
 *
 * Pins from the plan: ok / backend codes (known + unknown) / rate-too-high /
 * too-long / backend-offline→lane-error rejections; the courtesy size
 * pre-check fires without any fetch; a successful load REPLACES the session
 * source and EMPTIES the derived cache (never inherits previous results);
 * a rejected load never truncates — the previous source stays intact.
 */
import { describe, expect, it } from "vitest";

import type { IngestResponse } from "../../api/client";
import { createDspRpc } from "../../session/rpc";
import type { LoadSourceResult } from "../../session/store";
import { createSessionStore } from "../../session/store";
import { type FakeTransport, makeFakeTransport } from "../../session/testDoubles";
import type {
  DecodedAudio,
  DecodeWav,
  IngestCallResult,
  IngestClient,
  IngestStore,
} from "./ingest";
import { DEFAULT_MAX_UPLOAD_BYTES, IngestError, ingestFile, monoDownmix } from "./ingest";

/** Minimal fake client: returns the scripted result triple per method and
 * records the call order + FormData file name for the assertions. */
type FakeIngestClient = IngestClient & { calls: string[]; sentFileName?: string };

function fakeIngestClient(script: {
  post?: { status: number; data?: IngestResponse; errorBody?: unknown };
  get?: { status: number; data?: ArrayBuffer; errorBody?: unknown };
  throwOnPost?: unknown;
  throwOnGet?: unknown;
}): FakeIngestClient {
  const calls: string[] = [];
  const client: FakeIngestClient = {
    calls,
    async POST(_path, options) {
      calls.push("POST");
      if (script.throwOnPost !== undefined) {
        throw script.throwOnPost;
      }
      const sent = options.body.get("file");
      client.sentFileName = sent instanceof File ? sent.name : undefined;
      return scriptedCall(script.post);
    },
    async GET() {
      calls.push("GET");
      if (script.throwOnGet !== undefined) {
        throw script.throwOnGet;
      }
      return scriptedCall(script.get);
    },
  };
  return client;
}

function scriptedCall<TData>(
  script: { status: number; data?: TData; errorBody?: unknown } | undefined,
): IngestCallResult<TData> {
  const status = script?.status ?? 200;
  return {
    data: script?.data,
    error: script?.errorBody,
    response: new Response(null, { status }),
  };
}

const INGEST_OK: IngestResponse = {
  audio_id: "audio-1",
  duration_s: 0.5,
  sample_rate_hz: 44_100,
  channels: 2,
  size_bytes: 2048,
};

/** Fake decode: returns channel views and records the bytes it received. */
function fakeDecode(
  channels: Float32Array[],
  sampleRate: number,
): DecodeWav & { received?: ArrayBuffer } {
  const impl: DecodeWav & { received?: ArrayBuffer } = async (
    wavBytes: ArrayBuffer,
  ): Promise<DecodedAudio> => {
    impl.received = wavBytes;
    return {
      sampleRate,
      numberOfChannels: channels.length,
      getChannelData(channel: number): Float32Array {
        const view = channels[channel];
        if (view === undefined) {
          throw new RangeError(`fake decode: no channel ${String(channel)}`);
        }
        return view;
      },
    };
  };
  return impl;
}

type SeededStore = {
  store: ReturnType<typeof createSessionStore>;
  seededKey: string;
  transport: FakeTransport;
};

/**
 * Real store instance (shared FakeTransport, silent mode) with a previous
 * demo source and ONE seeded derived entry — the fixture the
 * "new source empties the cache" pin needs.
 */
function makeSeededStore(): SeededStore {
  const transport = makeFakeTransport("silent");
  const store = createSessionStore(createDspRpc(transport));
  const load: LoadSourceResult = store
    .getState()
    .loadSource(new Float32Array(16), 48_000, "previous.wav", "demoClip");
  expect(load).toEqual({ ok: true });
  const ticket = store.getState().derive("sessionPing", { count: 1 });
  expect(ticket).not.toBeNull();
  const seededKey = ticket?.key ?? "";
  expect(seededKey).not.toBe("");
  transport.deliver({ id: 0, ok: true, result: { meta: { empty: true } } });
  return { store, seededKey, transport };
}

function makeFile(bytes: number, name = "clip.wav"): File {
  return new File([new Uint8Array(bytes)], name, { type: "audio/wav" });
}

describe("ingestFile pre-check", () => {
  it("rejects an oversized file without any fetch", async () => {
    const client = fakeIngestClient({});
    await expect(ingestFile(makeFile(9), { client, maxUploadBytes: 8 })).rejects.toMatchObject({
      kind: "fileTooLarge",
      messageKey: "input.error.file_too_large",
    });
    expect(client.calls).toEqual([]); // no fetch: the API was never hit
  });

  it("accepts a file exactly at the cap (no rejection at the boundary)", async () => {
    // The decode throws on purpose: everything BEFORE the decode (cap check,
    // POST, GET) must have happened without a rejection.
    const client = fakeIngestClient({
      post: { status: 200, data: INGEST_OK },
      get: { status: 200, data: new ArrayBuffer(4) },
    });
    const decode: DecodeWav = async () => {
      throw new Error("decode stops here");
    };
    await expect(
      ingestFile(makeFile(8), {
        client,
        decodeWav: decode,
        maxUploadBytes: 8,
        store: makeSeededStore().store,
      }),
    ).rejects.toMatchObject({ kind: "decodeFailed" });
    expect(client.calls).toEqual(["POST", "GET"]);
  });

  it("rejects a non-positive or non-finite maxUploadBytes loudly (app bug)", async () => {
    const client = fakeIngestClient({});
    await expect(ingestFile(makeFile(1), { client, maxUploadBytes: 0 })).rejects.toThrow(TypeError);
    await expect(ingestFile(makeFile(1), { client, maxUploadBytes: Number.NaN })).rejects.toThrow(
      TypeError,
    );
    expect(client.calls).toEqual([]);
  });

  it("defaults the cap to the mirrored backend default (100 MB)", () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(104_857_600);
  });
});

describe("ingestFile success", () => {
  it("ingests, downmixes to mono, loads the store as ingested, and empties the derived cache", async () => {
    const { store, seededKey } = makeSeededStore();

    const wavBytes = new ArrayBuffer(8);
    const client = fakeIngestClient({
      post: { status: 200, data: INGEST_OK },
      get: { status: 200, data: wavBytes },
    });
    // Stereo decode: mono lane = mean of the two channels.
    const decode = fakeDecode(
      [new Float32Array([0, 0.2, 0.4, 0.6]), new Float32Array([1, 0.2, -0.4, -0.6])],
      44_100,
    );

    const result = await ingestFile(makeFile(2048, "clip.wav"), {
      client,
      decodeWav: decode,
      store,
    });

    expect(result).toEqual({
      ok: true,
      source: {
        samples: new Float32Array([0.5, 0.2, 0, 0]),
        sampleRateHz: 44_100,
        name: "clip.wav",
        sourceKind: "ingested",
      },
    });
    expect(decode.received).toBe(wavBytes); // the seam got the fetched bytes
    expect(client.calls).toEqual(["POST", "GET"]);
    expect(client.sentFileName).toBe("clip.wav");

    const state = store.getState();
    // PIN: a new source empties the derived cache and the jobs map.
    expect(state.derived.size).toBe(0);
    expect(state.jobs.size).toBe(0);
    expect(state.getDerived(seededKey).status).toBe("miss");
    // The store's original is the loaded mono lane, immutable.
    expect(state.original?.sourceKind).toBe("ingested");
    expect(state.original?.samples).toEqual(result.source.samples);
    // Success is reachability evidence (plan Review Focus 3).
    expect(state.backendOnline).toBe(true);
  });

  it("mono decode passes through as a copy (store owns its bytes)", async () => {
    const { store } = makeSeededStore();
    const channel = new Float32Array([0.25, -0.25]);
    const client = fakeIngestClient({
      post: { status: 200, data: INGEST_OK },
      get: { status: 200, data: new ArrayBuffer(4) },
    });
    await ingestFile(makeFile(16), { client, decodeWav: fakeDecode([channel], 8000), store });
    const loaded = store.getState().original;
    expect(loaded?.samples).toEqual(new Float32Array([0.25, -0.25]));
    expect(loaded?.samples).not.toBe(channel); // a copy, not the seam's view
  });
});

describe("ingestFile backend error codes", () => {
  it.each([
    ["file_too_large", "input.error.file_too_large"],
    ["duration_too_long", "input.error.duration_too_long"],
    ["decode_failed", "input.error.decode_failed"],
    ["not_found", "input.error.not_found"],
    ["invalid_request", "input.error.invalid_request"],
  ])("maps known backend code %s to its translated key", async (code, messageKey) => {
    const client = fakeIngestClient({
      post: { status: 422, errorBody: { error: { code, message: "developer text" } } },
    });
    await expect(
      ingestFile(makeFile(16), { client, store: makeSeededStore().store }),
    ).rejects.toMatchObject({ kind: "backendCode", code, messageKey });
    expect(client.calls).toEqual(["POST"]); // the download is never attempted
  });

  it("surfaces an unknown backend code verbatim through input.error.unknown", async () => {
    const client = fakeIngestClient({
      post: {
        status: 422,
        errorBody: { error: { code: "weird_code", message: "developer text" } },
      },
    });
    await expect(
      ingestFile(makeFile(16), { client, store: makeSeededStore().store }),
    ).rejects.toMatchObject({
      kind: "backendCode",
      code: "weird_code",
      messageKey: "input.error.unknown",
    });
  });

  it("classifies a 500 with a readable envelope as backendCode/internal_error (the server answered)", async () => {
    const { store } = makeSeededStore();
    // backendOnline starts false: the envelope answer is reachability
    // evidence even on a 5xx, so the flip must land.
    const client = fakeIngestClient({
      post: { status: 500, errorBody: { error: { code: "internal_error", message: "boom" } } },
    });
    await expect(ingestFile(makeFile(16), { client, store })).rejects.toMatchObject({
      kind: "backendCode",
      code: "internal_error",
      messageKey: "input.error.internal_error",
    });
    expect(client.calls).toEqual(["POST"]);
    expect(store.getState().backendOnline).toBe(true);
  });
});

describe("ingestFile store guard backstop (never truncates)", () => {
  it("rejects a rate-too-high decode with the store code and keeps the previous source", async () => {
    const { store } = makeSeededStore();
    const before = store.getState().original;
    const client = fakeIngestClient({
      post: { status: 200, data: INGEST_OK },
      get: { status: 200, data: new ArrayBuffer(4) },
    });
    await expect(
      ingestFile(makeFile(16), {
        client,
        decodeWav: fakeDecode([new Float32Array(4)], 192_000),
        store,
      }),
    ).rejects.toMatchObject({
      kind: "storeCode",
      code: "rateTooHigh",
      messageKey: "input.error.rateTooHigh",
    });

    const after = store.getState().original;
    expect(after).toBe(before); // untouched: no truncation, no clobber
    expect(store.getState().backendOnline).toBe(true); // the lane answered
  });

  it("rejects a too-long decode with the store code (cap is a rejection, not a cut)", async () => {
    const { store } = makeSeededStore();
    const before = store.getState().original;
    const client = fakeIngestClient({
      post: { status: 200, data: INGEST_OK },
      get: { status: 200, data: new ArrayBuffer(4) },
    });
    // 500 samples at 1 Hz = 500 s > 300 s cap.
    await expect(
      ingestFile(makeFile(16), {
        client,
        decodeWav: fakeDecode([new Float32Array(500)], 1),
        store,
      }),
    ).rejects.toMatchObject({
      kind: "storeCode",
      code: "tooLong",
      messageKey: "input.error.tooLong",
    });
    expect(store.getState().original).toBe(before);
  });
});

describe("ingestFile lane failures", () => {
  it("rejects with the lane error when the fetch throws, and flips backendOnline", async () => {
    const { store } = makeSeededStore();
    const client = fakeIngestClient({ throwOnPost: new TypeError("fetch failed") });
    await expect(ingestFile(makeFile(16), { client, store })).rejects.toMatchObject({
      kind: "backendUnavailable",
      messageKey: "input.error.backendUnavailable",
    });
    expect(store.getState().backendOnline).toBe(false);
  });

  it("keeps the lane error typed when the download throws after a good ingest", async () => {
    const { store } = makeSeededStore();
    const client = fakeIngestClient({
      post: { status: 200, data: INGEST_OK },
      throwOnGet: new TypeError("fetch failed"),
    });
    await expect(ingestFile(makeFile(16), { client, store })).rejects.toMatchObject({
      kind: "backendUnavailable",
    });
    expect(store.getState().backendOnline).toBe(false);
  });

  it("maps a decode seam throw to the typed decodeFailed rejection", async () => {
    const client = fakeIngestClient({
      post: { status: 200, data: INGEST_OK },
      get: { status: 200, data: new ArrayBuffer(4) },
    });
    const decode: DecodeWav = async () => {
      throw new Error("not a wav");
    };
    await expect(
      ingestFile(makeFile(16), { client, decodeWav: decode, store: makeSeededStore().store }),
    ).rejects.toMatchObject({ kind: "decodeFailed", messageKey: "input.error.decode_failed" });
  });
});

describe("ingestFile flag symmetry (the GET catch flips like the POST catch)", () => {
  /** Spy store: records the mark* calls in order. loadSource is never
   * reached on these error paths (original stays null). */
  function makeSpyStore(): { store: IngestStore; flips: string[] } {
    const flips: string[] = [];
    const store: IngestStore = {
      getState: () => ({
        loadSource: () => ({ ok: true }),
        markBackendReachable: () => {
          flips.push("reachable");
        },
        markBackendUnreachable: () => {
          flips.push("unreachable");
        },
        original: null,
      }),
    };
    return { store, flips };
  }

  it("marks reachable on a GET envelope answer (not_found), same evidence rule as the POST catch", async () => {
    const { store, flips } = makeSpyStore();
    const client = fakeIngestClient({
      post: { status: 200, data: INGEST_OK },
      get: { status: 404, errorBody: { error: { code: "not_found", message: "gone" } } },
    });
    await expect(ingestFile(makeFile(16), { client, store })).rejects.toMatchObject({
      kind: "backendCode",
      code: "not_found",
      messageKey: "input.error.not_found",
    });
    // POST success marks reachable; the GET envelope answer marks it again.
    expect(flips).toEqual(["reachable", "reachable"]);
  });

  it("marks reachable on a GET 5xx envelope answer (internal_error: the server answered)", async () => {
    const { store, flips } = makeSpyStore();
    const client = fakeIngestClient({
      post: { status: 200, data: INGEST_OK },
      get: { status: 500, errorBody: { error: { code: "internal_error", message: "boom" } } },
    });
    await expect(ingestFile(makeFile(16), { client, store })).rejects.toMatchObject({
      kind: "backendCode",
      code: "internal_error",
      messageKey: "input.error.internal_error",
    });
    expect(flips).toEqual(["reachable", "reachable"]);
  });

  it("marks unreachable on a GET lane failure (5xx without a readable envelope)", async () => {
    const { store, flips } = makeSpyStore();
    const client = fakeIngestClient({
      post: { status: 200, data: INGEST_OK },
      get: { status: 503 },
    });
    await expect(ingestFile(makeFile(16), { client, store })).rejects.toMatchObject({
      kind: "backendUnavailable",
      messageKey: "input.error.backendUnavailable",
    });
    expect(flips).toEqual(["reachable", "unreachable"]);
  });
});

describe("monoDownmix", () => {
  it("averages two channels and copies mono input", () => {
    const stereo: DecodedAudio = {
      sampleRate: 44_100,
      numberOfChannels: 2,
      getChannelData: (channel) =>
        channel === 0 ? new Float32Array([0, 1]) : new Float32Array([1, 0]),
    };
    expect(monoDownmix(stereo)).toEqual(new Float32Array([0.5, 0.5]));

    const mono: DecodedAudio = {
      sampleRate: 44_100,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.5, -0.5]),
    };
    expect(monoDownmix(mono)).toEqual(new Float32Array([0.5, -0.5]));
  });

  it("averages three channels of unequal signs", () => {
    const triple: DecodedAudio = {
      sampleRate: 48_000,
      numberOfChannels: 3,
      getChannelData: (channel) =>
        channel === 0
          ? new Float32Array([1])
          : channel === 1
            ? new Float32Array([0])
            : new Float32Array([-1]),
    };
    expect(monoDownmix(triple)).toEqual(new Float32Array([0]));
  });
});

describe("IngestError", () => {
  it("carries the structured failure and keeps an optional cause", () => {
    const cause = new TypeError("fetch failed");
    const error = new IngestError(
      { kind: "backendUnavailable", code: undefined, messageKey: "input.error.backendUnavailable" },
      { cause },
    );
    expect(error).toBeInstanceOf(IngestError);
    expect(error.kind).toBe("backendUnavailable");
    expect(error.code).toBeUndefined();
    expect(error.messageKey).toBe("input.error.backendUnavailable");
    expect(error.cause).toBe(cause);
  });
});
