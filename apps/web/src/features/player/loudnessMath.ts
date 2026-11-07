import { loudnessGainDb } from "@avalab/dsp";

/** Playback gain that matches the processed lane to the original loudness. */
export function matchGainDb(originalLufs: number, processedLufs: number): number {
  return loudnessGainDb(originalLufs, processedLufs);
}

/** Display helper: one decimal with unit; silence and non-finite values are "—". */
export function formatLufs(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)} LUFS`;
}
