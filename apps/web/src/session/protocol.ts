/**
 * Typed wire protocol for the DSP worker (spec §2.3, D-018 — no Comlink).
 *
 * Frames on the wire:
 * - main → worker: `DspOpRequest` (discriminated union keyed by `op`) or a
 *   `CancelFrame`. Inner-slice payloads are normalized by `rpc.ts` before
 *   they hit the wire (see `TransferablePayload`).
 * - worker → main: `DspOpResponse` (per-op typed result, typed error, or the
 *   worker's own `cancelled` confirmation).
 *
 * The unions are mapped over the op table's names in `session/ops.ts`
 * (spec §2.3: no per-op wire types kept in sync by hand — adding an op entry
 * extends these unions automatically), so a `case` on `request.op` also
 * narrows `request.params` with no cast. Frame *shape* validation lives at
 * the boundary consumers (`rpc.ts` and `dsp.worker.ts`) via `isRecordLike`
 * here; once a frame names a known op, sus params shapes are trusted and
 * handlers validate their own params, throwing `DspOpError("badParams", …)`.
 */
import type { DspOpName, DspOpParams, DspOpResult } from "./ops";

/**
 * A byte-range view over an `ArrayBuffer` that crosses `postMessage`.
 *
 * `byteOffset`/`byteLength` name the slice `[byteOffset, byteOffset+byteLength)`
 * inside `buffer`. Structured clone transfers whole `ArrayBuffer`s only, so
 * `rpc.ts` normalizes before posting: whole-buffer payloads transfer
 * zero-copy; inner slices are first copied into an exact-size buffer, so
 * exactly `byteLength` bytes ever move — the socket carries no slack bytes
 * (AGENTS §9; real audio ops send whole $N$-minute buffers, which hit the
 * zero-copy path).
 *
 * Ownership: once a frame carrying a payload is posted, the buffer is
 * *neutered* — structured-clone transfer detaches the sender's view (reads
 * throw, `byteLength` reads `0`) and the receiver owns the bytes exclusively.
 * For a normalized inner slice the moved bytes are a fresh copy and the
 * source keeps its non-payload bytes, but the payload itself must be treated
 * as consumed either way.
 */
export type TransferablePayload = {
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
};

/**
 * main → worker request for op `K`: `params` is the op's own params type from
 * the op table, so `switch (request.op)` narrows `request.params` too.
 */
export type DspOpRequest = {
  [K in DspOpName]: {
    id: number;
    op: K;
    params: DspOpParams<K>;
    payload?: TransferablePayload;
  };
}[DspOpName];

/**
 * main → worker cancel for request `id`. Chosen deliberately as a plain
 * frame distinguishable by `type` (requests carry no `type` field), so the
 * id space is shared and a cancel never allocates an id.
 */
export type CancelFrame = {
  type: "cancel";
  id: number;
};

/**
 * worker → main: per-op typed result, or a typed error (`code` mirrors the
 * wave-0 bilingual-by-code model — the frontend translates by code and never
 * renders a raw message), or the worker's `cancelled` confirmation (it exits
 * early before the op finished).
 */
export type DspOpResponse =
  | {
      [K in DspOpName]: {
        id: number;
        ok: true;
        result: DspOpResult<K>;
      };
    }[DspOpName]
  | {
      id: number;
      ok: false;
      error: { code: string; message?: string };
    }
  | {
      id: number;
      ok: true;
      cancelled: true;
    };

/** What a call settles to: the op's result, or `cancelled` (superseded by an
 * identical call, cancelled before it finished, or the rpc was terminated —
 * callers must never hang and hence must never need a rejection to handle a
 * cancel). */
export type DspOpOutcome<K extends DspOpName> = DspOpResult<K> | { cancelled: true };

/** Structural check used at every frame boundary (rpc client, dsp worker). */
export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Serialize params stably for the rpc supersede key (and, later, cache keys
 * in the session store): own properties sorted lexicographically at every
 * level, numbers locale-independent, JSON-typed values only. Functions,
 * symbols, bigints, class instances, `undefined`, and non-finite numbers
 * throw `TypeError` — a param that slipped a wrong type in must fail loudly,
 * never canonicalize ambiguously.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalJson: number must be finite, got ${String(value)}`);
    }
    // String() never applies locale formatting: “1234.5”, never “1,234.5”.
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecordLike(value)) {
    // Plain objects only: Map/Date/class instances/ArrayBuffer wrappers must
    // be rejected rather than canonicalized via their enumerable view.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError("canonicalJson: only plain objects are supported");
    }
    const entries = Object.entries(value);
    for (const [, item] of entries) {
      if (item === undefined) {
        throw new TypeError("canonicalJson: object values must not be undefined");
      }
    }
    const sorted = Object.keys(value).sort();
    const pairs = sorted.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${pairs.join(",")}}`;
  }
  throw new TypeError(`canonicalJson: unsupported value type ${typeof value}`);
}
