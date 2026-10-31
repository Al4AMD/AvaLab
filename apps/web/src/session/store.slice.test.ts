import { describe, expect, it } from "vitest";

import { createDspRpc } from "./rpc";
import { createSessionStore } from "./store";
import { makeFakeTransport, requestAt } from "./testDoubles";

describe("deriveWithSourceSlice", () => {
  it("posts only the requested sample slice and keys it with the range params", async () => {
    const transport = makeFakeTransport("echo");
    const store = createSessionStore(createDspRpc(transport));
    const samples = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(store.getState().loadSource(samples, 48_000, "a.wav", "demoClip")).toEqual({ ok: true });

    const ticket = store
      .getState()
      .deriveWithSourceSlice(
        "waveformRange",
        { bucketCount: 4, sampleRateHz: 48_000, startSample: 2, endSample: 6 },
        2,
        6,
      );
    expect(ticket.key).toContain(`waveformRange\u0000`);
    expect(ticket.key).toContain(`"startSample":2`);
    const sent = requestAt(transport, 0);
    expect(sent.payload?.byteLength).toBe(16); // four samples, not the whole source
    const received = transport.receivedFrames[0]?.payloadBytes;
    expect(received === undefined ? undefined : [...received]).toEqual([
      ...new Uint8Array(new Float32Array([2, 3, 4, 5]).buffer),
    ]);
    await expect(ticket.outcome).resolves.toBeDefined();
  });
});
