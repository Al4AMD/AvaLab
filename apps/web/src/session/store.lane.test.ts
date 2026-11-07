import { describe, expect, it } from "vitest";

import { createDspRpc } from "./rpc";
import { createSessionStore } from "./store";
import { cancelFramesOf, type FakeTransport, makeFakeTransport, requestsOf } from "./testDoubles";

const WAVEFORM_PARAMS = { bucketCount: 4, sampleRateHz: 48_000 } as const;
const RANGE_PARAMS = {
  bucketCount: 4,
  sampleRateHz: 48_000,
  startSample: 2,
  endSample: 5,
} as const;

type Harness = {
  readonly store: ReturnType<typeof createSessionStore>;
  readonly transport: FakeTransport;
};

function makeStore(mode: "echo" | "silent" = "echo"): Harness {
  const transport = makeFakeTransport(mode);
  return { store: createSessionStore(createDspRpc(transport)), transport };
}

function loadStereo(store: Harness["store"]): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
  const right = new Float32Array([-0.1, -0.2, -0.3, -0.4, -0.5, -0.6, -0.7, -0.8]);
  expect(store.getState().loadSource([left, right], 48_000, "stereo.wav", "demoClip")).toEqual({
    ok: true,
  });
  return { left, right };
}

function payloadValues(transport: FakeTransport, index: number): number[] {
  const bytes = transport.receivedFrames[index]?.payloadBytes;
  if (bytes === undefined) {
    throw new Error(`test: no payload at frame ${String(index)}`);
  }
  return [...new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)];
}

describe("deriveWithSourceLane", () => {
  it("posts the selected channel copy and includes the lane in the cache key", async () => {
    const { store, transport } = makeStore();
    const { right } = loadStereo(store);

    const ticket = store.getState().deriveWithSourceLane("waveformOverview", WAVEFORM_PARAMS, 1);
    expect(ticket.key.split("\u0000")).toHaveLength(4);
    expect(ticket.key.endsWith("\u0000lane:1")).toBe(true);
    expect(payloadValues(transport, 0)).toEqual([...right]);
    // The posted buffer is a copy; the session lane is still readable.
    expect([...(store.getState().original?.channels[1] ?? [])]).toEqual([...right]);

    await expect(ticket.outcome).resolves.toEqual({
      meta: { received: true },
      payload: expect.anything(),
    });
  });

  it("keys the two lanes apart and keeps both concurrent calls alive", async () => {
    const { store, transport } = makeStore("silent");
    loadStereo(store);

    const leftTicket = store
      .getState()
      .deriveWithSourceLane("waveformOverview", WAVEFORM_PARAMS, 0);
    const rightTicket = store
      .getState()
      .deriveWithSourceLane("waveformOverview", WAVEFORM_PARAMS, 1);
    expect(leftTicket.key).not.toBe(rightTicket.key);
    expect(leftTicket.key.endsWith("\u0000lane:0")).toBe(true);
    expect(rightTicket.key.endsWith("\u0000lane:1")).toBe(true);
    const [leftRequest, rightRequest] = requestsOf(transport);
    expect(leftRequest?.id).not.toBe(rightRequest?.id);
    expect(cancelFramesOf(transport)).toEqual([]);

    transport.deliver({
      id: leftRequest?.id,
      ok: true,
      result: { meta: { received: "left" } },
    });
    transport.deliver({
      id: rightRequest?.id,
      ok: true,
      result: { meta: { received: "right" } },
    });
    await expect(leftTicket.outcome).resolves.toEqual({ meta: { received: "left" } });
    await expect(rightTicket.outcome).resolves.toEqual({ meta: { received: "right" } });
  });

  it("serves a second lane derive from cache without another frame", async () => {
    const { store, transport } = makeStore();
    loadStereo(store);

    const first = store.getState().deriveWithSourceLane("waveformOverview", WAVEFORM_PARAMS, 1);
    const firstResult = await first.outcome;
    const second = store.getState().deriveWithSourceLane("waveformOverview", WAVEFORM_PARAMS, 1);
    expect(second.key).toBe(first.key);
    await expect(second.outcome).resolves.toBe(firstResult);
    expect(requestsOf(transport)).toHaveLength(1);
  });

  it("rejects noSource and noLane without sending a frame", async () => {
    const { store, transport } = makeStore();
    const noSource = store.getState().deriveWithSourceLane("waveformOverview", WAVEFORM_PARAMS, 0);
    await expect(noSource.outcome).rejects.toMatchObject({ code: "noSource" });

    expect(
      store.getState().loadSource(new Float32Array(8), 48_000, "mono.wav", "demoClip"),
    ).toEqual({ ok: true });
    const noLane = store.getState().deriveWithSourceLane("waveformOverview", WAVEFORM_PARAMS, 1);
    await expect(noLane.outcome).rejects.toMatchObject({ code: "noLane" });
    expect(requestsOf(transport)).toHaveLength(0);
  });
});

