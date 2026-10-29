/**
 * Offline-lane unit tests (F01, Wave-2 Plan 02 Task 2) — same conventions
 * as ingest.test.ts: real session store instances over the shared
 * FakeTransport (no real Worker in node), typed fakes that record their
 * calls, and the decode seam ALWAYS injected (no Web Audio in node).
 *
 * Seam-reuse pins (brief): the tests explicitly inject the shared
 * `browserDecodeWav` seam factory from Task 1 — its node failure mode
 * (`AudioContext` is not defined inside the seam) proves the offline bytes
 * route into Task 1's decode implementation, not a second one — and the
 * no-injection default is probed the same way. The ok-path fixture mirrors
 * ingest.test.ts's seeded store (test files do not import each other).
 */
import { describe, expect, it } from "vitest";

import { createDspRpc } from "../../session/rpc";
import type { LoadSourceResult } from "../../session/store";
import { createSessionStore } from "../../session/store";
import { type FakeTransport, makeFakeTransport } from "../../session/testDoubles";
import { browserDecodeWav, type DecodedAudio, type DecodeWav } from "./ingest";
import { DEMO_CLIPS, type DemoFetch, loadDemoClip, loadOfflineFile, OfflineError } from "./offline";

/** Same fixture as ingest.test.ts: real store (shared FakeTransport,
 * silent mode) with a previous source and ONE seeded derived entry — the
 * fixture the "new source empties the cache" pin needs. */
