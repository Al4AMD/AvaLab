/**
 * The wave-2 audio session store (spec §2.2) — the SOLE view-tree caller of
 * the dsp worker RPC (ruling R23): views fire derivations and the
 * diagnostics ping through THIS store's actions and read `derived`, `jobs`,
 * and `diagnostics` back; no view imports `session/rpc.ts` directly.
 *
 * Responsibilities
 * - `loadSource` guards an immutable session source (mono Float32Array
 *   analysis lane) with the app-wide caps (AGENTS §7/F01: ≤ 96 kHz, ≤ 300 s,
 *   finite samples) and empties the derived cache on success — a new source
 *   never sees the previous source's results.
 * - `derive(opKey, params[, payload])` requests a worker op through the typed
 *   RPC under a cache key `op \u0000 canonicalJson(params) \u0000 inputHash`:
 *   cached hits resolve synchronously; misses become `jobs` entries
 *   (`progressPct` is null until worker progress reporting arrives in a
 *   later task) armed with a `cancel()` seam.
 * - `deriveWithSource(opKey, params)` is the source-payload variant for ops
 *   that need the analysis lane: it copies `original.samples`, transfers the
 *   copy (the session source stays intact), and shares `derive`'s canonical
 *   key/job/settle machinery; without a source it rejects typed `noSource`
 *   with no rpc frame.
 * - `sessionTroubleshootingPing` is a guarded, idempotent, NON-source
 *   diagnostics action (worker round trip), distinct from `derive`
 *   deliberately: a ping needs no loaded source and bypasses the input hash,
 *   while `derive` requires one. The waveform stub renders its readout —
 *   this keeps the e2e contract (`waveform.stub.ping`) alive through the
 *   store instead of a direct rpc call from the component tree.
 *
 * Money-size note: inputHash is an O(bytes) byte loop executed on the main
 * thread exactly ONCE per successful load — ruled a load-time cost in the
 * wave pre-flight (115.2 MB worst case at 5 min/96 kHz mono Float32), alongside the
 * per-sample finiteness scan that loadSource performs anyway. No other DSP
 * runs on the main thread (AGENTS §9); audio math lives in the worker.
 *
 * Immutability: `original` is owned by the store and MUST NOT be mutated by
 * consumers; `derive`'s optional payload is transferable and NEUTERED for the
 * caller per session/protocol.ts ownership rules — views that hand out
 * sample-buffer ranges transfer ownership that way on purpose.
 */
import { inputHashFnv1a64 } from "@avalab/dsp";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { DspOpName, DspOpParams } from "./ops";
import type { DspOpOutcome, TransferablePayload } from "./protocol";
import { canonicalJson } from "./protocol";
import type { DspCallPromise, DspRpc } from "./rpc";
import { DspRpcError, dspWorkerRpc } from "./rpc";

/** AGENTS §7/F01 sample-rate cap (Hz). */
export const MAX_SAMPLE_RATE_HZ = 96_000;
/** AGENTS §7/F01 duration cap (seconds) — 5 minutes. */
export const MAX_DURATION_SECONDS = 300;

/** Where a session source came from (spec §2.4 lanes + generator). */
export type SourceKind = "ingested" | "offlineBrowser" | "demoClip" | "recording" | "generated";

/** The immutable per-session source (spec §2.2): mono analysis lane. */
export type SessionSource = {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
  readonly name: string;
  readonly sourceKind: SourceKind;
};

/** Structured rejection codes for `loadSource` (frontend translates by code).
 * `invalidType` also covers domain errors that are neither too-long nor
 * not-finite — a non-positive sample rate lands there on purpose. */
export type SourceErrorCode = "invalidType" | "notFinite" | "rateTooHigh" | "tooLong";

/** Pre-flight result of `loadSource`: structured, never a thrown error. */
export type LoadSourceResult = { ok: true } | { ok: false; code: SourceErrorCode };

/** A settled derived result, stored under its canonical cache key. */
export type DerivedEntry = {
  readonly key: string;
  readonly result: unknown;
};

/** A pending derivation: worker progress is null until the protocol grows
 * progress frames; `cancel` detaches the worker frame id (spec §2.3);
 * `callId` is the RPC bookkeeping id the cancel targets (guards the
 * settle-time map writes of superseded calls against their replacement). */
