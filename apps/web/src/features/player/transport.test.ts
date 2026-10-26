/**
 * Transport state-machine unit tests (F02, Plan 02 Task 4) — the same
 * conventions as the input-lane tests: recording fakes over EVERY seam
 * (context/buffer/node/time source/onEnded), no real Web Audio in node,
 * and every documented edge semantics from the transport module header
 * pinned here (pause position, restart rules, single live node, guards).
 */
import { describe, expect, it } from "vitest";

import {
  type AudioBufferLike,
  createTransport,
  type Transport,
  type TransportBuffer,
  type TransportContext,
  type TransportNode,
  type TransportOptions,
  type TransportState,
} from "./transport";

const RATE = 44_100;
const LENGTH = 88_200; // 2 s of 44.1 kHz mono

/** Recording node fake: every transport call lands in the record fields. */
type FakeNode = TransportNode & {
  readonly id: number;
  startedWith: Array<{ when: number | undefined; offset: number | undefined }>;
  stoppedCount: number;
  disconnectedCount: number;
};

/** Recording context fake: counts factory/resume/close events, time frozen
 * outside the injected time source (the transport never reads currentTime
 * directly — the seam promise that node tests keep the interpolation
 * deterministic). */
type RecordingHarness = {
  readonly clock: { seconds: number };
  readonly nodes: FakeNode[];
  readonly buffers: Array<{
    readonly source: AudioBufferLike;
    readonly sampleRateHz: number;
    readonly context: TransportContext;
    readonly buffer: TransportBuffer;
  }>;
  readonly counts: { contexts: number; resumed: number; closed: number };
  readonly onEndedSamples: number[];
  transport: Transport;
};

function makeBufferLike(length: number = LENGTH, sampleRate: number = RATE): AudioBufferLike {
  const data = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    data[index] = Math.sin(index * 0.01);
  }
  return {
    numberOfChannels: 1,
    sampleRate,
    getChannelData(channel: number): Float32Array {
      if (channel !== 0) {
        throw new RangeError(`makeBufferLike: no channel ${String(channel)}`);
      }
      return data;
    },
  };
}

function createHarness(harnessOptions?: Partial<TransportOptions>): RecordingHarness {
  const clock = { seconds: 0 };
  const nodes: FakeNode[] = [];
  const buffers: RecordingHarness["buffers"] = [];
  const counts = { contexts: 0, resumed: 0, closed: 0 };
  const onEndedSamples: number[] = [];

  const harness: Partial<RecordingHarness> = {
    clock,
    nodes,
    buffers,
    counts,
    onEndedSamples,
  };

  const contextFactory: NonNullable<TransportOptions["contextFactory"]> = () => {
    counts.contexts += 1;
    const context: TransportContext = {
      currentTime: 0, // stale constant: the transport must use the seam
      destination: {},
      createBuffer(numberOfChannels, length, sampleRate): TransportBuffer {
        const data = new Float32Array(Math.max(0, length));
        return {
          numberOfChannels,
          sampleRate,
          getChannelData(channel: number): Float32Array {
            if (channel !== 0) {
              throw new RangeError(`context.createBuffer fake: no channel ${String(channel)}`);
            }
            return data;
          },
        };
      },
      resume: () => {
        counts.resumed += 1;
      },
      close: () => {
        counts.closed += 1;
      },
    };
    return context;
  };

  const bufferFactory: NonNullable<TransportOptions["bufferFactory"]> = (
    source,
    sampleRateHz,
    context,
  ) => {
    // Mirror the browser default: fresh buffer, channel data COPIED from
    // the source (the fake's copy target is a zero buffer).
    const buffer = context.createBuffer(
      source.numberOfChannels,
      source.getChannelData(0).length,
      sampleRateHz,
    );
    buffer.getChannelData(0).set(source.getChannelData(0));
    buffers.push({ source, sampleRateHz, context, buffer });
    return buffer;
  };

  const nodeFactory: TransportOptions["nodeFactory"] = (context) => {
    const node: FakeNode = {
      id: nodes.length,
      buffer: null,
      startedWith: [],
      stoppedCount: 0,
      disconnectedCount: 0,
      onended: null,
      start(when, offset) {
        void context;
        node.startedWith.push({ when, offset });
      },
      stop() {
        node.stoppedCount += 1;
      },
      disconnect() {
        node.disconnectedCount += 1;
      },
    };
    nodes.push(node);
    return node;
  };

  const timeSource: TransportOptions["timeSource"] = () => clock.seconds;

  harness.transport = createTransport({
    contextFactory,
    bufferFactory,
    nodeFactory,
    timeSource,
    onEnded: (sample) => {
      onEndedSamples.push(sample);
    },
    ...harnessOptions,
  });
  return harness as RecordingHarness;
}

