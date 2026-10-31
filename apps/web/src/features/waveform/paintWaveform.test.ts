import { describe, expect, it } from "vitest";

import { bucketToX, paintWaveform, waveformY } from "./paintWaveform";

type DrawCall = { kind: string; args: number[] };

function fakeContext(calls: DrawCall[]): CanvasRenderingContext2D {
  const record =
    (kind: string) =>
    (...args: number[]): void => {
      calls.push({ kind, args });
    };
  return {
    setTransform: record("setTransform"),
    fillRect: record("fillRect"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke: record("stroke"),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    canvas: { width: 0, height: 0 },
  } as unknown as CanvasRenderingContext2D;
}

describe("bucketToX", () => {
  it("maps every bucket inside the device-pixel wall, never past the edge", () => {
    expect(bucketToX(0, 4, 400, 1)).toBe(0);
    expect(bucketToX(1, 4, 400, 1)).toBe(100);
    expect(bucketToX(3, 4, 400, 1)).toBe(300);
    expect(bucketToX(3, 4, 400, 2)).toBe(600);
    expect(bucketToX(3, 4, 400, 2)).toBeLessThan(400 * 2);
  });

  it("returns 0 for an empty or degenerate bucket count", () => {
    expect(bucketToX(5, 0, 100, 1)).toBe(0);
    expect(bucketToX(5, 3, 0, 1)).toBe(0);
  });
});

describe("waveformY", () => {
  it("maps +1 to the top and -1 to the bottom with a fixed [-1, 1] scale", () => {
    expect(waveformY(1, 200)).toBe(0);
    expect(waveformY(-1, 200)).toBe(200);
    expect(waveformY(0, 200)).toBe(100);
  });
});

describe("paintWaveform", () => {
  it("sets the DPR-scaled backing store and paints finite coordinates", () => {
    const calls: DrawCall[] = [];
    const ctx = fakeContext(calls);

    paintWaveform(ctx, new Float32Array([-1, 1, -0.5, 0.5]), {
      widthPx: 100,
      heightPx: 40,
      dpr: 2,
      background: "#000",
      wave: "#0ff",
      center: "#333",
      playhead: "#fff",
      selection: "rgba(255,255,255,0.2)",
    });

    expect(ctx.canvas.width).toBe(200);
    expect(ctx.canvas.height).toBe(80);
    const coordinates = calls
      .filter(
        (call) => call.kind === "moveTo" || call.kind === "lineTo" || call.kind === "fillRect",
      )
      .flatMap((call) => call.args);
    expect(coordinates.length).toBeGreaterThan(0);
    for (const value of coordinates) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("never emits NaN when the bucket count exceeds the samples", () => {
    const calls: DrawCall[] = [];
    const ctx = fakeContext(calls);
    paintWaveform(ctx, new Float32Array(0), {
      widthPx: 50,
      heightPx: 10,
      dpr: 1,
      background: "#000",
      wave: "#0ff",
      center: "#333",
      playhead: "#fff",
      selection: "rgba(255,255,255,0.2)",
    });
    for (const call of calls) {
      for (const value of call.args) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("draws a playhead only when its sample lies inside the painted range", () => {
    const base = {
      widthPx: 100,
      heightPx: 20,
      dpr: 1,
      background: "#000",
      wave: "#0ff",
      center: "#333",
      playhead: "#fff",
      selection: "rgba(255,255,255,0.2)",
    } as const;
    const inside: DrawCall[] = [];
    paintWaveform(fakeContext(inside), new Float32Array([-1, 1]), {
      ...base,
      sampleRange: { startSample: 0, endSample: 100 },
      playheadSample: 50,
    });
    expect(inside.some((call) => call.kind === "stroke")).toBe(true);

    const outside: DrawCall[] = [];
    paintWaveform(fakeContext(outside), new Float32Array([-1, 1]), {
      ...base,
      sampleRange: { startSample: 0, endSample: 100 },
      playheadSample: 200,
    });
    expect(outside.filter((call) => call.kind === "stroke")).toHaveLength(1); // center line only
  });
});