export type JobEntry = {
  readonly progressPct: number | null;
  readonly cancel: () => void;
  readonly callId: number;
};

/** Half-open sample range `[startSample, endSample)` clamped to the source. */
export type Selection = {
  readonly startSample: number;
  readonly endSample: number;
};

/** Diagnostics ping status: guarded idempotency + retryable failure. */
export type PingStatus = "idle" | "pending" | "done" | "failed";

/** Worker round-trip readout the waveform stub renders. */
export type Diagnostics = {
  readonly pingByteLength: number | null;
  readonly pingStatus: PingStatus;
};

/** What `getDerived(key)` finds: settled, in flight, or not requested at all. */
export type DerivedLookup =
  | { status: "ready"; entry: DerivedEntry }
  | { status: "pending" }
  | { status: "miss" };

/** The handle a `derive` caller receives: the canonical cache key plus the
 * promise that settles to the op's result, `{cancelled: true}` (superseded
 * or cancelled), or REJECTS `DspRpcError` on a wire/worker error. Callers
 * that ignore the promise REJECT-face unhandled-rejection noise — the store
 * keeps failures OUT of the cache so a later derive retries cleanly. */
export type DeriveTicket<K extends DspOpName> = {
  readonly key: string;
  readonly outcome: Promise<DspOpOutcome<K>>;
};

export type SessionStore = {
  readonly original: Readonly<SessionSource> | null;
  /** FNV-1a-64 hex of the current source's PCM bytes; null before any load.
   * (Wave pre-flight: hashed once per loadSource; load-time cost.) */
  readonly inputHash: string | null;
  readonly derived: ReadonlyMap<string, DerivedEntry>;
  readonly jobs: ReadonlyMap<string, JobEntry>;
  readonly selection: Readonly<Selection>;
  /** False until proven reachable (spec §2.2). */
  readonly backendOnline: boolean;
  /** Whether the boot /health probe (HealthStatus) has SETTLED — any verdict.
   * `backendOnline` alone cannot mean "offline" while that probe is still
   * pending (it starts false as "not yet proven"), so the upload card's
   * offline-lane evidence gate (upload.tsx review findings 1+2) requires
   * this settledness before claiming settled-offline evidence. The ingest
   * lane's own mark* flips are lane evidence only and never touch this
   * marker. */
  readonly backendProbeSettled: boolean;
  readonly diagnostics: Readonly<Diagnostics>;

  /** Guarded load: validates, hashes the PCM bytes once, and replaces the
   * whole session state for the new source (derived cache and jobs emptied,
   * selection widened to the full new source). Structured rejection, never a
   * throw; the previously loaded source (if any) survives a rejected load
   * untouched. */
  loadSource(
    samples: Float32Array,
    sampleRateHz: number,
    name: string,
    sourceKind: SourceKind,
  ): LoadSourceResult;
  /** Request `opKey` over the canonical cache key. Cache hit resolves the
   * ticket synchronously; a pending re-derive supersedes the old call via
   * the rpc layer (identical op+params) and the newer call wins. Returns
   * null when no source is loaded (nothing to derive from). Bad params
   * throw TypeError through `canonicalJson` BEFORE any state changes — an
   * app-code bug must fail loudly (protocol.ts contract). */
  derive<K extends DspOpName>(
    opKey: K,
    params: DspOpParams<K>,
    payload?: TransferablePayload,
  ): DeriveTicket<K> | null;
  /** Source-payload variant of `derive` for ops that operate on the whole
   * analysis lane (`waveformOverview`): posts a fresh COPY of
   * `original.samples` as the request payload (the transfer neuters the
   * copy, never the session source — tested), caches under the same
   * `op ∝ canonicalJson ∝ inputHash` key. No source → the ticket REJECTS
   * typed `noSource` (DspRpcError code) without any rpc frame; its `key` is
   * then meaningless (""). Bad params still throw TypeError through
   * `canonicalJson` before any frame (app-code bug fails loudly). */
  deriveWithSource<K extends DspOpName>(opKey: K, params: DspOpParams<K>): DeriveTicket<K>;
  /** Read a derivation's state by its cache key (spec polling interface). */
  getDerived(key: string): DerivedLookup;
  /** Cancel the pending job under `key`: detaches the worker frame id; a
   * stale/unknown key is a no-op; settled keys cannot be cancelled twice. */
  cancel(jobKey: string): void;
  /** Clamp-order `[startSample, endSample)`: rounded, clamped to the source
   * sample count (0..N, end exclusive → N means "to the last sample"), then
   * ordered ascending. Non-finite input is a documented NO-OP (the previous
   * selection survives); without a source everything clamps to `{0, 0}`. */
  setSelection(startSample: number, endSample: number): void;
  markBackendReachable(): void;
  markBackendUnreachable(): void;
  /** Record the boot /health probe as SETTLED (any verdict — HealthStatus
   * calls it once per settled probe; the set is idempotent). */
  markBackendProbeSettled(): void;
  /** Diagnostics ping (guarded idempotent worker round trip). Fires only
   * from `idle`/`failed`; `pending`/`done` make re-fires no-ops, so
   * StrictMode double-mounts (and route revisits) hit the worker exactly
   * once per browser session. */
  sessionTroubleshootingPing(): void;
};

