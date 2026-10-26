/**
 * Recorder seam over `MediaRecorder` (F01, Wave-2 Plan 02 Task 3).
 *
 * The browser recording path wrapped in a typed state machine with EVERY
 * boundary injectable — the getUserMedia factory, the MediaRecorder
 * constructor factory, the chunk interval, and the blob assembly — so node
 * unit tests drive the machine without a microphone (no real Web Audio /
 * MediaRecorder exists in node; the browser paths here are proven by e2e).
 *
 * State machine (states: idle | requesting | requestingDenied | recording |
 * processing | error(mediaError) | done(outcome)):
 *
 *   idle ──start()──▶ requesting ──grant──▶ recording ──stop()──▶ processing
 *                        │                    │                      │ onstop
 *                        │ denied             │ cap timer (300 s)    ▼
 *                        ▼                    └──auto-stop────────▶ done(outcome)
 *                 requestingDenied                                (completed | capReached)
 *                        └──throw──▶ error(mediaError) ◀──engine onerror──┐
 *   recording|requesting|processing ──cancel()/dispose()──▶ idle          │
 *                (tracks stop NOW, chunks discarded, light off)            │
 *   done|error|requestingDenied ──start()──▶ requesting (a fresh take)    │
 *                          and the grant/stop races above invalidate the  │
 *                          previous attempt via its attempt id ───────────┘
 *
 * The 5-minute cap lives INSIDE the machine (AGENTS §7/F01): a recording that
 * passes 300 s auto-stops through the SAME stop path and completes with the
 * typed `capReached` outcome — the caller decides the UX (record.tsx shows
 * the translated cap message and does not send the take to the backend,
 * which would reject it; plan Task 3: honest UX beats a surprise). The cap
 * constant mirrors the session store's `MAX_DURATION_SECONDS` — pinned equal
 * by a unit test so the two stay one app-wide cap.
 *
 * Attempts are guarded by a monotonic attempt id: every cancel/dispose/new
 * start invalidates the live attempt, so a permission grant racing a cancel
 * releases its tracks, and engine events arriving after the attempt ended
 * (the real MediaRecorder fires its stop event asynchronously) can never
 * complete a discarded take or resurrect an old state.
 *
 * Honest edge: if an engine never fires its stop event after `stop()`, the
 * machine stays in `processing` — `cancel()`/`dispose()` are the escape
 * hatches (documented; a real MediaRecorder always fires the event).
 */
import { MAX_DURATION_SECONDS } from "../session/store";

/**
 * The recorder's MIME type is the platform's choice (e.g. "audio/webm").
 * Chunks arrive once per interval (MediaRecorder.start(timeslice)) and the
 * final chunk fires with the stop event — the machine assembles them all.
 */
export const DEFAULT_CHUNK_INTERVAL_MS = 1_000;

/**
 * Client-side recording cap in seconds (AGENTS §7/F01: 5 minutes). Mirrors
 * the session store's `MAX_DURATION_SECONDS`; a unit test pins them equal —
 * the backend rejects a longer ingest anyway (its `duration_too_long` 422),
 * so the cap here is the honest UX, not a second truth.
 */
export const MAX_RECORDING_SECONDS = MAX_DURATION_SECONDS;

/** Narrow stream seam: exactly the tracks the machine must be able to stop. */
export type RecorderTrack = {
  stop(): void;
};

export type RecorderStream = {
  getTracks(): RecorderTrack[];
};

/**
 * Narrow engine seam over the MediaRecorder the machine drives/observes:
 * start the recorder with a chunk interval, request the final chunk + stop
 * event via `stop()`, and expose the three event handlers (the real events
 * are `dataavailable`, `stop`, `error`; a fake engine calls them directly).
 */
