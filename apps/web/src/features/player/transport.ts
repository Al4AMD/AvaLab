/**
 * Transport seam over `AudioContext` / `AudioBufferSourceNode`
 * (F02, Wave-2 Plan 02 Task 4; spec §2.7).
 *
 * A typed player STATE MACHINE with every boundary injectable — the
 * context factory, the AudioBuffer factory, the source-node factory, and
 * the time source — so node unit tests drive the machine with recording
 * fakes (no Web Audio exists in node; the browser defaults are proven by
 * e2e, same seam pattern as `lib/media.ts`).
 *
 * State machine:
 *
 *            setSource()               play()            pause()
 *   empty ────────────────▶ ready ─────▶ playing ─────▶ ready (position PINNED
 *    ▲                       │  ▲          │  │           at the interpolated
 *    │ dispose()             │  └──restart──┘  │           position, NOT reset
 *    └───────────────────────┼─────────────────┤           to 0 — pinned test)
 *                            │                 │ engine "ended"
 *   play() resumes from the  │ seekToSample    ▼
 *   pinned position (restarts│ (pins, or stops▶ stopped (end of source;
 *   from 0 when pinned at/   │  + restarts    position = length)
 *   past the end — pinned)   │  the node)     │  play() → playing (from 0)
 *                            └─ setSource ────┘  (stops+disconnects the OLD
 *                               while playing      node first, §9)
 *
 * Documented edge semantics (each pinned by a unit test):
 * - `pause()` pins the interpolated current position (the FRACTIONAL
 *   sub-sample position, not reset to 0); the next `play()` resumes there
 *   sample-exactly through `node.start(0, offset)` (restarts from 0 when
 *   pinned at/past end).
 * - `play()` while `playing` is a no-op (the view repositions with
 *   `seekToSample`); seeking while playing stops the old node and starts a
 *   fresh one at the new offset — at most ONE live node ever (§9).
 * - Time-math honesty (quantization): the interpolation head
 *   (`getCurrentSample`, driven by the context clock) can lead the AUDIBLE
 *   head by at most one render quantum (~128 samples ≈ 2.9 ms at 44.1 kHz)
 *   — inaudible, playhead-only.
 * - `dispose()` re-arms: the same machine takes a new source afterwards.
 * - A zero-length source reaches `ready` but `play()` is a no-op: Web Audio
 *   cannot create a 0-length `AudioBuffer`. Non-finite seek arguments are
 *   documented no-ops (mirrors the store's `setSelection`).
 * - `playbackRate` is PUBLISHED and pinned to 1 (F06 seam): the machine's
 *   time math assumes rate 1 and the source node is never given a
 *   `playbackRate` (Web Audio's default is 1). Wave 3's F06 plugs its speed
 *   modes in here without touching the public shape.
 *
 * Memory discipline (plan Review Focus 2, AGENTS §9): at most TWO full-length
 * buffers are held — the store's immutable `original.samples` plus this
 * transport's playable AudioBuffer (a copy, built by the buffer factory at
 * `setSource`; the session source is never handed to Web Audio directly and
 * never mutated). Exactly one live `AudioBufferSourceNode` exists at a time:
 * every transition abandoning playback stops AND disconnects the old node
 * before the new one is created. `setSource` drops the previous playable
 * buffer reference (the copy is released with it).
 */

/** Structural decoded-audio shape (a real Web Audio `AudioBuffer` satisfies
 * it; the ingest lane's `DecodedAudio` is the same shape — reused on
 * purpose, no second "decoded audio" vocabulary). */
export type AudioBufferLike = {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
};

/** Playable buffer handed to nodes: the same structural shape. */
export type TransportBuffer = AudioBufferLike;

/** The machine's four phases (brief Task 4). `playing` carries the sample
 * offset the node was started at; `ready`/`stopped` carry the pinned
 * position (see the header's position-semantics diagram). */
export type TransportState =
  | { readonly phase: "empty" }
  | { readonly phase: "ready"; readonly positionSample: number }
  | { readonly phase: "playing"; readonly startedAtSample: number }
  | { readonly phase: "stopped"; readonly positionSample: number };

export type TransportListener = (state: TransportState) => void;

/** Narrow context seam: exactly what the transport needs from an
 * `AudioContext` (+ optional `resume`/`close`: a context created outside a
 * user gesture starts suspended, and the play path must activate it). */
export type TransportContext = {
  readonly currentTime: number;
  readonly destination: unknown;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): TransportBuffer;
  /** Fired fire-and-forget on play; a rejection stays silent (playback
   * would simply stay silent — no crash, no console error). */
  resume?(): void | Promise<void>;
  close?(): void | Promise<void>;
};

