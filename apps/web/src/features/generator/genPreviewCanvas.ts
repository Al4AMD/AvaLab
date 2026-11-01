/**
 * Generator preview paint (F12): the same min/max envelope painter as the
 * waveform view, fed with the bucketed preview from the worker op. Nothing
 * is synthesized on the main thread — this file only draws.
 */
import { paintWaveform } from "../waveform/paintWaveform";

function cssColor(element: HTMLElement, variable: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(variable).trim();
  return value === "" ? fallback : value;
}

export function paintGeneratorPreview(
  canvas: HTMLCanvasElement,
  minMax: Float32Array,
  widthPx: number,
  heightPx: number,
): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    return;
  }
  paintWaveform(ctx, minMax, {
    widthPx,
    heightPx,
    dpr: window.devicePixelRatio || 1,
    background: cssColor(canvas, "--color-bg", "#0b1016"),
    wave: cssColor(canvas, "--color-accent", "#59d8e6"),
    center: cssColor(canvas, "--color-surface", "#25303a"),
    playhead: cssColor(canvas, "--color-text", "#f1eee4"),
    selection: "rgba(89, 216, 230, 0.18)",
  });
}