/** The single node the harness expects by construction (fail loudly). */
function onlyNode(harness: RecordingHarness): FakeNode {
  const node = harness.nodes[0];
  if (node === undefined) {
    throw new RangeError("test: expected exactly one node");
  }
  return node;
}

function nodeAt(harness: RecordingHarness, index: number): FakeNode {
  const node = harness.nodes[index];
  if (node === undefined) {
    throw new RangeError(`test: no node at ${String(index)}`);
  }
  return node;
}

function setTwoSecondSource(harness: RecordingHarness): void {
  harness.transport.setSource(makeBufferLike(), RATE);
}

describe("transport: initial channels + seam defaults", () => {
  it("starts empty: no source, no clock, playbackRate published and pinned to 1", () => {
    const harness = createHarness();
    expect(harness.transport.getState()).toEqual({ phase: "empty" });
    expect(harness.transport.lengthSamples).toBe(0);
    expect(harness.transport.sampleRateHz).toBe(0);
    expect(harness.transport.getCurrentSample()).toBe(0);
    expect(harness.transport.playbackRate).toBe(1); // F06 seam (documented)
    expect(harness.counts.contexts).toBe(0); // lazily created on setSource
  });

  it("setSource enters ready at position 0, builds the playable copy, stores the rate", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
    expect(harness.transport.lengthSamples).toBe(LENGTH);
    expect(harness.transport.sampleRateHz).toBe(RATE);
    expect(harness.counts.contexts).toBe(1);
    expect(harness.buffers).toHaveLength(1);
    expect(harness.buffers[0]?.sampleRateHz).toBe(RATE);
    expect(harness.nodes).toHaveLength(0); // no node before play()
  });

  it("dispose() returns to empty, tears the node down, and re-arms", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play();
    const node = onlyNode(harness);
    const seen: TransportState[] = [];
    harness.transport.subscribe((state) => {
      seen.push(state);
    });
    harness.transport.dispose();
    expect(harness.transport.getState()).toEqual({ phase: "empty" });
    expect(harness.transport.lengthSamples).toBe(0);
    expect(node.stoppedCount).toBe(1);
    expect(node.disconnectedCount).toBe(1);
    expect(harness.counts.closed).toBe(1);
    // The final (empty) state reached the last live subscriber, then the
    // listeners detached.
    expect(seen.at(-1)).toEqual({ phase: "empty" });
    // Re-arm: the same machine takes a fresh source through the factory.
    setTwoSecondSource(harness);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
    expect(harness.counts.contexts).toBe(2);
    expect(harness.counts.closed).toBe(1); // only the disposed context closed
  });
});

