import { describe, expect, it } from "vitest";
import { buildShareUrl } from "./share";
import { decodeParams } from "./url-state";

describe("buildShareUrl", () => {
  it("round-trips tool params and the demo id with stable ordering", () => {
    const url = buildShareUrl({
      path: "/tools/filters",
      params: { c: 4_000, k: "fir", bd: "lowpass" },
      demoId: "chirp",
    });

    expect(url).toBe("/tools/filters?bd=lowpass&c=4000&demo=chirp&k=fir");
    expect(decodeParams(url.slice(url.indexOf("?")))).toEqual({
      bd: "lowpass",
      c: "4000",
      demo: "chirp",
      k: "fir",
    });
  });

  it("omits the query entirely when there are no params and no demo", () => {
    expect(buildShareUrl({ path: "/tools/waveform", params: {} })).toBe("/tools/waveform");
  });

  it("lets the demo id win over a stale demo parameter", () => {
    const url = buildShareUrl({
      path: "/tools/waveform",
      params: { demo: "music" },
      demoId: "speech",
    });
    expect(url).toBe("/tools/waveform?demo=speech");
  });

  it("rejects audio buffers instead of serializing upload bytes", () => {
    expect(() =>
      buildShareUrl({
        path: "/tools/waveform",
        params: { samples: new Float32Array(8) as unknown as string },
      }),
    ).toThrow(TypeError);
  });
});
