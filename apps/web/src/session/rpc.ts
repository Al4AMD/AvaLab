/**
 * Typed RPC client for the DSP worker (spec §2.3, D-018).
 *
 * `createDspRpc(transport)` is the generic engine: the transport seam keeps
 * the browser `Worker` wiring (~5 lines) out of tests, which inject a
 * MessageChannel-based fake or a node `worker_threads` channel (no real
 * Worker in node — wave pre-flight ruling). App code goes through the lazy
 * `dspWorkerRpc` singleton / `getDspWorkerRpc()`.
 *
 * Semantics per op call:
 * - ids are allocated from a monotonic counter shared by request/cancel
 *   frames; a `call`'s id rides the returned promise as `callId` (assigned
 *   synchronously, before any echo), which is what `cancel(id)` keys on.
 * - Supersede: a new call with identical `op + canonicalJson(params)`
 *   supersedes a pending one — the old promise resolves `{cancelled: true}`
 *   (never rejects) and a cancel frame tells the worker to exit early.
 * - Error frames REJECT with `DspRpcError` (code mirrors the backend's
 *   bilingual-by-code model); cancellations always resolve.
 * - Late frames (id no longer pending) are dropped silently — a superseded
 *   or cancelled call can never deliver a result onto the caller.
 */
import type { DspOpName, DspOpParams } from "./ops";
import {
  canonicalJson,
  type DspOpOutcome,
  type DspOpRequest,
  isRecordLike,
  type TransferablePayload,
} from "./protocol";

/** Callback receiving one wire frame from the worker side. */
export type DspTransportMessageHandler = (message: unknown) => void;

/**
 * Message seam around `Worker`-like endpoints. `onMessage` subscribes
 * exactly one consumer (one rpc client owns one worker) — a second
 * subscription throws instead of silently shadowing the first.
 */
export interface DspRpcTransport {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onMessage(handler: DspTransportMessageHandler): void;
  terminate(): void;
}

/** Typed rejection reason for error frames (and malformed local params). */
export class DspRpcError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "DspRpcError";
  }
}

/**
 * The `call` promise, extended with `callId` so callers can `cancel(id)` /
 * correlate with wire frames; assigned synchronously at call time.
 */
export type DspCallPromise<K extends DspOpName> = Promise<DspOpOutcome<K>> & {
  callId: number;
};

export interface DspRpc {
  /**
   * Typed call into the worker: `op` must be a table key, `params` must match
   * that op's params type, an optional payload transfers ownership of its
   * buffer range (neutered after the frame leaves — protocol doc). The
   * promise resolves the op's result or `{cancelled: true}`; error frames
   * reject with `DspRpcError`.
   */
  call<K extends DspOpName>(
    op: K,
    params: DspOpParams<K>,
    payload?: TransferablePayload,
  ): DspCallPromise<K>;
  /** Cancel a pending call by its frame id (`(await call).callId`). */
  cancel(id: number): void;
  /** Drop every pending call as `{cancelled: true}` and kill the transport. */
  terminate(): void;
}

/** Error thrown for a malformed outgoing payload descriptor. */
const BAD_PAYLOAD_CODE = "badPayload";

/** Rejection code when the Worker transport cannot even be constructed. */
const WORKER_UNAVAILABLE_CODE = "workerUnavailable";

/**
 * Validate the descriptor and normalize it so *exactly* `byteLength` bytes
 * transfer (structured clone moves whole `ArrayBuffer`s only): whole-buffer
 * payloads pass through zero-copy; inner slices are copied to fresh
 * exact-size buffers, byteOffset 0. Throws `DspRpcError("badPayload")` on an
 * out-of-bounds or non-integer descriptor.
 */