describe("transport: play/pause position semantics (documented + pinned)", () => {
  it("play() enters playing at the pinned/param offset and wires the engine hook", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play(44_100);
    const node = onlyNode(harness);
    expect(harness.transport.getState()).toEqual({ phase: "playing", startedAtSample: 44_100 });
    expect(node.startedWith).toEqual([{ when: 0, offset: 1 }]);
    expect(node.onended).toBeTypeOf("function");
    expect(harness.counts.resumed).toBe(1); // suspended-context activation
  });

  it("play() without a parameter resumes the pinned ready position", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.seekToSample(22_050);
    harness.transport.play();
    expect(harness.transport.getState()).toEqual({ phase: "playing", startedAtSample: 22_050 });
  });

  it("play() while playing is a documented no-op (no second node)", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play();
    harness.transport.play(10_000);
    expect(harness.nodes).toHaveLength(1);
    expect(harness.transport.getState()).toEqual({ phase: "playing", startedAtSample: 0 });
  });

  it("play() from/past the end restarts from 0 (pinned restart rule)", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play(LENGTH); // render limit: restart
    expect(harness.transport.getState()).toEqual({ phase: "playing", startedAtSample: 0 });

    // Natural stop pins position = length; the next play() resumes AT the
    // end → the same restart rule re-runs it from the top.
    setTwoSecondSource(harness);
    harness.transport.play();
    nodeAt(harness, 1).onended?.();
    expect(harness.transport.getState()).toEqual({ phase: "stopped", positionSample: LENGTH });
    harness.transport.play();
    expect(nodeAt(harness, 2).startedWith[0]).toEqual({ when: 0, offset: 0 });
  });

  it("play() is a no-op while empty", () => {
    const harness = createHarness();
    harness.transport.play();
    expect(harness.nodes).toHaveLength(0);
    expect(harness.transport.getState()).toEqual({ phase: "empty" });
  });

  it("a zero-length source enters ready but can never start (no node, no buffer)", () => {
    const harness = createHarness();
    harness.transport.setSource(makeBufferLike(0), RATE); // empty channel data
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
    expect(harness.transport.lengthSamples).toBe(0);
    harness.transport.play();
    expect(harness.nodes).toHaveLength(0); // 0-length AudioBuffer is illegal
    expect(harness.buffers).toHaveLength(0); // nothing was built either
  });

  it("pause() pins the interpolated position to ready — NOT a reset to 0", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play(44_100);
    harness.clock.seconds = 0.5; // half a second of playback elapsed
    harness.transport.pause();
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 66_150 });
    // The head stays put after the pause (no engine time bleeding in).
    harness.clock.seconds = 2;
    expect(harness.transport.getCurrentSample()).toBe(66_150);
    // Resuming continues from the pinned spot.
    harness.transport.play();
    expect(nodeAt(harness, 1).startedWith[0]).toEqual({ when: 0, offset: 1.5 });
  });

  it("pause() is a no-op outside playing (and never resurrects a node)", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.pause();
    expect(harness.nodes).toHaveLength(0);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
    setTwoSecondSource(harness);
    harness.transport.play();
    harness.transport.pause();
    harness.transport.pause(); // second pause after ready: documented no-op
    const node = onlyNode(harness);
    expect(node.stoppedCount).toBe(1);
    expect(node.disconnectedCount).toBe(1);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
  });

  it("a stale engine event after pause() is inert (detached hook, silent seam)", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play();
    const node = onlyNode(harness);
    const staleHook = node.onended;
    harness.clock.seconds = 0.25;
    harness.transport.pause();
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 11_025 });
    expect(staleHook).toBeTypeOf("function");
    staleHook?.(); // the recorded engine event of the torn-down node
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 11_025 });
    expect(harness.nodes).toHaveLength(1);
    expect(harness.onEndedSamples).toEqual([]); // the boundary seam stays silent
  });
});

describe("transport: getCurrentSample interpolation (fake 44100 Hz + fake clock)", () => {
  it("interpolates exactly: +0.25 s and +0.5 s from a 1 s offset", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.clock.seconds = 100; // arbitrary context-clock offset
    harness.transport.play(44_100);
    expect(harness.transport.getCurrentSample()).toBe(44_100);
    harness.clock.seconds = 100.25;
    expect(harness.transport.getCurrentSample()).toBe(44_100 + 11_025);
    harness.clock.seconds = 100.5;
    expect(harness.transport.getCurrentSample()).toBe(66_150);
  });

  it("clamps the interpolated head at the source length", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play(44_100);
    harness.clock.seconds = 10; // far past the source end
    expect(harness.transport.getCurrentSample()).toBe(LENGTH);
  });
});