/** Narrow source-node seam: exactly the fields the machine drives/observes. */
export type TransportNode = {
  buffer: TransportBuffer | null;
  start(when?: number, offset?: number): void;
  stop(): void;
  disconnect(): void;
  /** Event-target-style hook; the machine DETACHES it before every
   * intentional `stop()` so a late engine event is inert. */
  onended: (() => void) | null;
};

export type TransportContextFactory = () => TransportContext;
export type TransportBufferFactory = (
  source: AudioBufferLike,
  sampleRateHz: number,
  context: TransportContext,
) => TransportBuffer;
export type TransportNodeFactory = (context: TransportContext) => TransportNode;
export type TransportTimeSource = (context: TransportContext) => number;

/** Options of `createTransport`: every boundary defaults to the browser
 * implementation; node tests inject fakes. `onEnded` is the end-of-source
 * seam: invoked EXACTLY ONCE with the boundary sample (the source length)
 * when the engine reports a natural end of a PLAYING node — `usePlayer`
 * wires it to the playhead pub-sub ("publish boundary"). */
export type TransportOptions = {
  readonly contextFactory?: TransportContextFactory;
  readonly bufferFactory?: TransportBufferFactory;
  readonly nodeFactory?: TransportNodeFactory;
  readonly timeSource?: TransportTimeSource;
  readonly onEnded?: (sample: number) => void;
};

/** Default browser context (one per transport lifetime). Same
 * constructed-inside-the-call shape as the ingest lane's decode seam, so
 * node tests that inject their factories never touch Web Audio. */
const defaultContextFactory: TransportContextFactory = () => new AudioContext();

/**
 * Default buffer factory: copy the decoded channels into a fresh AudioBuffer
 * at the canonical rate (the two-buffer §9 budget: the session source stays
 * store-owned and untouched, the playback copy lives only here). Channel
 * views are hoisted once; `set()` copies (a real AudioBuffer's
 * `getChannelData` returns a live view — never released by this lane).
 */
const defaultBufferFactory: TransportBufferFactory = (source, sampleRateHz, context) => {
  const length = source.numberOfChannels > 0 ? source.getChannelData(0).length : 0;
  const buffer = context.createBuffer(source.numberOfChannels, length, sampleRateHz);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    buffer.getChannelData(channel).set(source.getChannelData(channel));
  }
  return buffer;
};

/**
 * Default node factory: the real `AudioBufferSourceNode`. One cast point
 * (single-cast-adapter pattern, media.ts/ingest.ts precedent): the DOM node
 * IS structurally this seam, but its `disconnect` overloads make TS refuse
 * the direct assignment.
 */
const defaultNodeFactory: TransportNodeFactory = (context) => {
  const domContext = context as unknown as AudioContext;
  return domContext.createBufferSource() as unknown as TransportNode;
};

const defaultTimeSource: TransportTimeSource = (context) => context.currentTime;

/** Runtime guard for `setSource` (structural shape + finite positive rate).
 * Failures throw — a malformed call is an app-code bug and must fail loudly
 * (protocol.ts / media.ts convention), leaving the previous state intact. */
function requireBufferLike(source: unknown, sampleRateHz: number): AudioBufferLike {
  if (
    typeof source !== "object" ||
    source === null ||
    typeof (
      source as {
        getChannelData?: unknown;
        numberOfChannels?: unknown;
      }
    ).getChannelData !== "function" ||
    typeof (
      source as {
        getChannelData?: unknown;
        numberOfChannels?: unknown;
      }
    ).numberOfChannels !== "number" ||
    (source as { numberOfChannels: number }).numberOfChannels < 1
  ) {
    throw new TypeError(
      "transport.setSource: source must expose numberOfChannels + getChannelData",
    );
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new TypeError("transport.setSource: sampleRateHz must be a positive finite number");
  }
  return source as AudioBufferLike;
}

/** Stable empty-state identity for `useSyncExternalStore` snapshots. */
const EMPTY_STATE: TransportState = { phase: "empty" };

const clampSample = (sample: number, length: number): number =>
  sample < 0 ? 0 : sample > length ? length : sample;

/** Interpolated position of a playing node: the sample offset the node was
 * started at plus the elapsed context time scaled to samples. */
function playingPosition(
  startedAtSample: number,
  startedAtTime: number,
  sampleRateHz: number,
  now: number,
): number {
  return startedAtSample + (now - startedAtTime) * sampleRateHz;
}

