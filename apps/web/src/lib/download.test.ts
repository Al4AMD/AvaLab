import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadCanvasPng, downloadWav, sanitizeFilename } from "./download";

type FakeAnchor = {
  href: string;
  download: string;
  rel: string;
  click: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

let anchor: FakeAnchor | null = null;
let blob: Blob | null = null;

beforeEach(() => {
  anchor = null;
  blob = null;
  vi.stubGlobal("document", {
    createElement: () => {
      anchor = {
        href: "",
        download: "",
        rel: "",
        click: vi.fn(),
        remove: vi.fn(),
      };
      return anchor;
    },
    body: { append: vi.fn() },
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation((value: Blob | MediaSource) => {
    blob = value instanceof Blob ? value : null;
    return "blob:avalab-test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakeCanvas(width: number, height: number, png: Blob | null) {
  return {
    width,
    height,
    toBlob: (callback: (value: Blob | null) => void) => {
      callback(png);
    },
  } as unknown as HTMLCanvasElement;
}

describe("sanitizeFilename", () => {
  it("strips paths and non-ASCII characters while keeping a safe extension", () => {
    expect(sanitizeFilename("../Filters/My Filter Output.WAV")).toBe("my-filter-output.wav");
    expect(sanitizeFilename("گزارش ۱.wav")).toBe("avalab.wav");
    expect(sanitizeFilename("")).toBe("avalab");
  });
});

describe("downloadWav", () => {
  it("encodes a canonical mono 16-bit WAV and triggers an ASCII filename", async () => {
    const samples = new Float32Array([0, 0.5, -0.5]);
    downloadWav(samples, 44_100, "../My Filter Output.WAV");

    expect(anchor?.download).toBe("my-filter-output.wav");
    expect(anchor?.click).toHaveBeenCalledTimes(1);
    expect(blob).not.toBeNull();
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(bytes.length).toBe(44 + samples.length * 2);
  });
});

describe("downloadCanvasPng", () => {
  it("downloads a non-empty PNG blob", async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    await downloadCanvasPng(fakeCanvas(120, 80, png), "Rate Distortion.PNG");

    expect(blob?.size).toBe(4);
    expect(blob?.type).toBe("image/png");
    expect(anchor?.download).toBe("rate-distortion.png");
    expect(anchor?.click).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty canvas without producing a download", async () => {
    const canvas = fakeCanvas(0, 80, null);
    await expect(downloadCanvasPng(canvas, "empty.png")).rejects.toThrow("empty canvas");
    expect(anchor).toBeNull();
  });

  it("rejects when the canvas cannot produce a PNG blob", async () => {
    await expect(downloadCanvasPng(fakeCanvas(10, 10, null), "empty.png")).rejects.toThrow(
      "empty canvas",
    );
  });
});

describe("downloadWav stereo", () => {
  it("downloads an interleaved 2-channel WAV", async () => {
    const left = new Float32Array([0, -1]);
    const right = new Float32Array([0.5, 1]);
    downloadWav([left, right], 48_000, "stereo.wav");

    expect(anchor?.download).toBe("stereo.wav");
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint32(40, true)).toBe(8);
    expect(bytes.length).toBe(52);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16_384);
    expect(view.getInt16(48, true)).toBe(-32_768);
    expect(view.getInt16(50, true)).toBe(32_767);
  });
});