const SOURCE_KINDS: readonly SourceKind[] = [
  "ingested",
  "offlineBrowser",
  "demoClip",
  "recording",
  "generated",
];

function clampToSampleCount(sample: number, sampleCount: number): number {
  if (sample < 0) {
    return 0;
  }
  return sample > sampleCount ? sampleCount : sample;
}

function deleteAndClone<K, V>(map: ReadonlyMap<K, V>, key: K): Map<K, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

/**
 * Build a standalone session store around any RPC endpoint. The app
 * singleton and every test use the same constructor; tests inject the
 * `FakeTransport`-backed rpc (a real Worker does not exist in node).
 */
export function createSessionStore(
  rpc: DspRpc = dspWorkerRpc,
): UseBoundStore<StoreApi<SessionStore>> {
  return create<SessionStore>()((set, get) => {
    /**
     * Gate every settle (result/cancel/failure): the maps may only be
     * touched when (a) this call is STILL the live one under its key — a
     * superseded call must never delete its replacement's job — and (b) the
     * source's input hash still matches — a loadSource that fired after the
     * request must not let the late settle resurrect anything into the
     * emptied cache. Returns the job-drop action for live settles (the
     * action re-reads the store to combine with other set()s correctly), or
     * undefined for a stale settle.
     */
    const settleIfLive = (
      key: string,
      callId: number,
      sourceHash: string,
    ): (() => void) | undefined => {
      const state = get();
      if (state.inputHash !== sourceHash) {
        return undefined;
      }
      const entry = state.jobs.get(key);
      if (entry === undefined || entry.callId !== callId) {
        return undefined;
      }
      return () => set({ jobs: deleteAndClone(get().jobs, key) });
    };

    /**
     * The shared miss→call→settle path behind `derive` and
     * `deriveWithSource`: canonical-key cache hit resolves synchronously
     * (no closure invocation, no frame); otherwise the rpc call (built by
     * the caller closure), the job entry and BOTH settle handlers are wired
     * identically, so the settle guards stay single-sourced.
     */
    const openDerivedJob = <K extends DspOpName>(
      opKey: K,
      canonical: string,
      inputHash: string,
      startCall: () => DspCallPromise<K>,
    ): DeriveTicket<K> => {
      const key = `${opKey}\u0000${canonical}\u0000${inputHash}`;
      const cached = get().derived.get(key);
      if (cached !== undefined) {
        // Synchronous cache hit. The cast is keyed to the cache key's op
        // identity: entries under `opKey\u0000…\u0000hash` are written only
        // by calls of that op with those params over that source, so the
        // stored unknown IS this op's result type.
        return { key, outcome: Promise.resolve(cached.result as DspOpOutcome<K>) };
      }
      const promise = startCall();
      const callId = promise.callId;
      const jobs = new Map(get().jobs);
      jobs.set(key, {
        progressPct: null,
        callId,
        cancel: () => {
          // rpc.cancel is stale-safe: an already-settled id sends no frame.
          rpc.cancel(callId);
        },
      });
      set({ jobs });
      // Settles outside the async body; failures REJECT (wire/worker
      // errors are the ticket's problem — see DeriveTicket's javadoc).
      void promise.then(
        (outcome) => {
          const dropJob = settleIfLive(key, callId, inputHash);
          if (dropJob === undefined) {
            return; // stale: superseded, cancelled, or the source changed
          }
          if ("cancelled" in outcome) {
            dropJob(); // just the job entry: a cancelled call caches nothing
            return;
          }
          set({
            derived: new Map(get().derived).set(key, { key, result: outcome }),
          });
          dropJob();
        },
        () => {
          // Failure keeps the cache clean (retrying = re-derive); the
          // rejection is the ticket consumer's to translate by code.
          settleIfLive(key, callId, inputHash)?.();
        },
      );
      return { key, outcome: promise };
    };

    return {
      original: null,
      inputHash: null,
      derived: new Map<string, DerivedEntry>(),
      jobs: new Map<string, JobEntry>(),
      selection: { startSample: 0, endSample: 0 },
      backendOnline: false,
      backendProbeSettled: false,
      diagnostics: { pingByteLength: null, pingStatus: "idle" },

      loadSource(samples, sampleRateHz, name, sourceKind) {
        if (
          !(samples instanceof Float32Array) ||
          typeof sampleRateHz !== "number" ||
          typeof name !== "string" ||
          !SOURCE_KINDS.includes(sourceKind)
        ) {
          return { ok: false, code: "invalidType" };
        }
        // NaN samples and a non-finite rate share the "not a finite number"
        // code; the loop doubles as the load's O(n) validation pass.
        if (!Number.isFinite(sampleRateHz)) {
          return { ok: false, code: "notFinite" };
        }
        for (let index = 0; index < samples.length; index += 1) {
          const sample: number | undefined = samples[index];
          if (sample === undefined) {
            throw new RangeError(`loadSource: samples[${index}] read out of bounds`);
          }
          if (!Number.isFinite(sample)) {
            return { ok: false, code: "notFinite" };
          }
        }
        // A non-positive rate satisfies no domain ("too high" it is not).
        if (sampleRateHz <= 0) {
          return { ok: false, code: "invalidType" };
        }
        if (sampleRateHz > MAX_SAMPLE_RATE_HZ) {
          return { ok: false, code: "rateTooHigh" };
        }
        if (samples.length / sampleRateHz > MAX_DURATION_SECONDS) {
          return { ok: false, code: "tooLong" };
        }

        const inputHash = inputHashFnv1a64(samples);
        // new Map(): replaces both caches wholesale — and the late-settle
        // hash guard makes any in-flight frames of the OLD source inert.
        set({
          original: { samples, sampleRateHz, name, sourceKind },
          inputHash,
          derived: new Map<string, DerivedEntry>(),
          jobs: new Map<string, JobEntry>(),
          selection: { startSample: 0, endSample: samples.length },
        });
        return { ok: true };
      },

      derive<K extends DspOpName>(
        opKey: K,
        params: DspOpParams<K>,
        payload?: TransferablePayload,
      ): DeriveTicket<K> | null {
        const { original, inputHash } = get();
        if (original === null || inputHash === null) {
          // Documented contract: no source, nothing to derive from. Views
          // guard on `original` first; no worker frame leaves the main thread.
          return null;
        }
        // canonicalJson throws (typo'd param types, non-finite numbers)
        // BEFORE any frames or state changes — loud app-code failure per
        // protocol.ts.
        const canonical = canonicalJson(params);
        // R24 caveat: params-only keys assume payload-less derives; any op
        // whose result depends on the request payload must have that payload
        // pinned to the key's input hash (see deriveWithSource).
        return openDerivedJob(opKey, canonical, inputHash, () => rpc.call(opKey, params, payload));
      },

      /**
       * Derive variant for ops that need the SOURCE SAMPLES as their request
       * payload (`waveformOverview` and friends). The payload is a fresh full
       * copy of `original.samples`, transferred to the worker: the transfer
       * neuters the COPY (protocol ownership rule), never the session source,
       * so playback/analysis keep using the original buffer after the call.
       *
       * Memory note (plan Task 4, deliberately simple): one fresh full-source
       * copy per call — worst case 115.2 MB (5 min @ 96 kHz mono Float32) —
       * is transferred once and released. Chunked transfer is deferred: the
       * overview is derived once per source load (first render), so the
       * once-per-call copy cost is accepted and documented in the plan.
       *
       * R24 payload caveat (pinned): the params-only canonical key stays
       * sound here because this payload is ALWAYS the same bytes `inputHash`
       * was computed from at `loadSource` — source identity is in the key;
       * no payload hash can diverge from it. A future op whose payload is
       * NOT the full source must extend the key with a payload hash or
       * bypass the cache.
       *
       * Contract delta vs `derive`: no source → a ticket whose outcome
       * REJECTS with the typed store-level code `noSource` (no rpc frame,
       * no cache/jobs writes); the ticket's `key` is meaningless then
       * (documented "") because no cache key exists without an input hash.
       */
      deriveWithSource<K extends DspOpName>(opKey: K, params: DspOpParams<K>): DeriveTicket<K> {
        const { original, inputHash } = get();
        if (original === null || inputHash === null) {
          const outcome = Promise.reject<DspOpOutcome<K>>(
            new DspRpcError("noSource", "deriveWithSource: no source loaded"),
          );
          outcome.catch(() => undefined); // keep the store-side rejection unobserved until read
          return { key: "", outcome };
        }
        const canonical = canonicalJson(params);
        return openDerivedJob(opKey, canonical, inputHash, () => {
          const copy = original.samples.slice();
          return rpc.call(opKey, params, {
            buffer: copy.buffer,
            byteOffset: 0,
            byteLength: copy.byteLength,
          });
        });
      },

      getDerived(key) {
        const entry = get().derived.get(key);
        if (entry !== undefined) {
          return { status: "ready", entry };
        }
        return get().jobs.has(key) ? { status: "pending" } : { status: "miss" };
      },

      cancel(jobKey) {
        const entry = get().jobs.get(jobKey);
        if (entry !== undefined) {
          // The settle handler owns the map bookkeeping (callId guard), so a
          // double cancel settles the promise once and no-ops afterwards.
          entry.cancel();
        }
      },

      setSelection(startSample, endSample) {
        if (!Number.isFinite(startSample) || !Number.isFinite(endSample)) {
          return; // documented no-op: the previous selection survives
        }
        const sampleCount = get().original?.samples.length ?? 0;
        const start = clampToSampleCount(Math.round(startSample), sampleCount);
        const end = clampToSampleCount(Math.round(endSample), sampleCount);
        set({
          selection: { startSample: Math.min(start, end), endSample: Math.max(start, end) },
        });
      },

      markBackendReachable() {
        set({ backendOnline: true });
      },

      markBackendUnreachable() {
        set({ backendOnline: false });
      },

      markBackendProbeSettled() {
        set({ backendProbeSettled: true });
      },

      sessionTroubleshootingPing() {
        const status = get().diagnostics.pingStatus;
        if (status === "pending" || status === "done") {
          return; // guarded idempotency (per browser session)
        }
        set({ diagnostics: { pingByteLength: null, pingStatus: "pending" } });
        const bytes = new Uint8Array(4);
        const promise = rpc.call(
          "sessionPing",
          { count: 1 },
          {
            buffer: bytes.buffer,
            byteOffset: 0,
            byteLength: bytes.byteLength,
          },
        );
        void promise.then(
          (outcome) => {
            if ("payload" in outcome && outcome.payload !== undefined) {
              set({
                diagnostics: { pingByteLength: outcome.payload.byteLength, pingStatus: "done" },
              });
              return;
            }
            // A cancelled ping (terminated rpc) resets to a retryable state.
            set({ diagnostics: { pingByteLength: null, pingStatus: "failed" } });
          },
          (error: unknown) => {
            // workerUnavailable / opFailed: keep the stub's plain body; the
            // next session mount can retry (the status is not terminal).
            console.warn("avalab session store: diagnostics ping failed", error);
            set({ diagnostics: { pingByteLength: null, pingStatus: "failed" } });
          },
        );
      },
    };
  });
}

/** The app session store singleton (worker-backed rpc; lazy construction —
 * no Worker spawns at module load, tests build their own instance instead). */
export const useSessionStore = createSessionStore();
