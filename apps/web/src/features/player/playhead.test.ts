/**
 * Playhead pub-sub unit tests (F02, Plan 02 Task 4): the subscribe /
 * publish / dispose contract and its documented semantics — synchronous
 * fan-out in subscription order, NO replay for late subscribers
 * (EventTarget-style, pinned), non-finite publish guard, dispose nukes
 * everything. The app singleton's shape is pinned too (Plan 03 imports it).
 */
import { describe, expect, it } from "vitest";

import { appPlayhead, createPlayhead, type PlayheadListener } from "./playhead";

describe("playhead: subscribe/publish contract", () => {
  it("fans each publish out to every current listener in subscription order", () => {
    const playhead = createPlayhead();
    const seenA: number[] = [];
    const seenB: number[] = [];
    const listenerA: PlayheadListener = (sample) => {
      seenA.push(sample);
    };
    const listenerB: PlayheadListener = (sample) => {
      seenB.push(sample);
    };
    playhead.subscribe(listenerA);
    playhead.subscribe(listenerB);
    playhead.publish(100);
    playhead.publish(101);
    expect(seenA).toEqual([100, 101]);
    expect(seenB).toEqual([100, 101]);
    playhead.publish(Number.NaN);
    expect(seenB).toEqual([100, 101]); // the guard: nothing reached anyone
  });

  it("unsubscribes idempotently and stops only that listener", () => {
    const playhead = createPlayhead();
    const seenA: number[] = [];
    const seenB: number[] = [];
    const listenerA: PlayheadListener = (sample) => {
      seenA.push(sample);
    };
    const listenerB: PlayheadListener = (sample) => {
      seenB.push(sample);
    };
    const unsubscribeA = playhead.subscribe(listenerA);
    playhead.subscribe(listenerB);
    unsubscribeA();
    unsubscribeA(); // idempotent, no crash
    playhead.publish(42);
    expect(seenA).toEqual([]);
    expect(seenB).toEqual([42]);
  });

  it("late subscribers receive nothing retroactively (documented + pinned)", () => {
    const playhead = createPlayhead();
    playhead.publish(7); // nobody is listening yet
    const seen: number[] = [];
    const listener: PlayheadListener = (sample) => {
      seen.push(sample);
    };
    playhead.subscribe(listener);
    expect(seen).toEqual([]); // no replay: only future publishes arrive
    playhead.publish(8);
    expect(seen).toEqual([8]);
  });

  it("publishing with zero listeners is a harmless no-op", () => {
    const playhead = createPlayhead();
    expect(() => {
      playhead.publish(1);
      playhead.publish(Number.POSITIVE_INFINITY);
    }).not.toThrow();
  });

  it("dispose detaches every listener; publish/subscribe after it are no-ops", () => {
    const playhead = createPlayhead();
    const seen: number[] = [];
    const unsubscribe = playhead.subscribe((sample) => {
      seen.push(sample);
    });
    playhead.dispose();
    playhead.publish(5);
    expect(seen).toEqual([]); // the disposed playhead is inert
    const postDisposeUnsubscribe = playhead.subscribe((sample) => {
      seen.push(sample);
    });
    playhead.publish(6);
    expect(seen).toEqual([]); // a post-dispose subscription stays silent
    postDisposeUnsubscribe();
    unsubscribe(); // the stale unsubscribe stays a safe no-op
  });

  it("the app singleton exists with the same contract shape (page lifetime)", () => {
    expect(typeof appPlayhead.subscribe).toBe("function");
    expect(typeof appPlayhead.publish).toBe("function");
    expect(typeof appPlayhead.dispose).toBe("function");
    // One extra subscriber/unsubscribe round trip on the real singleton —
    // it stays untouched otherwise (never disposed by app code).
    const seen: number[] = [];
    const unsubscribe = appPlayhead.subscribe(seen.push.bind(seen));
    appPlayhead.publish(-1); // non-finite below? -1 is finite: delivered
    expect(seen).toEqual([-1]);
    unsubscribe();
  });
});
