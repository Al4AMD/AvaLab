/**
 * React glue for the dock player (F02, Wave-2 Plan 02 Task 4).
 *
 * Responsibilities (the view in `player.tsx` stays a thin painter):
 * - Subscribe the session store's `original` (by reference — the immutable
 *   per-load source object) and REBUILD the transport source on every
 *   change: `setSource` copies the full-length samples into the transport's
 *   playable AudioBuffer and stops+disconnects the previous node (§9: the
 *   transport owns the single live node; this hook owns the single
 *   transport). Playback runs the ORIGINAL session source at full length —
 *   never a derived/selection slice, and never a re-downmix (all lanes
 *   already store the mono analysis lane per spec §2.2).
 * - Wire the transport's end-of-source seam to the `appPlayhead` pub-sub
 *   (the "publish boundary" of plan Task 4) and run EXACTLY ONE rAF loop
 *   while playing, publishing the interpolated head each frame. Nothing
 *   else renders per frame: React re-renders only on machine STATE changes,
 *   and Plan 03's canvases subscribe to `appPlayhead` directly.
 * - Cleanup: the machine lives in a mount-only effect (the record.tsx
 *   pattern — survives StrictMode's double-invoked effects with a fresh
 *   machine per remount) and `dispose()`s on unmount.
 *
 * Not store state: the playhead position is transient (rAF-paced), so it
 * lives in the playhead pub-sub and component-local throttled state —
 * writing it into the session store would re-render subscribers per frame.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import type { SessionSource } from "../../session/store";
import { useSessionStore } from "../../session/store";
import { appPlayhead } from "./playhead";
import {
  createTransport,
  sourceToBufferLike,
  type Transport,
  type TransportState,
} from "./transport";

/** Stable fallback while the transport's mount effect has not run yet
 * (SSR/static render; StrictMode's null window) — snapshot identity must
 * stay referential (useSyncExternalStore requirement). */
const FALLBACK_STATE: TransportState = { phase: "empty" };

export type PlayerApi = {
  readonly machine: Transport | null;
  /** The transport's machine state (fallback while the mount effect runs). */
  readonly state: TransportState;
  readonly lengthSamples: number;
  readonly sampleRateHz: number;
  /** Play/pause toggle by phase (the button is the only caller). */
  readonly togglePlay: () => void;
  readonly seekBySeconds: (deltaSeconds: number) => void;
  readonly seekToSample: (sample: number) => void;
};

/** Build one dock player around the session store. */
export function usePlayer(): PlayerApi {
  // Reference selector: `original` is replaced wholesale by loadSource, so
  // identity equality is exactly "this source" (no per-sample compares).
  const original: Readonly<SessionSource> | null = useSessionStore((state) => state.original);

  const [machine, setMachine] = useState<Transport | null>(null);
  useEffect(() => {
    const transport = createTransport({
      // End-of-source seam → the playhead boundary (canvases land there).
      onEnded: (sample) => {
        appPlayhead.publish(sample);
      },
    });
    setMachine(transport);
    return () => {
      transport.dispose();
    };
  }, []);

  const state: TransportState = useSyncExternalStore(
    (notify) => machine?.subscribe(notify) ?? (() => {}),
    () => machine?.getState() ?? FALLBACK_STATE,
    () => FALLBACK_STATE, // static render: no machine, no playback
  );

  // Source attach: replays on machine mount AND on every store source
  // change. `setSource` stops+disconnects the previous node itself, so the
  // §9 single-live-node rule lives in the transport (single place, tested
  // there). The store cannot return to null (no unload action exists), so
  // a null `original` here is only the pre-first-load window.
  // Graceful degradation at the app boundary: a source the platform cannot
  // turn into an AudioBuffer (e.g. a rate below the Web Audio createBuffer
  // floor) must NOT crash the tool tree — the transport keeps its previous
  // state and the dock stays in its no-source posture; the warning keeps
  // the failure non-silent for developers.
  useEffect(() => {
    if (machine === null || original === null) {
      return;
    }
    try {
      machine.setSource(sourceToBufferLike(original), original.sampleRateHz);
    } catch (error) {
      console.warn("avalab player: the platform cannot play this source", error);
    }
  }, [machine, original]);

  // EXACTLY one rAF loop, ONLY while playing: publishes the interpolated
  // head each frame; the phase change tears it down (pause/end/source swap).
  const playing = state.phase === "playing";
  useEffect(() => {
    if (machine === null || !playing) {
      return;
    }
    let frame = 0;
    const tick = (): void => {
      appPlayhead.publish(machine.getCurrentSample());
      frame = requestAnimationFrame(tick);
    };
    tick(); // the (re)start position in the same frame it changes
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [machine, playing]);

  return {
    machine,
    state,
    lengthSamples: machine?.lengthSamples ?? 0,
    sampleRateHz: machine?.sampleRateHz ?? 0,
    togglePlay: () => {
      if (machine === null) {
        return;
      }
      if (state.phase === "playing") {
        machine.pause();
        return;
      }
      machine.play();
    },
    seekBySeconds: (deltaSeconds) => {
      machine?.seekBySeconds(deltaSeconds);
    },
    seekToSample: (sample) => {
      machine?.seekToSample(sample);
    },
  };
}
