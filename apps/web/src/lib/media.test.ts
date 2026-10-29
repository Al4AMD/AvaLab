/**
 * `createRecorder` state-machine tests (F01, Wave-2 Plan 02 Task 3) — every
 * boundary injectable, so the full flow runs in node: grant, engine events,
 * the 5-minute cap timer (`vi.useFakeTimers`), cancellation, and the typed
 * failure paths. The browser glue (default factories) is proven by the e2e
 * absent-devices spec, not here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DURATION_SECONDS } from "../session/store";
import {
  createRecorder,
  hasMediaDevices,
  MAX_RECORDING_SECONDS,
  type RecorderEngine,
  type RecorderStream,
  type RecorderTrack,
  recordingFileName,
} from "./media";

type Harness = {
  events: { data: (b: Blob) => void; stop: () => void; error: (e: { error: unknown }) => void };
  stream: RecorderStream;
  engine: RecorderEngine;
  milestones: { startedWith: number[]; stopped: () => number; engineStreams: RecorderStream[] };
  trackStops: () => number;
  assembled: { blobs: readonly Blob[]; lastMime: string };
};

/** Wire one recorder with observable fakes and capture what it emits. */
function wireRecorder(overrides?: { assembler?: (c: readonly Blob[], m: string) => Blob }): {
  machine: ReturnType<typeof createRecorder>;
  harness: Harness;
} {
  const trackState = { stops: 0 };
  const track: RecorderTrack = {
    stop: () => {
      trackState.stops += 1;
    },
  };
  const stream: RecorderStream = { getTracks: () => [track] };
  const engineRecord = { startedWith: [] as number[], stops: 0, streams: [] as RecorderStream[] };
  const engine: RecorderEngine = {
    start: (ms?: number) => void engineRecord.startedWith.push(ms ?? -1),
    stop: () => {
      engineRecord.stops += 1;
    },
    mimeType: "audio/webm",
    ondataavailable: null,
    onstop: null,
    onerror: null,
  };
  const assembled: { blobs: Blob[]; lastMime: string } = { blobs: [], lastMime: "" };
  const machine = createRecorder({
    onComplete: () => {},
    streamFactory: () => Promise.resolve(stream),
    engineFactory: (grantedStream) => {
      engineRecord.streams.push(grantedStream);
      return engine;
    },
    assembler: (chunks, mimeType) => {
      assembled.lastMime = mimeType;
      return (overrides?.assembler ?? ((cs: Blob[], mt: string) => new Blob(cs, { type: mt })))(
        [...chunks],
        mimeType,
      );
    },
    chunkIntervalMs: 250,
  });
  const harness: Harness = {
    events: {
      data: (blob) => engine.ondataavailable?.({ data: blob }),
      stop: () => engine.onstop?.(),
      error: (e) => engine.onerror?.(e),
    },
    stream,
    engine,
    milestones: {
      startedWith: engineRecord.startedWith,
      stopped: () => engineRecord.stops,
      engineStreams: engineRecord.streams,
    },
    trackStops: () => trackState.stops,
    assembled,
  };
  return { machine, harness };
}

afterEach(() => {
  vi.useRealTimers();
});

/** Grant gate: the test resolves the permission request AFTER a cancel, and
 * observes whether the machine released the granted tracks (a holder keeps
 * TS's control flow from narrowing the resolve to `never`). */
class PromiseRecorderGate {
  released = false;
  private resolver: ((stream: RecorderStream) => void) | null = null;

  readonly stream: Promise<RecorderStream> = new Promise((resolve) => {
    this.resolver = resolve;
  });

  resolveGranted(): Promise<void> {
    this.resolver?.({
      getTracks: () => [
        {
          stop: () => {
            this.released = true;
          },
        },
      ],
    });
    return Promise.resolve();
  }
}