export type RecorderEngine = {
  start(timesliceMs?: number): void;
  stop(): void;
  readonly mimeType: string;
  ondataavailable: ((event: { readonly data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: { readonly error: unknown }) => void) | null;
};

export type RecorderStreamFactory = () => Promise<RecorderStream>;
export type RecorderEngineFactory = (stream: RecorderStream) => RecorderEngine;

/** Blob assembly seam: the collected chunks (+ the engine's MIME type) → the
 * recorded blob. Injectable so tests can assert the typed output of the
 * assembly step itself. */
export type RecorderAssembler = (chunks: readonly Blob[], mimeType: string) => Blob;

/** DOMException names `getUserMedia`/`MediaRecorder` reject with (MDN),
 * plus the fallback for anything unexpected. A `NotAllowedError` permission
 * denial lands in the `requestingDenied` state instead (a distinct,
 * recoverable state), so it is not a member here. */
export type RecorderMediaError =
  | "NotFoundError"
  | "NotReadableError"
  | "OverconstrainedError"
  | "AbortError"
  | "SecurityError"
  | "UnknownError";

/** How a take ended: a manual stop, or the machine's own cap auto-stop. */
export type RecorderCompletion =
  | { readonly kind: "completed"; readonly blob: Blob }
  | { readonly kind: "capReached"; readonly blob: Blob };

/** The typed machine state (the component renders from it). */
export type RecorderState =
  | { readonly phase: "idle" }
  | { readonly phase: "requesting" }
  | { readonly phase: "requestingDenied" }
  | { readonly phase: "recording" }
  | { readonly phase: "processing" }
  | { readonly phase: "error"; readonly mediaError: RecorderMediaError }
  | { readonly phase: "done"; readonly outcome: RecorderCompletion };

export type RecorderListener = (state: RecorderState) => void;

/** Options of `createRecorder`: the completion callback is required (a
 * recorder without a consumer is pointless); every other boundary defaults
 * to the browser implementation. */
export type RecorderOptions = {
  readonly onComplete: (completion: RecorderCompletion) => void;
  readonly streamFactory?: RecorderStreamFactory;
  readonly engineFactory?: RecorderEngineFactory;
  readonly assembler?: RecorderAssembler;
  readonly chunkIntervalMs?: number;
};

/** The handle the view holds: drive the machine, read/subscribe its state. */
export type Recorder = {
  /** Permission request → live tracks (state `recording` when it resolves;
   * every failure lands in a typed state, it never rejects). */
  start(): Promise<void>;
  /** Final chunk → `processing` → `done(outcome)` + `onComplete`. */
  stop(): void;
  /** Stop the tracks NOW, discard the chunks, back to `idle`. */
  cancel(): void;
  /** Unmount cleanup: the same hard stop as cancel, plus listeners cleared. */
  dispose(): void;
  getState(): RecorderState;
  subscribe(listener: RecorderListener): () => void;
};

/** Runtime-checked name of a thrown thing (DOMException-ish or not). */
function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") {
      return name;
    }
  }
  return "UnknownError";
}

const MEDIA_ERROR_NAMES: readonly string[] = [
  "NotFoundError",
  "NotReadableError",
  "OverconstrainedError",
  "AbortError",
  "SecurityError",
];

/** Runtime-checked narrowing (no blind casts): a name is a machine media
 * error only when it is one of the documented DOMException names. */
function isRecorderMediaErrorName(name: string): name is RecorderMediaError {
  return MEDIA_ERROR_NAMES.includes(name);
}

/** Map a thrown thing to the machine's media-error name (unknown → the
 * fallback; the UI translates by name, it never renders it raw). */
function toMediaError(error: unknown): RecorderMediaError {
  const name = errorName(error);
  return isRecorderMediaErrorName(name) ? name : "UnknownError";
}

/**
 * Default browser stream factory: `navigator.mediaDevices.getUserMedia`
 * with audio only. Absent media-devices API → a rejection the machine maps
 * to the error state (the proactive absent-devices hint in record.tsx is
 * `hasMediaDevices()`, so this only fires on a mid-click disappearance).
 */
const defaultStreamFactory: RecorderStreamFactory = () => {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (mediaDevices === undefined) {
    return Promise.reject(new Error("media devices API unavailable"));
  }
  return mediaDevices.getUserMedia({ audio: true });
};

/**
 * Default browser engine factory: the real `MediaRecorder` constructor.
 * The one cast point bridges the narrow seam type back to the DOM type (the
 * same single-cast-adapter pattern as the ingest lane's default client).
 */