function normalizeOutgoingPayload(
  payload: TransferablePayload | undefined,
): TransferablePayload | undefined {
  if (payload === undefined) return undefined;
  const { buffer, byteOffset, byteLength } = payload;
  if (!Number.isInteger(byteOffset) || !Number.isInteger(byteLength)) {
    throw new DspRpcError(
      BAD_PAYLOAD_CODE,
      `payload byteOffset/byteLength must be integers, got ${String(byteOffset)}/${String(byteLength)}`,
    );
  }
  if (byteOffset < 0 || byteLength < 0 || byteOffset + byteLength > buffer.byteLength) {
    throw new DspRpcError(
      BAD_PAYLOAD_CODE,
      `payload slice [${String(byteOffset)}, ${String(byteOffset + byteLength)}) exceeds buffer of ${String(buffer.byteLength)} bytes`,
    );
  }
  if (byteOffset === 0 && byteLength === buffer.byteLength) {
    return payload; // zero-copy fast path: the whole buffer is the payload
  }
  return {
    buffer: buffer.slice(byteOffset, byteOffset + byteLength),
    byteOffset: 0,
    byteLength,
  };
}

type PendingEntry = {
  id: number;
  /** `op + canonicalJson(params)` supersede key. */
  key: string;
  resolve: (value: unknown) => void;
  reject: (error: DspRpcError) => void;
};

/** Build rpc behaviour around any transport (Worker, MessageChannel, fake). */
export function createDspRpc(transport: DspRpcTransport): DspRpc {
  const pendingByKey = new Map<string, PendingEntry>();
  const pendingById = new Map<number, PendingEntry>();
  let nextId = 0;

  function dropPending(entry: PendingEntry): void {
    pendingByKey.delete(entry.key);
    pendingById.delete(entry.id);
  }

  function cancel(id: number): void {
    const entry = pendingById.get(id);
    if (entry === undefined) {
      // Nothing pending under this id (already settled or unknown) — a stale
      // cancel must not allocate a wire frame.
      return;
    }
    dropPending(entry);
    entry.resolve({ cancelled: true });
    transport.postMessage({ type: "cancel", id }, []);
  }

  function terminate(): void {
    for (const entry of [...pendingById.values()]) {
      dropPending(entry);
      entry.resolve({ cancelled: true });
    }
    transport.terminate();
  }

  transport.onMessage((raw) => {
    if (!isRecordLike(raw) || typeof raw.id !== "number" || typeof raw.ok !== "boolean") {
      console.warn("avalab dsp rpc: dropped malformed frame", raw);
      return;
    }
    const entry = pendingById.get(raw.id);
    if (entry === undefined) {
      // Late frame for a superseded/cancelled id — dropped silently (§2.3)
      // so it can never reach the caller as a result.
      return;
    }
    if (raw.ok && "cancelled" in raw) {
      dropPending(entry);
      entry.resolve({ cancelled: true });
      return;
    }
    if (raw.ok && "result" in raw) {
      dropPending(entry);
      entry.resolve(raw.result);
      return;
    }
    if (!raw.ok && "error" in raw) {
      const error = raw.error;
      if (isRecordLike(error) && typeof error.code === "string") {
        dropPending(entry);
        entry.reject(
          new DspRpcError(
            error.code,
            typeof error.message === "string" ? error.message : undefined,
          ),
        );
        return;
      }
    }
    console.warn("avalab dsp rpc: dropped malformed frame", raw);
  });

  function call<K extends DspOpName>(
    op: K,
    params: DspOpParams<K>,
    payload?: TransferablePayload,
  ): DspCallPromise<K> {
    const id = nextId++;
    const promise = new Promise<DspOpOutcome<K>>((resolve, reject) => {
      try {
        const normalized = normalizeOutgoingPayload(payload);
        const key = `${op}\u0000${canonicalJson(params)}`;
        const prior = pendingByKey.get(key);
        if (prior !== undefined) {
          // Supersede: identical op+params ⇒ the previous pending call loses.
          // Resolve (never reject) the old promise, tell the worker to exit.
          dropPending(prior);
          prior.resolve({ cancelled: true });
          transport.postMessage({ type: "cancel", id: prior.id }, []);
        }
        // Single cast point for worker results: the wire frame is validated
        // above and per-op result types are enforced at (worker) protocol level.
        const entry: PendingEntry = {
          id,
          key,
          resolve: (value) => resolve(value as DspOpOutcome<K>),
          reject,
        };
        pendingByKey.set(key, entry);
        pendingById.set(id, entry);
        const request: DspOpRequest =
          normalized === undefined ? { id, op, params } : { id, op, params, payload: normalized };
        transport.postMessage(request, normalized === undefined ? [] : [normalized.buffer]);
      } catch (error) {
        // bad payload descriptor or bad params (canonicalJson throws): reject
        // typed so callers never face a synchronous throw.
        reject(
          error instanceof DspRpcError
            ? error
            : new DspRpcError("badParams", error instanceof Error ? error.message : String(error)),
        );
      }
    }) as DspCallPromise<K>;
    promise.callId = id;
    return promise;
  }

  return { call, cancel, terminate };
}

