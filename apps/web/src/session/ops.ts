/**
 * DSP op table — the extension point for every worker op (spec §2.3, D-018).
 *
 * **Adding an op (the one-entry rule):** add exactly ONE entry here — params
 * type, result type, handler — and the typed wire unions in `protocol.ts`
 * (`DspOpRequest` / `DspOpResponse`) and the typed `rpc.call(op, params…)`
 * surface extend automatically. The worker's dispatch switch must then gain
 * one `case` for the new op (enforced: the handler record
 * `dspHandlers satisfies DspOpHandlers` in `dsp.worker.ts` — a table entry
 * without a handler entry fails typecheck with TS1360). No other wire type
 * is hand-written per op.
 *
 * Handlers are pure over `@avalab/dsp` inputs only; they receive validated
 * shapes (frame validation happens in `protocol.ts` boundary consumers) and
 * throw `DspOpError({"badParams", …})` on bad params — the worker converts
 * every throw to a typed error frame, never a crash. The op table imports
 * `@avalab/dsp` helpers for its handlers, but only the WORKER imports this
 * module at runtime (rpc/store import types only), so the DSP still runs off
 * the main thread (AGENTS §9).
 *
 * Error codes on the wire (frontend translates by code, wave-0 model):
 * `badParams` — malformed/missing params; `unknownOp` — op not in the table;
 * `opFailed` — unexpected handler crash (logged, never swallowed).
 */

import { computePeakBuckets } from "@avalab/dsp";
import type { TransferablePayload } from "./protocol";

/**
 * Every op's result rides `response.result` and may carry a transferred
 * payload buffer; `meta` is small structured data (readout, stats).
 */
export type DspOpResultBase = {
  meta?: Record<string, unknown>;
  payload?: TransferablePayload;
};

/**
 * One op: the params/result types (the table entry is the source of truth
 * for the typed RPC surface; the lens values in `dspOps` are type carriers
 * only, never read at runtime) plus the handler the worker dispatches to.
 * `handler` is typed `never`-param so `satisfies DspOpTable` stays sound
 * under `--strictFunctionTypes` contravariance while entries are correlated.
 */
export type DspOp<TParams, TResult extends DspOpResultBase> = {
  params: TParams;
  result: TResult;
  handler: (params: never, payload?: TransferablePayload) => TResult;
};

export type DspOpTable = {
  readonly [name: string]: DspOp<unknown, DspOpResultBase>;
};

export type DspOpName = keyof typeof dspOps & string;
export type DspOpParams<K extends DspOpName> = (typeof dspOps)[K]["params"];
export type DspOpResult<K extends DspOpName> = (typeof dspOps)[K]["result"];

/** Typed handler failure; code is the frontend's i18n key alongside the message. */
export class DspOpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DspOpError";
  }
}

export type SessionPingParams = { count: number };
export type SessionPingResult = {
  meta: { received: true };
  payload?: TransferablePayload;
};

/**
 * Round-trips a payload untouched, exercising the transfer semantics of the
 * protocol (payload moves out of the sender, worker sees the same bytes,
 * result carries the descriptor back out of the worker). Pure byte plumbing:
 * no dsp math, no copying beyond the boundary normalization `rpc.ts` does.
 */
export function sessionPing(
  params: SessionPingParams,
  payload?: TransferablePayload,
): SessionPingResult {
  if (
    params === undefined ||
    params === null ||
    typeof params.count !== "number" ||
    !Number.isInteger(params.count) ||
    params.count < 0
  ) {
    throw new DspOpError(
      "badParams",
      `sessionPing: count must be a non-negative integer, got ${String(params?.count ?? params)}`,
    );
  }
  return { meta: { received: true }, payload };
}

export type WaveformOverviewParams = { bucketCount: number; sampleRateHz: number };
export type WaveformOverviewResult = {
  meta: { sampleCount: number; sampleRateHz: number; bucketCount: number };
  /** Interleaved min/max peak buckets (2·bucketCount Float32 values) as a
   * transferred payload descriptor; see `computePeakBuckets` in @avalab/dsp. */
  payload?: TransferablePayload;
};

/**
 * Waveform overview (F02 groundwork): bucket the request payload's Float32
 * source samples into exact per-bucket min/max envelope pairs. The payload IS
 * the session source (the store's `deriveWithSource` copies `original.samples`
 * and transfers the copy); the result is self-describing — `sampleCount` is
 * read off the payload, `bucketCount` is derived from the returned payload's
 * length (byteLength/8; equals the params' value for a valid call), and
 * `sampleRateHz` echoes the params so the UI never has to re-derive rate
 * metadata.
 */
export function waveformOverview(
  params: WaveformOverviewParams,
  payload?: TransferablePayload,
): WaveformOverviewResult {
  if (
    params === undefined ||
    params === null ||
    typeof params.bucketCount !== "number" ||
    !Number.isInteger(params.bucketCount) ||
    params.bucketCount < 1 ||
    typeof params.sampleRateHz !== "number" ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0
  ) {
    throw new DspOpError(
      "badParams",
      `waveformOverview: bucketCount must be a positive integer and sampleRateHz a positive finite number, got ${String(params)}`,
    );
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "waveformOverview: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError(
      "badPayload",
      `waveformOverview: payload must be Float32-aligned, got byteOffset ${String(payload.byteOffset)}/byteLength ${String(payload.byteLength)}`,
    );
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  const minMax = computePeakBuckets(samples, params.bucketCount);
  return {
    meta: {
      sampleCount: samples.length,
      sampleRateHz: params.sampleRateHz,
      // Self-description from the actual result: 2 interleaved Float32 = 8
      // bytes per bucket, so an empty source (length-0 minMax) reports 0
      // buckets instead of echoing an inapplicable params.bucketCount.
      bucketCount: minMax.byteLength / 8,
    },
    payload: { buffer: minMax.buffer, byteOffset: 0, byteLength: minMax.byteLength },
  };
}

export const dspOps = {
  waveformOverview: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { bucketCount: 0, sampleRateHz: 0 },
    result: undefined as unknown as WaveformOverviewResult,
    handler: waveformOverview,
  },
  sessionPing: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { count: 0 },
    result: undefined as unknown as SessionPingResult,
    handler: sessionPing,
  },
} satisfies DspOpTable;
