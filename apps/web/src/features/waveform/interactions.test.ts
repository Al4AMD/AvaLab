import { describe, expect, it } from "vitest";

import {
  clampWindow,
  panWindow,
  windowFromSearch,
  windowToSearch,
  zoomWindow,
} from "./interactions";

describe("waveform window math", () => {
  it("clamps a window to the source extent and keeps at least one sample", () => {
    expect(clampWindow({ startSample: -10, endSample: 200 }, 100)).toEqual({
      startSample: 0,
      endSample: 100,
    });
    expect(clampWindow({ startSample: 90, endSample: 90 }, 100)).toEqual({
      startSample: 90,
      endSample: 91,
    });
    expect(clampWindow({ startSample: 500, endSample: 600 }, 100)).toEqual({
      startSample: 99,
      endSample: 100,
    });
  });

  it("zooms around an anchor and stays inside the source", () => {
    expect(zoomWindow({ startSample: 0, endSample: 1000 }, 1000, 0.5, 500)).toEqual({
      startSample: 250,
      endSample: 750,
    });
    const edge = zoomWindow({ startSample: 0, endSample: 1000 }, 1000, 0.5, 0);
    expect(edge).toEqual({ startSample: 0, endSample: 500 });
    const floor = zoomWindow({ startSample: 0, endSample: 2 }, 1000, 0.5, 1);
    expect(floor).toEqual({ startSample: 0, endSample: 1 });
  });

  it("pans by a fraction of the visible span without changing its length", () => {
    expect(panWindow({ startSample: 200, endSample: 400 }, 1000, 1)).toEqual({
      startSample: 400,
      endSample: 600,
    });
    expect(panWindow({ startSample: 200, endSample: 400 }, 1000, -5)).toEqual({
      startSample: 0,
      endSample: 200,
    });
  });
});

describe("waveform URL codec", () => {
  it("round-trips integer sample bounds", () => {
    const search = windowToSearch({ startSample: 120, endSample: 480 });
    expect(search).toBe("t=120..480");
    expect(windowFromSearch(`?${search}`, 1000)).toEqual({
      startSample: 120,
      endSample: 480,
    });
  });

  it("falls back to the whole source on malformed or out-of-range values", () => {
    expect(windowFromSearch("", 1000)).toEqual({ startSample: 0, endSample: 1000 });
    expect(windowFromSearch("?t=nope", 1000)).toEqual({ startSample: 0, endSample: 1000 });
    expect(windowFromSearch("?t=900..5000", 1000)).toEqual({
      startSample: 900,
      endSample: 1000,
    });
  });
});