describe("deriveWithSourceSliceLane", () => {
  it("posts only the selected channel slice and clamps both ends", async () => {
    const { store, transport } = makeStore();
    const { right } = loadStereo(store);

    const ticket = store
      .getState()
      .deriveWithSourceSliceLane("waveformRange", RANGE_PARAMS, 2, 5, 1);
    expect(ticket.key).toContain("\u0000lane:1\u0000range:2:5");
    expect(payloadValues(transport, 0)).toEqual([...right.slice(2, 5)]);
    await ticket.outcome;

    const clamped = store
      .getState()
      .deriveWithSourceSliceLane(
        "waveformRange",
        { ...RANGE_PARAMS, startSample: -2, endSample: 100 },
        -2,
        100,
        1,
      );
    expect(payloadValues(transport, 1)).toEqual([...right]);
    await clamped.outcome;
  });

  it("keys different slice ranges apart even when params are identical", async () => {
    const { store, transport } = makeStore();
    const { right } = loadStereo(store);
    const params = {
      b: [0.5],
      a: [1],
      fir: true,
      sampleRateHz: 48_000,
      compensateDelay: true,
    };

    const first = store.getState().deriveWithSourceSliceLane("filterApply", params, 2, 5, 1);
    await first.outcome;
    const second = store.getState().deriveWithSourceSliceLane("filterApply", params, 4, 7, 1);
    await second.outcome;

    expect(second.key).not.toBe(first.key);
    expect(requestsOf(transport)).toHaveLength(2);
    expect(payloadValues(transport, 0)).toEqual([...right.slice(2, 5)]);
    expect(payloadValues(transport, 1)).toEqual([...right.slice(4, 7)]);
  });

  it("does not supersede a concurrent same-params right-lane slice", async () => {
    const { store, transport } = makeStore("silent");
    loadStereo(store);

    const leftTicket = store
      .getState()
      .deriveWithSourceSliceLane("waveformRange", RANGE_PARAMS, 2, 5, 0);
    const rightTicket = store
      .getState()
      .deriveWithSourceSliceLane("waveformRange", RANGE_PARAMS, 2, 5, 1);
    const [leftRequest, rightRequest] = requestsOf(transport);
    expect(cancelFramesOf(transport)).toEqual([]);
    transport.deliver({
      id: leftRequest?.id,
      ok: true,
      result: { meta: { received: "left" } },
    });
    transport.deliver({
      id: rightRequest?.id,
      ok: true,
      result: { meta: { received: "right" } },
    });
    await expect(leftTicket.outcome).resolves.toEqual({ meta: { received: "left" } });
    await expect(rightTicket.outcome).resolves.toEqual({ meta: { received: "right" } });
  });

  it("rejects a missing lane before any payload copy", async () => {
    const { store, transport } = makeStore();
    expect(
      store.getState().loadSource(new Float32Array(8), 48_000, "mono.wav", "demoClip"),
    ).toEqual({ ok: true });
    const ticket = store
      .getState()
      .deriveWithSourceSliceLane("waveformRange", RANGE_PARAMS, 2, 5, 1);
    await expect(ticket.outcome).rejects.toMatchObject({ code: "noLane" });
    expect(ticket.key).toBe("");
    expect(transport.sent).toHaveLength(0);
  });
});