describe("transport: seeks", () => {
  it("seekToSample while ready clamps to [0, length] and pins", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.seekToSample(-5);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
    harness.transport.seekToSample(10 * RATE);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: LENGTH });
    harness.transport.seekToSample(1.5 * RATE);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 66_150 });
  });

  it("seekToSample of a non-finite sample is a documented no-op", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play();
    harness.transport.seekToSample(Number.NaN);
    harness.transport.seekToSample(Number.POSITIVE_INFINITY);
    expect(harness.nodes).toHaveLength(1);
    expect(harness.transport.getState()).toEqual({ phase: "playing", startedAtSample: 0 });
  });

  it("seekToSample while playing restarts ONE node at the new offset (§9 pin)", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play();
    harness.clock.seconds = 0.25;
    harness.transport.seekToSample(22_050); // +0.5 s from position 11 025
    const oldNode = nodeAt(harness, 0);
    const newNode = nodeAt(harness, 1);
    expect(oldNode.stoppedCount).toBe(1);
    expect(oldNode.disconnectedCount).toBe(1);
    expect(harness.transport.getState()).toEqual({ phase: "playing", startedAtSample: 22_050 });
    expect(newNode.startedWith).toEqual([{ when: 0, offset: 0.5 }]);
    expect(newNode.disconnectedCount).toBe(0); // exactly one live node
    // The old node's engine event is inert after the teardown.
    oldNode.onended?.();
    expect(harness.transport.getState()).toEqual({ phase: "playing", startedAtSample: 22_050 });
  });

  it("seekToSample while stopped lands in ready with the pinned position", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play();
    nodeAt(harness, 0).onended?.();
    expect(harness.transport.getState()).toEqual({ phase: "stopped", positionSample: LENGTH });
    harness.transport.seekToSample(RATE);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: RATE });
    expect(harness.nodes).toHaveLength(1); // no node until the next play()
  });

  it("seekToSample while empty is a no-op", () => {
    const harness = createHarness();
    harness.transport.seekToSample(1_000);
    expect(harness.transport.getState()).toEqual({ phase: "empty" });
  });

  it("seekBySeconds converts seconds → samples and clamps both ways from ready", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.seekToSample(1.5 * RATE);
    harness.transport.seekBySeconds(5); // overshoot → length
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: LENGTH });
    harness.transport.seekBySeconds(-10); // undershoot → 0
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
    harness.transport.seekBySeconds(1); // +44 100 samples
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: RATE });
  });

  it("seekBySeconds while playing takes the interpolated base (then restarts)", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play(44_100);
    harness.clock.seconds = 0.25; // head = 55 125
    harness.transport.seekBySeconds(0.5);
    expect(harness.transport.getState()).toEqual({ phase: "playing", startedAtSample: 77_175 });
  });

  it("seekBySeconds of a non-finite delta is a documented no-op", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.seekBySeconds(Number.NaN);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
  });
});

describe("transport: end-of-source + source replacement", () => {
  it("engine ended while playing → stopped at length + onEnded seam fires once with the boundary", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play(44_100);
    harness.clock.seconds = 0.25;
    nodeAt(harness, 0).onended?.();
    const node = nodeAt(harness, 0);
    expect(harness.transport.getState()).toEqual({ phase: "stopped", positionSample: LENGTH });
    expect(harness.onEndedSamples).toEqual([LENGTH]); // the publish boundary
    expect(node.onended).toBeNull();
    expect(node.disconnectedCount).toBe(1); // the ended node let go (§9)
    // The seam does not refire from a second engine event.
    node.onended?.();
    expect(harness.onEndedSamples).toEqual([LENGTH]);
  });

  it("setSource while playing stops + disconnects the OLD node first (single live node)", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play();
    const oldNode = onlyNode(harness);
    harness.transport.setSource(makeBufferLike(LENGTH / 2), RATE);
    expect(oldNode.stoppedCount).toBe(1);
    expect(oldNode.disconnectedCount).toBe(1);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
    expect(harness.transport.lengthSamples).toBe(LENGTH / 2);
    expect(harness.buffers).toHaveLength(2);
    // The old node's stale engine event cannot resurrect playback.
    oldNode.onended?.();
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
    // The stale end seam fired NOTHING for the discarded source.
    expect(harness.onEndedSamples).toEqual([]);
  });

  it("playbackRate stays pinned to 1 across the whole state surface", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play();
    expect(harness.transport.playbackRate).toBe(1);
    harness.transport.pause();
    expect(harness.transport.playbackRate).toBe(1);
    harness.transport.play();
    nodeAt(harness, 1).onended?.();
    expect(harness.transport.playbackRate).toBe(1);
    harness.transport.setSource(makeBufferLike(10), RATE);
    expect(harness.transport.playbackRate).toBe(1);
  });
});