/** Browser transport: direct `Worker` endpoint, single-consumer enforced. */
export function createDspWorkerTransport(worker: Worker): DspRpcTransport {
  let subscribed = false;
  return {
    postMessage(message, transfer) {
      worker.postMessage(message, transfer);
    },
    onMessage(handler) {
      if (subscribed) {
        throw new Error("avalab dsp rpc transport: onMessage may be subscribed once");
      }
      subscribed = true;
      worker.onmessage = (event: MessageEvent) => {
        handler(event.data);
      };
    },
    terminate() {
      worker.terminate();
    },
  };
}

function createDefaultTransport(): DspRpcTransport {
  const worker = new Worker(new URL("../workers/dsp.worker.ts", import.meta.url), {
    type: "module",
  });
  return createDspWorkerTransport(worker);
}

let sharedRpc: DspRpc | undefined;

/**
 * Stand-in rpc used when constructing the Worker threw (blocked worker, bad
 * URL, CSP…). Every `call` settles as a typed rejected promise — rejection
 * mirrors the wire error path, so callers face `DspRpcError`, never a
 * synchronous throw that would kill a React effect. The original error
 * message rides along in dev only; user-facing copy is produced at the UI
 * layer from the code (bilingual-by-code model).
 */
function createUnavailableRpc(error: unknown): DspRpc {
  const reason = new DspRpcError(
    WORKER_UNAVAILABLE_CODE,
    import.meta.env.DEV
      ? `avalab dsp rpc: worker unavailable — ${error instanceof Error ? error.message : String(error)}`
      : undefined,
  );
  return {
    call<K extends DspOpName>(): DspCallPromise<K> {
      const promise = Promise.reject<DspOpOutcome<K>>(reason) as DspCallPromise<K>;
      promise.callId = 0; // nothing pending: no cancellable id to correlate
      return promise;
    },
    cancel: () => undefined,
    terminate: () => undefined,
  };
}

function ensureSharedRpc(): DspRpc {
  if (sharedRpc === undefined) {
    try {
      sharedRpc = createDspRpc(createDefaultTransport());
    } catch (error) {
      // Deliberately NOT cached: no half-initialized singleton state, so the
      // next call retries construction and recovery needs no module reload.
      return createUnavailableRpc(error);
    }
  }
  return sharedRpc;
}

/**
 * Shared rpc for app code (single long-lived worker, like `api` for the
 * backend). Lazy: the worker spawns on the first call, never at module load.
 */
export const dspWorkerRpc: DspRpc = {
  call: (op, params, payload) => ensureSharedRpc().call(op, params, payload),
  cancel: (id) => sharedRpc?.cancel(id),
  terminate: () => {
    sharedRpc?.terminate();
    sharedRpc = undefined;
  },
};

/** Accessor that forces the worker up immediately (for eager pre-loading). */
export function getDspWorkerRpc(): DspRpc {
  return ensureSharedRpc();
}

// HMR: dispose the worker when this module is hot-replaced, else two workers
// stay alive and the stale one answers frames nobody listens to.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    sharedRpc?.terminate();
    sharedRpc = undefined;
  });
}