/** The handle the view holds: drive the machine, read/subscribe its state. */
export type Transport = {
  getState(): TransportState;
  subscribe(listener: TransportListener): () => void;
  /** Source extent (samples); 0 while empty. Seconds = length/sampleRateHz. */
  readonly lengthSamples: number;
  /** Canonical rate of the loaded source (the store's); 0 while empty. */
  readonly sampleRateHz: number;
  /** F06 seam — published, pinned to 1 until Wave 3 (module header). */
  readonly playbackRate: number;
  setSource(source: AudioBufferLike, sampleRateHz: number): void;
  play(fromSample?: number): void;
  pause(): void;
  seekToSample(sample: number): void;
  seekBySeconds(deltaSeconds: number): void;
  /** Time-source interpolation (head position while playing) or the pinned
   * position; 0 while empty. Clamped to [0, length]. */
  getCurrentSample(): number;
  dispose(): void;
};

export function createTransport(options: TransportOptions = {}): Transport {
  const {
    contextFactory = defaultContextFactory,
    bufferFactory = defaultBufferFactory,
    nodeFactory = defaultNodeFactory,
    timeSource = defaultTimeSource,
    onEnded,
  } = options;

  let state: TransportState = EMPTY_STATE;
  let context: TransportContext | null = null;
  let playable: TransportBuffer | null = null;
  let liveNode: TransportNode | null = null;
  /** Context-clock reading taken when the live node started (seconds). */
  let startedAtTime = 0;
  let startedAtSample = 0;
  let lengthSamples = 0;
  let sampleRateHz = 0;
  const listeners = new Set<TransportListener>();

  function notify(): void {
    for (const listener of listeners) {
      listener(state);
    }
  }

  /**
   * Intentional node teardown (pause/seek/discard/dispose): DETACH the
   * engine hook first — a real `stop()` fires `onended`, and the recorded
   * callback must not re-enter the machine — then stop and disconnect, so
   * the node cannot outlive its state (§9 single live node).
   */
  function dropLiveNode(): void {
    if (liveNode === null) {
      return;
    }
    liveNode.onended = null;
    try {
      liveNode.stop();
    } catch (error) {
      // A real node throws InvalidStateError only if it never started —
      // impossible by construction; the warning keeps it non-silent.
      console.warn("avalab player: node stop during teardown", error);
    }
    liveNode.disconnect();
    liveNode = null;
  }

  /**
   * Engine hook of the CURRENT node only: natural end → `stopped`, pin the
   * source length as the final position, disconnect (safe on an ended
   * node), and fire the `onEnded` seam once with the boundary sample.
   */
  function handleEngineEnded(): void {
    if (liveNode === null || state.phase !== "playing") {
      return; // a stale engine event for a torn-down node: inert
    }
    const endedNode = liveNode;
    liveNode = null;
    endedNode.onended = null;
    endedNode.disconnect();
    state = { phase: "stopped", positionSample: lengthSamples };
    notify();
    onEnded?.(lengthSamples);
  }

  /**
   * Shared "start the (re)positioned node" tail of `play()` and of the
   * seeks that keep playing: fresh node (the caller already dropped the
   * previous one), fresh clock stamp, wired hook, fired resume.
   */
  function startPlayback(target: number): void {
    if (context === null || playable === null) {
      throw new Error("transport: startPlayback without a source (machine invariant broken)");
    }
    const node = nodeFactory(context);
    node.buffer = playable;
    node.onended = () => {
      handleEngineEnded();
    };
    liveNode = node;
    startedAtTime = timeSource(context);
    startedAtSample = target;
    // Buffer-relative offset in seconds (not context-clock arithmetic).
    node.start(0, target / sampleRateHz);
    const resumed = context.resume?.(); // suspended contexts activate here
    if (resumed !== undefined) {
      resumed.catch(() => undefined); // silent degradation, module header
    }
    state = { phase: "playing", startedAtSample: target };
    notify();
  }

  /** Shared `seekToSample` tail: clamps, then either restarts the node
   * (still playing) or pins the position (ready / stopped → ready). */
  function seek(sample: number): void {
    const target = clampSample(sample, lengthSamples);
    if (state.phase === "playing") {
      dropLiveNode(); // abandon THIS node only; playback restarts below
      startPlayback(target);
      return;
    }
    // ready → pinned; stopped → ready (playback may resume from there).
    state = { phase: "ready", positionSample: target };
    notify();
  }

  /** Interpolated head while playing, pinned position otherwise; clamped
   * to [0, length]. Single source of truth for the head readout and the
   * relative-seek base. */
  function currentSample(): number {
    if (state.phase !== "playing") {
      return state.phase === "empty" ? 0 : state.positionSample;
    }
    if (context === null) {
      throw new Error("transport: playing without a context (machine invariant broken)");
    }
    return clampSample(
      playingPosition(startedAtSample, startedAtTime, sampleRateHz, timeSource(context)),
      lengthSamples,
    );
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    get lengthSamples(): number {
      return lengthSamples;
    },

    get sampleRateHz(): number {
      return sampleRateHz;
    },

    get playbackRate(): number {
      return 1; // F06 seam, pinned (module header)
    },

    setSource(rawSource, rawSampleRateHz) {
      const source = requireBufferLike(rawSource, rawSampleRateHz);
      // Build the playable copy FIRST: a factory throw leaves the previous
      // source and playback completely intact (no half-swapped state).
      if (context === null) {
        context = contextFactory();
      }
      // Zero-length channel data is skipped: Web Audio cannot create a
      // 0-length AudioBuffer (NotSupportedError) — the machine lands in
      // ready with length 0 and play() stays a documented no-op.
      const rawLength = source.getChannelData(0).length;
      const nextPlayable =
        source.numberOfChannels > 0 && rawLength > 0
          ? bufferFactory(source, rawSampleRateHz, context)
          : null; // degenerate input → honest zero-length source
      // Only now abandon the old playback: the old node stops + disconnects
      // (§9) BEFORE the new source/length/rate are published.
      dropLiveNode();
      playable = nextPlayable;
      lengthSamples =
        nextPlayable === null
          ? 0
          : nextPlayable.numberOfChannels > 0
            ? nextPlayable.getChannelData(0).length
            : 0;
      sampleRateHz = rawSampleRateHz;
      state = { phase: "ready", positionSample: 0 };
      notify();
    },

    play(fromSample) {
      if (state.phase === "empty" || playable === null || lengthSamples === 0) {
        return; // nothing to play; a zero-length source can never start
      }
      if (state.phase === "playing") {
        return; // documented no-op; the view repositions via seekToSample
      }
      const pinned =
        state.phase === "ready" || state.phase === "stopped" ? state.positionSample : 0;
      const requested = fromSample === undefined ? pinned : clampSample(fromSample, lengthSamples);
      // At/past the end (paused on the last sample, natural stop): restart.
      const start = requested >= lengthSamples ? 0 : requested;
      startPlayback(start);
    },

    pause() {
      if (state.phase !== "playing" || context === null) {
        return; // ready/stopped/empty: documented no-op
      }
      const nowSample = clampSample(
        playingPosition(startedAtSample, startedAtTime, sampleRateHz, timeSource(context)),
        lengthSamples,
      );
      dropLiveNode(); // detach hook, stop, disconnect — one live node rule
      state = { phase: "ready", positionSample: nowSample }; // PINNED, not 0
      notify();
    },

    seekToSample(sample) {
      if (state.phase === "empty" || !Number.isFinite(sample)) {
        return; // documented no-op (mirrors the store's setSelection)
      }
      seek(sample);
    },

    seekBySeconds(deltaSeconds) {
      if (state.phase === "empty" || !Number.isFinite(deltaSeconds)) {
        return; // documented no-op
      }
      // Base = the interpolated head while playing, the pinned position
      // otherwise (currentSample()).
      seek(currentSample() + deltaSeconds * sampleRateHz);
    },

    getCurrentSample: currentSample,

    dispose() {
      dropLiveNode();
      lengthSamples = 0;
      sampleRateHz = 0;
      startedAtSample = 0;
      startedAtTime = 0;
      playable = null;
      state = EMPTY_STATE;
      notify(); // final state delivered before the listeners detach
      listeners.clear();
      const closing = context?.close?.();
      if (closing !== undefined) {
        closing.catch(() => undefined); // a doomed context is best-effort
      }
      context = null; // a later setSource re-arms via the factory
    },
  };
}

/**
 * Session-source → playback bufferLike adapter: the transport plays the
 * ORIGINAL session source at full length. Every lane (ingest/offline/demo/
 * recording) stores the mono analysis lane today (spec §2.2) — so playback
 * is mono at the source's rate; the seam already carries multichannel data
 * for the stereo session field if one is ever added (T1 owner concern 4).
 * Never mutates the store's samples.
 */
export function sourceToBufferLike(original: {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
}): AudioBufferLike {
  return {
    numberOfChannels: 1,
    sampleRate: original.sampleRateHz,
    getChannelData(channel: number): Float32Array {
      if (channel !== 0) {
        throw new RangeError(`sourceToBufferLike: no channel ${String(channel)}`);
      }
      return original.samples;
    },
  };
}