function makeSeededStore(): {
  store: ReturnType<typeof createSessionStore>;
  seededKey: string;
  transport: FakeTransport;
} {
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

function makeFile(bytes: number, name = "clip.wav"): File {
  return new File([new Uint8Array(bytes)], name, { type: "audio/wav" });
}

describe("loadOfflineFile success", () => {
  it("decodes, downmixes to mono, loads as offlineBrowser, and empties the derived cache", async () => {
    const { store, seededKey } = makeSeededStore();

    // Stereo decode: mono lane = mean of the two channels (Task 1's helper).
    const decode = fakeDecode(
      [new Float32Array([0, 0.2, 0.4, 0.6]), new Float32Array([1, 0.2, -0.4, -0.6])],
      44_100,
    );

    const result = await loadOfflineFile(makeFile(2048, "clip.wav"), {
      decodeWav: decode,
      store,
    });

    expect(result).toEqual({
      ok: true,
      source: {
        samples: new Float32Array([0.5, 0.2, 0, 0]),
        sampleRateHz: 44_100,
        name: "clip.wav",
        sourceKind: "offlineBrowser",
      },
    });
    expect(decode.received).toBeInstanceOf(ArrayBuffer); // the read bytes reached the seam

    const state = store.getState();
    // PIN: a new source empties the derived cache and the jobs map.
    expect(state.derived.size).toBe(0);
    expect(state.jobs.size).toBe(0);
    expect(state.getDerived(seededKey).status).toBe("miss");
  });

  it("routes bytes through the SHARED Task-1 seam when it is injected explicitly", async () => {
    const { store } = makeSeededStore();
    // browserDecodeWav constructs an AudioContext; node has none, so its
    // constructor reference throwing ReferenceError is the pinned proof
    // that THIS implementation (not a second one) received the call.
    await expect(
      loadOfflineFile(makeFile(16), { decodeWav: browserDecodeWav, store }),
    ).rejects.toMatchObject({ kind: "decodeFailed", messageKey: "input.error.decode_failed" });
  });

  it("defaults to the shared Task-1 seam when nothing is injected", async () => {
    const { store } = makeSeededStore();
    const error = await loadOfflineFile(makeFile(16), { store }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OfflineError);
    const laneError = error as OfflineError;
    expect(laneError.cause).toBeInstanceOf(ReferenceError);
    expect((laneError.cause as ReferenceError).message).toContain("AudioContext");
  });
});

describe("loadOfflineFile store-guard backstop (the only backstop; never truncates)", () => {
  it.each<[number, number, string, string]>([
    [500, 1, "tooLong", "input.error.tooLong"], // 500 samples at 1 Hz = 500 s > 300 s cap
    [4, 192_000, "rateTooHigh", "input.error.rateTooHigh"], // > 96 kHz cap
    [4, 0, "invalidType", "input.error.invalidType"], // a non-positive rate satisfies no domain
  ])(
    "rejects %i samples at %s Hz with the store code and keeps the previous source",
    async (sampleCount, sampleRate, code, messageKey) => {
      const { store } = makeSeededStore();
      const before = store.getState().original;
      await expect(
        loadOfflineFile(makeFile(16), {
          decodeWav: fakeDecode([new Float32Array(sampleCount)], sampleRate),
          store,
        }),
      ).rejects.toMatchObject({ kind: "storeCode", code, messageKey });
      expect(store.getState().original).toBe(before); // untouched: no truncation
    },
  );

  it("rejects non-finite samples with the store's notFinite code", async () => {
    const { store } = makeSeededStore();
    const before = store.getState().original;
    await expect(
      loadOfflineFile(makeFile(16), {
        decodeWav: fakeDecode([new Float32Array([Number.NaN])], 48_000),
        store,
      }),
    ).rejects.toMatchObject({
      kind: "storeCode",
      code: "notFinite",
      messageKey: "input.error.notFinite",
    });
    expect(store.getState().original).toBe(before);
  });
});

describe("loadOfflineFile decode failures", () => {
  it("maps an injected seam throw to the typed decodeFailed rejection with its cause", async () => {
    const { store } = makeSeededStore();
    const cause = new Error("not a wav");
    const decode: DecodeWav = async () => {
      throw cause;
    };
    const error = await loadOfflineFile(makeFile(16), { decodeWav: decode, store }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(OfflineError);
    expect((error as OfflineError).kind).toBe("decodeFailed");
    expect((error as OfflineError).messageKey).toBe("input.error.decode_failed");
    expect((error as OfflineError).cause).toBe(cause);
  });
});

describe("loadDemoClip", () => {
  it("fetches the static clip URL and loads with sourceKind demoClip (cache emptied)", async () => {
    const { store, seededKey } = makeSeededStore();
    const requested: string[] = [];
    const fetchFn: DemoFetch = async (url) => {
      requested.push(url);
      return new Response(new Uint8Array(8), { status: 200 });
    };
    const decode = fakeDecode([new Float32Array([1, -1])], 48_000);

    const result = await loadDemoClip("pinkNoise", { fetch: fetchFn, decodeWav: decode, store });

    expect(requested).toEqual(["/demo/pink-noise-5s.wav"]);
    expect(result.source.sourceKind).toBe("demoClip");
    expect(result.source.name).toBe("pink-noise-5s.wav");
    expect(result.source.samples).toEqual(new Float32Array([1, -1]));
    expect(store.getState().getDerived(seededKey).status).toBe("miss");
  });

  it("rejects demoUnavailable when the fetch throws (flag untouched — no API call)", async () => {
    const { store } = makeSeededStore();
    const cause = new TypeError("fetch failed");
    const fetchFn: DemoFetch = async () => {
      throw cause;
    };
    const error = await loadDemoClip("clicks", { fetch: fetchFn, store }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(OfflineError);
    expect((error as OfflineError).kind).toBe("demoUnavailable");
    expect((error as OfflineError).messageKey).toBe("input.error.demoUnavailable");
    expect((error as OfflineError).cause).toBe(cause);
    expect(store.getState().backendOnline).toBe(false); // the offline lane never flips it
  });

  it("rejects demoUnavailable on a non-2xx answer", async () => {
    const { store } = makeSeededStore();
    const fetchFn: DemoFetch = async () => new Response(null, { status: 404 });
    await expect(loadDemoClip("chirp", { fetch: fetchFn, store })).rejects.toMatchObject({
      kind: "demoUnavailable",
      messageKey: "input.error.demoUnavailable",
    });
  });

  it("throws TypeError loudly on an unknown clip id (app bug, no fetch issued)", async () => {
    const fetchFn: DemoFetch = async () => {
      throw new Error("must not fetch");
    };
    await expect(loadDemoClip("nope", { fetch: fetchFn })).rejects.toThrow(TypeError);
  });

  it("pins the bundled demo data (D-016: three 48 kHz / 5 s clips, unique ids)", () => {
    expect(DEMO_CLIPS).toHaveLength(3);
    const ids = DEMO_CLIPS.map((clip) => clip.id);
    expect(new Set(ids).size).toBe(3);
    for (const clip of DEMO_CLIPS) {
      expect(clip.seconds).toBe(5);
      expect(clip.rateHz).toBe(48_000);
      expect(clip.file.endsWith(".wav")).toBe(true);
    }
  });
});