describe("transport: typed guards + subscribe", () => {
  it("setSource throws TypeError on a malformed source or rate, state intact", () => {
    const harness = createHarness();
    setTwoSecondSource(harness);
    harness.transport.play();
    const before = harness.transport.getState();
    expect(() => {
      harness.transport.setSource({} as AudioBufferLike, RATE); // no channels
    }).toThrow(TypeError);
    expect(() => {
      harness.transport.setSource(
        { numberOfChannels: 0, sampleRate: RATE, getChannelData: () => new Float32Array(0) },
        RATE,
      );
    }).toThrow(TypeError);
    expect(() => {
      harness.transport.setSource(makeBufferLike(), Number.NaN);
    }).toThrow(TypeError);
    expect(() => {
      harness.transport.setSource(makeBufferLike(), 0);
    }).toThrow(TypeError);
    // Nothing was torn down by the failed swaps: the live node plays on.
    expect(onlyNode(harness).stoppedCount).toBe(0);
    expect(harness.transport.getState()).toEqual(before);
    expect(harness.counts.contexts).toBe(1); // the guard throws pre-factory
  });

  it("a buffer-factory throw surfaces and leaves the live playback untouched (build-first swap)", () => {
    let factoryCalls = 0;
    const harness = createHarness({
      bufferFactory: (source, sampleRateHz, context) => {
        factoryCalls += 1;
        if (factoryCalls === 2) {
          throw new Error("factory exploded");
        }
        const buffer = context.createBuffer(
          source.numberOfChannels,
          source.getChannelData(0).length,
          sampleRateHz,
        );
        buffer.getChannelData(0).set(source.getChannelData(0));
        return buffer;
      },
    });
    setTwoSecondSource(harness);
    harness.transport.play();
    expect(() => {
      harness.transport.setSource(makeBufferLike(10_000), RATE);
    }).toThrow("factory exploded");
    // No half-swap: the playing node and state survived the failed swap.
    const node = onlyNode(harness);
    expect(node.stoppedCount).toBe(0);
    expect(node.disconnectedCount).toBe(0);
    expect(harness.transport.getState()).toEqual({ phase: "playing", startedAtSample: 0 });
    harness.clock.seconds = 0.25;
    expect(harness.transport.getCurrentSample()).toBe(11_025);
    // …and the machine keeps working afterwards.
    harness.transport.setSource(makeBufferLike(10_000), RATE);
    expect(harness.transport.getState()).toEqual({ phase: "ready", positionSample: 0 });
    expect(harness.transport.lengthSamples).toBe(10_000);
    expect(node.stoppedCount).toBe(1);
  });

  it("subscribers hear every state change; unsubscribe stops delivery", () => {
    const harness = createHarness();
    const seen: TransportState[] = [];
    const unsubscribe = harness.transport.subscribe((state) => {
      seen.push(state);
    });
    setTwoSecondSource(harness);
    harness.transport.play();
    expect(seen).toEqual([
      { phase: "ready", positionSample: 0 },
      { phase: "playing", startedAtSample: 0 },
    ]);
    unsubscribe();
    harness.transport.pause();
    expect(seen).toHaveLength(2); // no further delivery
  });
});
