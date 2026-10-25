/**
 * DSP op table — the extension point for every worker op (spec §2.3, D-018).
 *
 * **Adding an op (the one-entry rule):** add exactly ONE entry here — params
 * type, result type, handler — and the typed wire unions in `protocol.ts`
 * (`DspOpRequest` / `DspOpResponse`) and the typed `rpc.call(op, params…)`
 * surface extend automatically. The worker's dispatch switch must then gain
 * one `case` for the new op (enforced: the switch ends in
 * `request satisfies never`, so a table entry without a case fails
 * typecheck). No other wire type is hand-written per op.
 *
 * Handlers are pure over `@avalab/dsp` inputs only; they receive validated
 * shapes (frame validation happens in `protocol.ts` boundary consumers) and
 * throw `DspOpError({"badParams", …})` on bad params — the worker converts
 * every throw to a typed error frame, never a crash. T2 ships only
 * `sessionPing` (pure byte plumbing); T3/T4 plug real dsp helpers:
 * `dsp.worker.ts` is the ONLY app module that may import `@avalab/dsp`
 * (AGENTS §9 — no main-thread DSP).
 *
 * Error codes on the wire (frontend translates by code, wave-0 model):
 * `badParams` — malformed/missing params; `unknownOp` — op not in the table;
 * `opFailed` — unexpected handler crash (logged, never swallowed).
 */
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

export const dspOps = {
  sessionPing: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { count: 0 },
    result: undefined as unknown as SessionPingResult,
    handler: sessionPing,
  },
} satisfies DspOpTable;
