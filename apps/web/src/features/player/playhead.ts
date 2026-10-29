/**
 * Playhead pub-sub (F02, Wave-2 Plan 02 Task 4): ONE event source for the
 * playback position that Plan 03's canvases subscribe to — the player never
 * re-renders canvases directly (plan Task 4 contract).
 *
 * EventTarget-style semantics, deliberately tiny:
 * - `publish(sample)` notifies only the listeners subscribed AT publish
 *   time, in subscription order, synchronously. LATE subscribers receive
 *   nothing retroactively (no replay/last-value cache — canvases paint from
 *   their own frame loop); pinned by a unit test.
 * - `subscribe(fn)` returns its own unsubscribe; unsubscribes are
 *   idempotent and safe to call twice.
 * - A non-finite `sample` is a documented no-op guard (the transport
 *   clamps, but a broken caller must not reach the canvases).
 * - `dispose()` detaches EVERY listener; publish/subscribe after dispose
 *   are documented no-ops.
 *
 * The app singleton `appPlayhead` lives for the page lifetime and is never
 * disposed by application code (dispose exists for tests and future hard
 * resets); `usePlayer` publishes to it, `player.tsx` throttles from it, and
 * Plan 03 subscribes to it. Samples are source-sample indexes at the
 * session source's rate (floats while playing — the canvases floor them).
 */

export type PlayheadListener = (sample: number) => void;

export type Playhead = {
  subscribe(listener: PlayheadListener): () => void;
  publish(sample: number): void;
  dispose(): void;
};

export function createPlayhead(): Playhead {
  const listeners = new Set<PlayheadListener>();
  let disposed = false;
  return {
    subscribe(listener) {
      if (!listeners.has(listener) && !disposed) {
        listeners.add(listener);
      }
      return () => {
        listeners.delete(listener);
      };
    },
    publish(sample) {
      if (!Number.isFinite(sample) || disposed) {
        return; // documented guard + documented post-dispose no-op
      }
      for (const listener of listeners) {
        listener(sample);
      }
    },
    dispose() {
      disposed = true; // permanent: publish/subscribe stay inert afterwards
      listeners.clear();
    },
  };
}

/** The app-wide playhead (page lifetime; Plan 03 subscribes, usePlayer
 * publishes). One instance exists even under node test imports — it holds
 * nothing but the listener set. */
export const appPlayhead: Playhead = createPlayhead();
