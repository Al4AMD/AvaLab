/**
 * User-triggered downloads (F16): canonical WAV for processed audio and PNG
 * snapshots of analytical charts. No background downloads; every call runs
 * from an explicit button click. Filenames are reduced to ASCII so the
 * browser never receives locale-dependent names, and paths never leak into
 * the `download` attribute.
 */
import { type AudioChannels, encodeWavPcm16 } from "@avalab/dsp";
import type uPlot from "uplot";

/** Lowercase ASCII slug: path stripped, non-ASCII runs replaced, extension kept. */
export function sanitizeFilename(filename: string, fallback = "avalab"): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < base.length - 1;
  const rawStem = hasExtension ? base.slice(0, dot) : base;
  const extension = hasExtension
    ? base
        .slice(dot + 1)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
    : "";
  const stem = rawStem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safeStem = stem === "" ? fallback : stem;
  return extension === "" ? safeStem : `${safeStem}.${extension}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** Encode and download 16-bit PCM WAV (mono or 1–2 playback channels). */
export function downloadWav(
  source: Float32Array | AudioChannels,
  sampleRateHz: number,
  filename: string,
): void {
  const bytes = encodeWavPcm16(source, { sampleRateHz });
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  triggerDownload(new Blob([buffer], { type: "audio/wav" }), sanitizeFilename(filename));
}

/** Snapshot a canvas as PNG; rejects instead of downloading an empty image. */
export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return Promise.reject(new Error("downloadCanvasPng: empty canvas"));
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((png) => {
      if (png === null) {
        reject(new Error("downloadCanvasPng: empty canvas"));
        return;
      }
      triggerDownload(png, sanitizeFilename(filename, "avalab-chart.png"));
      resolve();
    }, "image/png");
  });
}

/** Snapshot a uPlot chart through its backing canvas. */
export function downloadChartPng(plot: uPlot, filename: string): Promise<void> {
  return downloadCanvasPng(plot.ctx.canvas, filename);
}
