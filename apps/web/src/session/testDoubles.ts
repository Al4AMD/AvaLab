/**
 * Test-support module shared by the session-layer unit tests (rpc.test.ts,
 * store.test.ts): a transport fake whose postMessage behaves like a real
 * `Worker` postMessage — it records the outgoing frame, structured-clones it
 * WITH the transfer list (detaching the sender's buffers), then — in `"echo"`
 * mode — answers with the sessionPing response shape through the registered
 * handler. `"silent"` mode hands frame delivery to the test via `deliver()`
 * for cancellation/supersede/failure scenarios.
 *
 * No real Worker exists in node (wave pre-flight ruling, T1); the `vite
 * preview` e2e proves the real worker end to end. This file is test-only
 * infrastructure: it must never be imported by application code.
 */
import type { CancelFrame, DspOpRequest, TransferablePayload } from "./protocol";
import { isRecordLike } from "./protocol";

export class FakeTransport {
  readonly sent: { message: unknown; transfer: Transferable[] }[] = [];
  /** Frames as the "worker" received them, with a snapshot of any payload
   * bytes (the live buffer is detached again when the echo transfers it
   * back, so the snapshot is the only readable view). */
  readonly receivedFrames: { frame: unknown; payloadBytes: Uint8Array | undefined }[] = [];
  terminated = false;
  mode: "echo" | "silent" = "echo";
  handler: ((message: unknown) => void) | undefined;

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.sent.push({ message, transfer: [...transfer] });
    if (this.mode !== "echo" || !isRecordLike(message) || typeof message.id !== "number") {
      return;
    }
    if (message.type === "cancel") {
      return;
    }
    // Simulate the worker receiving the frame: the transfer detaches the
    // sender's buffers, and the clone is what the "worker" owns.
    const received = structuredClone(message, { transfer: [...transfer] });
    if (!isRecordLike(received)) {
      throw new Error("fake transport: clone must be a record");
    }
    const payload = isRecordLike(received.payload)
      ? (received.payload as TransferablePayload)
      : undefined;
    this.receivedFrames.push({
      frame: received,
      payloadBytes: payload === undefined ? undefined : new Uint8Array(payload.buffer.slice(0)),
    });
    const response = {
      id: received.id,
      ok: true,
      result: { meta: { received: true }, payload },
    };
    // Simulate the worker answering: its payload buffer is transferred back.
    const echo = structuredClone(response, {
      transfer: payload === undefined ? [] : [payload.buffer],
    });
    this.handler?.(echo);
  }

  onMessage(handler: (message: unknown) => void): void {
    if (this.handler !== undefined) {
      throw new Error("avalab dsp rpc transport: onMessage may be subscribed once");
    }
    this.handler = handler;
  }

  terminate(): void {
    this.terminated = true;
  }

  /** In `silent` mode: hand a worker→main frame to the subscribed handler. */
  deliver(frame: unknown): void {
    this.handler?.(frame);
  }
}

export function makeFakeTransport(mode: "echo" | "silent" = "echo"): FakeTransport {
  const transport = new FakeTransport();
  transport.mode = mode;
  return transport;
}

/** Outgoing request frames in send order (cancels excluded). */
export function requestsOf(transport: FakeTransport): DspOpRequest[] {
  return transport.sent
    .map((entry) => entry.message)
    .filter((message): message is DspOpRequest => {
      if (!isRecordLike(message)) {
        return false;
      }
      return typeof message.id === "number" && typeof message.op === "string";
    });
}

/** Outgoing cancel frames in send order. */
export function cancelFramesOf(transport: FakeTransport): CancelFrame[] {
  return transport.sent
    .map((entry) => entry.message)
    .filter((message): message is CancelFrame => {
      return isRecordLike(message) && message.type === "cancel";
    });
}

/** Runtime-checked typed access to a sent request frame (index must exist). */
export function requestAt(transport: FakeTransport, index: number): DspOpRequest {
  const message = transport.sent[index]?.message;
  if (!isRecordLike(message)) {
    throw new Error(`test: no frame at ${String(index)}`);
  }
  if (typeof message.id !== "number" || typeof message.op !== "string") {
    throw new Error(`test: frame at ${String(index)} is not a request`);
  }
  return message as DspOpRequest;
}

export function uint8(buffer: ArrayBuffer): number[] {
  return [...new Uint8Array(buffer)];
}

export function float32PayloadOf(values: number[]): TransferablePayload {
  const view = new Float32Array(values);
  return { buffer: view.buffer, byteOffset: 0, byteLength: view.byteLength };
}

export function float32ValuesOf(payload: TransferablePayload): number[] {
  return [...new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4)];
}