const defaultEngineFactory: RecorderEngineFactory = (stream) => {
  const recorder = new MediaRecorder(stream as unknown as MediaStream);
  const engine: RecorderEngine = {
    start: (timesliceMs) => {
      recorder.start(timesliceMs);
    },
    stop: () => {
      recorder.stop();
    },
    // Read lazily: the UA settles the MIME type at start.
    get mimeType() {
      return recorder.mimeType;
    },
    ondataavailable: null,
    onstop: null,
    onerror: null,
  };
  recorder.ondataavailable = (event) => {
    engine.ondataavailable?.(event);
  };
  recorder.onstop = () => {
    engine.onstop?.();
  };
  recorder.onerror = (event) => {
    // lib.dom types the error event as a plain Event, but user agents fire
    // a legacy MediaRecorderErrorEvent carrying `error: DOMException`.
    const domError = (event as { error?: { name?: string } }).error;
    engine.onerror?.({ error: domError ?? event });
  };
  return engine;
};

const defaultAssembler: RecorderAssembler = (recordedChunks, mimeType) =>
  new Blob([...recordedChunks], { type: mimeType });

/**
 * Build one recorder (F01 Task 3). Pure at construction (no timers, no
 * listeners, no globals touched); every boundary injectable; the machine's
 * state changes notify subscribers with a STABLE state object (safe for
 * React's `useSyncExternalStore` snapshot semantics).
 */
