/**
 * Long-lived DSP worker (spec §2.3): receives DspOpRequest/CancelFrame frames,
 * dispatches over the op table (`session/ops.ts`), answers with DspOpResponse
 * frames. Payload buffers are transferred, not cloned — every result payload's
 * buffer goes into the transfer list (AGENTS §9).
 *
 * Dispatch exhaustiveness: adding an op entry to `dspOps` requires one
 * `dspHandlers` entry here — the table below is checked against the op table
 * (`satisfies DspOpHandlers`), so a missing dispatch case fails typecheck
 * ("diamond missing case"). The handler map is also the runtime dispatch
 * surface, so a handler cannot be called without being registered. Adding an
 * op = one op-table entry + one map entry + one switch case (see ops.ts
 * header).
 *
 * `lib.dom` types `self` as Window — the worker scope is retyped through the
 * Worker interface once, which matches the real DedicatedWorkerGlobalScope
 * surface (postMessage(msg, transferList), onmessage).
 *
 * DSP math plugs in HERE ONLY: later tasks import pure helpers from
 * `@avalab/dsp` (e.g. waveform bucketing in T4) and wrap them as table ops.
 * Handlers stay pure (no DOM/global state), so vitest can exercise them as
 * plain functions without a worker (spec §2.3). Nothing else in the app may
 * import `@avalab/dsp` (AGENTS §9 — no main-thread DSP).
 */
import {
  DspOpError,
  type DspOpName,
  type DspOpParams,
  type DspOpResult,
  dspOps,
  sessionPing,
  waveformOverview,
} from "../session/ops";
import {
  type CancelFrame,
  type DspOpRequest,
  type DspOpResponse,
  isRecordLike,
  type TransferablePayload,
} from "../session/protocol";

const scope = self as unknown as Worker;

/** Dispatch table, checked pointwise against the op table by name: per-op
 * params/result types must line up (like the table), and — decisive — an op
 * without an entry fails typecheck. The `switch` uses these same handlers,
 * so an unregistered handler can never be dispatched. */
type DspOpHandlers = {
  [K in DspOpName]: (params: DspOpParams<K>, payload?: TransferablePayload) => DspOpResult<K>;
};

const dspHandlers = {
  sessionPing,
  waveformOverview,
} satisfies DspOpHandlers;

/** Ids whose request was cancelled after the frame left the client (§2.3);
 * T2 ops are atomic, so the set only governs cancel-before-start frames;
 * staged ops add between-stage checks when they land. */
const cancelledIds = new Set<number>();

scope.onmessage = (event: MessageEvent): void => {
  handleMainMessage(event.data);
};

function handleMainMessage(raw: unknown): void {
  if (!isRecordLike(raw) || typeof raw.id !== "number") {
    console.warn("avalab dsp worker: dropped malformed main-thread frame", raw);
    return;
  }
  if (isCancelFrame(raw)) {
    cancelledIds.add(raw.id);
    return;
  }
  if (typeof raw.op !== "string") {
    console.warn("avalab dsp worker: dropped frame without an op", raw);
    return;
  }
  if (!(raw.op in dspOps)) {
    scope.postMessage({
      id: raw.id,
      ok: false,
      error: { code: "unknownOp", message: `unknown dsp op: ${raw.op}` },
    });
    return;
  }
  if (cancelledIds.has(raw.id)) {
    // Cancel arrived before this request started: confirm cancelled so the
    // client's promise settles through the normal (buffer-safe) path.
    scope.postMessage({ id: raw.id, ok: true, cancelled: true });
    return;
  }
  // Frame shape validated (numeric id, known op) — params are trusted to
  // handlers, which throw DspOpError("badParams", …) on anything wrong.
  const response = runDspOp(raw as DspOpRequest);
  scope.postMessage(response, transfersOf(response));
}

function isCancelFrame(frame: Record<string, unknown>): frame is CancelFrame {
  return frame.type === "cancel";
}

/** Every op's `DspOpResultBase` payload (optional by constraint) is
 * transferred, never structured-cloned. */
function transfersOf(response: DspOpResponse): Transferable[] {
  if (response.ok && !("cancelled" in response)) {
    const payload = response.result.payload;
    if (payload !== undefined) {
      return [payload.buffer];
    }
  }
  return [];
}

/** Switch exhaustiveness on the DISPATCH level: a dspOps entry without a
 * dspHandlers entry leaves `request` narrowed to its leftover union in the
 * default branch — but the compile-time tripwire is `satisfies DspOpHandlers`
 * above (TS does not narrow a single member to `never` post-default). */
function runDspOp(request: DspOpRequest): DspOpResponse {
  try {
    switch (request.op) {
      case "sessionPing": {
        const result = dspHandlers.sessionPing(request.params, request.payload);
        return { id: request.id, ok: true, result };
      }
      case "waveformOverview": {
        const result = dspHandlers.waveformOverview(request.params, request.payload);
        return { id: request.id, ok: true, result };
      }
      default: {
        // Unreachable as long as dspHandlers covers every dspOps entry;
        // `unknownOp` frames never reach this function.
        throw new Error("avalab dsp worker: no dispatch case registered");
      }
    }
  } catch (error) {
    if (error instanceof DspOpError) {
      return {
        id: request.id,
        ok: false,
        error: { code: error.code, message: error.message },
      };
    }
    // A leaked non-DspOpError is a handler bug: log loudly, but still answer
    // with a typed frame so no client promise ever hangs.
    console.error("avalab dsp worker: op failed with an unexpected error", error);
    return {
      id: request.id,
      ok: false,
      error: { code: "opFailed", message: String(error) },
    };
  }
}