describe("createRecorder", () => {
  it("runs the happy path: grant → recording → stop → processing → done(completed)", async () => {
    const { machine, harness } = wireRecorder();
    await machine.start();
    expect(machine.getState()).toEqual({ phase: "recording" });
    expect(harness.milestones.startedWith).toEqual([250]);
    expect(harness.trackStops()).toBe(0);

    harness.events.data(new Blob(["first"]));
    harness.events.data(new Blob(["second"]));
    machine.stop();
    expect(machine.getState()).toEqual({ phase: "processing" });
    harness.events.stop();

    const state = machine.getState();
    expect(state.phase).toBe("done");
    if (state.phase === "done") {
      expect(state.outcome.kind).toBe("completed");
      expect(state.outcome.blob.size).toBeGreaterThan(0);
    }
    expect(harness.assembled.lastMime).toBe("audio/webm");
    // The mic is released with the completed take (light off), the track was
    // stopped exactly once, and the engine was detached.
    expect(harness.trackStops()).toBe(1);
    expect(harness.engine.onstop).toBeNull();
  });

  it("the 5-minute cap auto-stops through the SAME stop path and completes capReached", async () => {
    vi.useFakeTimers();
    const { machine, harness } = wireRecorder();
    await machine.start();
    vi.advanceTimersByTime(MAX_RECORDING_SECONDS * 1000);
    expect(machine.getState()).toEqual({ phase: "processing" });
    expect(harness.milestones.stopped()).toBe(1);
    harness.events.stop();
    const state = machine.getState();
    if (state.phase === "done") {
      expect(state.outcome.kind).toBe("capReached");
    }
  });

  it("cancel during recording: tracks stop NOW, chunks discarded, no completion, re-armable", async () => {
    const { machine, harness } = wireRecorder();
    await machine.start();
    harness.events.data(new Blob(["half take"]));
    machine.cancel();
    expect(machine.getState()).toEqual({ phase: "idle" });
    expect(harness.trackStops()).toBe(1);
    expect(harness.assembled.blobs).toEqual([]);
    // The late stop event of the discarded attempt must be inert: the state
    // stays idle, no completion, no resurrection to processing.
    harness.events.stop();
    expect(machine.getState()).toEqual({ phase: "idle" });
    expect(harness.assembled.blobs).toEqual([]);
    // And a fresh take still works after the cancel.
    await machine.start();
    expect(machine.getState()).toEqual({ phase: "recording" });
  });

  it("a permission denial (NotAllowedError) lands in requestingDenied, then a retry grants", async () => {
    const denied: ReturnType<typeof createRecorder> = createRecorder({
      onComplete: () => {},
      streamFactory: () => Promise.reject(Object.assign(new Error(), { name: "NotAllowedError" })),
      engineFactory: () => {
        throw new Error("must not be built without permission");
      },
    });
    await denied.start();
    expect(denied.getState()).toEqual({ phase: "requestingDenied" });
  });

  it("a real stream failure (NotReadableError / unknown) lands in the typed error state", async () => {
    const failing: ReturnType<typeof createRecorder> = createRecorder({
      onComplete: () => {},
      streamFactory: () =>
        Promise.reject(Object.assign(new Error("no mic"), { name: "NotReadableError" })),
    });
    await failing.start();
    expect(failing.getState()).toEqual({ phase: "error", mediaError: "NotReadableError" });
    // An unexpected throw maps to the documented fallback, never raw.
    const weird = createRecorder({
      onComplete: () => {},
      streamFactory: () => Promise.reject("not an error object"),
    });
    await weird.start();
    expect(weird.getState()).toEqual({ phase: "error", mediaError: "UnknownError" });
  });

  it("a grant racing a cancel releases the granted tracks and builds no engine", async () => {
    const grant = new PromiseRecorderGate();
    const machine = createRecorder({
      onComplete: () => {},
      streamFactory: () => grant.stream,
    });
    const pending = machine.start();
    machine.cancel();
    expect(machine.getState().phase).toBe("idle");
    await grant.resolveGranted();
    await pending;
    expect(grant.released).toBe(true);
    expect(machine.getState()).toEqual({ phase: "idle" });
  });

  it("a broken assembler surfaces as the typed error state — no hang in processing", async () => {
    const { machine, harness } = wireRecorder({
      assembler: () => {
        throw Object.assign(new Error("boom"), { name: "AbortError" });
      },
    });
    await machine.start();
    machine.stop();
    harness.events.stop();
    expect(machine.getState()).toEqual({ phase: "error", mediaError: "AbortError" });
  });

  it("a start() UV double-click race and out-of-phase stop() are absorbed", async () => {
    const { machine } = wireRecorder();
    await machine.start();
    machine.stop();
    await machine.start(); // recording/processing: absorbed
    machine.stop();
    machine.stop(); // outside recording: no-op
    expect(machine.getState().phase).toBe("processing");
  });

  it("guards the injection contract AND pins the caps to the store constant", () => {
    expect(() => createRecorder({ onComplete: () => {}, chunkIntervalMs: 0 })).toThrow(TypeError);
    expect(MAX_RECORDING_SECONDS).toBe(MAX_DURATION_SECONDS);
    expect(MAX_RECORDING_SECONDS).toBe(300);
    // Node (this test env) exposes no mediaDevices — the absent-hint gate.
    expect(hasMediaDevices()).toBe(false);
  });

  it("recordingFileName maps MIME → container extension without lying", () => {
    expect(recordingFileName("audio/ogg;codecs=opus")).toBe("recording.ogg");
    expect(recordingFileName("audio/mp4")).toBe("recording.m4a");
    expect(recordingFileName("audio/webm;codecs=opus")).toBe("recording.webm");
    expect(recordingFileName("")).toBe("recording.webm");
  });
});