export function createRecorder(options: RecorderOptions): Recorder {
  const {
    onComplete,
    streamFactory = defaultStreamFactory,
    engineFactory = defaultEngineFactory,
    assembler = defaultAssembler,
    chunkIntervalMs = DEFAULT_CHUNK_INTERVAL_MS,
  } = options;
  if (!Number.isFinite(chunkIntervalMs) || chunkIntervalMs <= 0) {
    throw new TypeError(
      "createRecorder: chunkIntervalMs must be a positive finite number of milliseconds",
    );
  }

  let state: RecorderState = { phase: "idle" };
  let stream: RecorderStream | null = null;
  let engine: RecorderEngine | null = null;
  let chunks: Blob[] = [];
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let capAborted = false;
  // Monotonic attempt id: bumped by start (fresh take), cancel, dispose, and
  // completion — every async continuation checks it against its own copy.
  let attempt = 0;
  const listeners = new Set<RecorderListener>();

  function setPhase(next: RecorderState): void {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  }

  function clearCapTimer(): void {
    if (capTimer !== null) {
      clearTimeout(capTimer);
      capTimer = null;
    }
  }

  function stopTracks(streamToStop: RecorderStream): void {
    for (const track of streamToStop.getTracks()) {
      track.stop();
    }
  }

  /** Drop the engine + stream refs with their handlers detached, so late
   * engine events (the real MediaRecorder's async stop event) are inert. */
  function detachEngine(): void {
    if (engine !== null) {
      engine.ondataavailable = null;
      engine.onstop = null;
      engine.onerror = null;
    }
    engine = null;
    stream = null;
  }

  /** The take's completion: stop the mic (the light goes off — the take is
   * over), assemble via the injected assembler, publish the typed outcome. */
  function completeAttempt(attemptId: number): void {
    if (attempt !== attemptId || state.phase !== "processing") {
      return; // stale or already settled
    }
    const collected = chunks;
    const attemptEngine = engine;
    const attemptStream = stream;
    const wasCapAborted = capAborted;
    attempt += 1;
    chunks = [];
    capAborted = false;
    clearCapTimer();
    if (attemptStream !== null) {
      stopTracks(attemptStream);
    }
    detachEngine();
    const mimeType = attemptEngine?.mimeType ?? "";
    let blob: Blob;
    try {
      blob = assembler(collected, mimeType);
    } catch (error) {
      // A broken assembler is surfaced as the typed error state, never
      // swallowed — the machine must not hang in `processing`.
      setPhase({ phase: "error", mediaError: toMediaError(error) });
      return;
    }
    const outcome: RecorderCompletion = wasCapAborted
      ? { kind: "capReached", blob }
      : { kind: "completed", blob };
    setPhase({ phase: "done", outcome });
    onComplete(outcome);
  }

  /** Terminal failure of the live attempt: release the mic, surface the
   * typed media error. Never called for `NotAllowedError` (that lands in
   * `requestingDenied`, the recoverable denial state). */
  function failAttempt(attemptId: number, error: unknown): void {
    if (attempt !== attemptId) {
      return; // superseded
    }
    attempt += 1;
    clearCapTimer();
    capAborted = false;
    if (stream !== null) {
      stopTracks(stream);
    }
    detachEngine();
    chunks = [];
    setPhase({ phase: "error", mediaError: toMediaError(error) });
  }

  async function start(): Promise<void> {
    const phase = state.phase;
    if (
      !(phase === "idle" || phase === "done" || phase === "error" || phase === "requestingDenied")
    ) {
      return; // requesting/recording/processing: a UI double-click race, absorbed
    }
    attempt += 1;
    const attemptId = attempt;
    chunks = [];
    capAborted = false;
    setPhase({ phase: "requesting" });

    let grantedStream: RecorderStream;
    try {
      grantedStream = await streamFactory();
    } catch (error) {
      if (attempt !== attemptId) {
        return; // the request was cancelled/disposed while pending
      }
      if (errorName(error) === "NotAllowedError") {
        attempt += 1;
        setPhase({ phase: "requestingDenied" });
      } else {
        failAttempt(attemptId, error);
      }
      return;
    }

    if (attempt !== attemptId) {
      // The grant raced a cancel/dispose: close the live tracks NOW.
      stopTracks(grantedStream);
      return;
    }

    const attemptEngine = engineFactory(grantedStream);
    stream = grantedStream;
    engine = attemptEngine;
    attemptEngine.ondataavailable = (event) => {
      if (attempt !== attemptId) {
        return; // stale chunk of an ended attempt
      }
      chunks.push(event.data);
    };
    attemptEngine.onstop = () => {
      completeAttempt(attemptId);
    };
    attemptEngine.onerror = (event) => {
      failAttempt(attemptId, event.error);
    };
    attemptEngine.start(chunkIntervalMs);
    setPhase({ phase: "recording" });

    // The honest client cap (see the module header): one timer for the whole
    // take; firing routes through the SAME stop path as a manual stop.
    capTimer = setTimeout(() => {
      if (attempt !== attemptId || state.phase !== "recording") {
        return; // the take already ended; the timer was a leftover no-op
      }
      capTimer = null;
      capAborted = true;
      stop();
    }, MAX_RECORDING_SECONDS * 1000);
  }

  function stop(): void {
    if (state.phase !== "recording" || engine === null) {
      return;
    }
    clearCapTimer();
    setPhase({ phase: "processing" });
    // The engine (real or fake) must now fire its final dataavailable and
    // its stop event; completeAttempt finishes the attempt from there.
    engine.stop();
  }

  function cancel(): void {
    attempt += 1; // every in-flight continuation of this attempt becomes stale
    clearCapTimer();
    capAborted = false;
    if (stream !== null) {
      stopTracks(stream); // Review Focus 4: the tracks stop NOW (light off)
    }
    detachEngine();
    chunks = []; // a cancelled take is never assembled, never emitted
    setPhase({ phase: "idle" });
  }

  function dispose(): void {
    cancel(); // same hard stop (re-armable by design: StrictMode re-mounts)
    listeners.clear(); // the owner is unmounting: no further notifications
  }

  function subscribe(listener: RecorderListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    start,
    stop,
    cancel,
    dispose,
    getState: () => state,
    subscribe,
  };
}

/**
 * Whether the platform exposes a media-devices API at all (the proactive
 * gate behind the absent-devices hint in record.tsx — checked before any
 * permission request so a device-less browser degrades honestly).
 */
export function hasMediaDevices(): boolean {
  return typeof navigator !== "undefined" && navigator.mediaDevices !== undefined;
}

/**
 * File name for the recorded take, derived from the blob's MIME type so the
 * extension never lies about the container (the backend probes the bytes
 * with ffprobe anyway, AGENTS §7 — the name is for humans and the store).
 */
export function recordingFileName(mimeType: string): string {
  if (mimeType.startsWith("audio/ogg")) {
    return "recording.ogg";
  }
  if (mimeType.startsWith("audio/mp4")) {
    return "recording.m4a";
  }
  return "recording.webm";
}
