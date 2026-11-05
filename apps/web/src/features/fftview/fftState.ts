/**
 * URL codec for the Fourier view (F08/F16): the shareable part of the tool is
 * its analysis settings, never the audio. Decoding is total — a malformed or
 * unknown value falls back to the default for that field, so a stale link
 * opens a working view instead of an error.
 */
import { decodeParams, encodeParams } from "../../lib/url-state";
import type { FftSelectionParams } from "../../session/ops";

export type FftViewSettings = {
  readonly windowFamily: FftSelectionParams["windowFamily"];
  readonly windowLengthSamples: number;
  readonly magnitudeMode: FftSelectionParams["magnitudeMode"];
  readonly phaseMode: FftSelectionParams["phaseMode"];
  readonly phaseMaskDb: number;
};

export const FFT_WINDOW_LENGTHS = [256, 512, 1024, 2048, 4096, 8192] as const;
export const FFT_WINDOW_FAMILIES = ["rect", "hann", "hamming", "blackman", "kaiser"] as const;
export const FFT_PHASE_MASK_MIN_DB = -120;
export const FFT_PHASE_MASK_MAX_DB = 0;
/** Null out phase bins whose magnitude is below the display threshold.
 * `magnitude` is already in dB when `magnitudeMode` is "db"; converting it a
 * second time is the bug this helper exists to prevent. A zero linear
 * magnitude has no finite dB value and is always masked. */
export function phaseMaskBins(
  magnitude: Float64Array,
  phase: Float64Array,
  magnitudeMode: FftViewSettings["magnitudeMode"],
  thresholdDb: number,
): (number | null)[] {
  const masked: (number | null)[] = [];
  for (let bin = 0; bin < magnitude.length; bin += 1) {
    const value = magnitude[bin] ?? 0;
    const db =
      magnitudeMode === "db"
        ? value
        : value > 0
          ? 20 * Math.log10(value)
          : Number.NEGATIVE_INFINITY;
    masked.push(Number.isFinite(db) && db >= thresholdDb ? (phase[bin] ?? 0) : null);
  }
  return masked;
}

export const FFT_DEFAULT_SETTINGS: FftViewSettings = {
  windowFamily: "hann",
  windowLengthSamples: 2048,
  magnitudeMode: "db",
  phaseMode: "wrapped",
  phaseMaskDb: -60,
};

function isWindowFamily(value: string): value is FftSelectionParams["windowFamily"] {
  return (FFT_WINDOW_FAMILIES as readonly string[]).includes(value);
}

function isWindowLength(value: number): boolean {
  return (FFT_WINDOW_LENGTHS as readonly number[]).includes(value);
}

export function fftSettingsToSearch(settings: FftViewSettings): string {
  return encodeParams({
    m: settings.magnitudeMode,
    mask: settings.phaseMaskDb,
    n: settings.windowLengthSamples,
    p: settings.phaseMode,
    w: settings.windowFamily,
  });
}

export function fftSettingsFromSearch(search: string): FftViewSettings {
  const decoded = decodeParams(search);
  const scalar = (key: string): string | undefined => {
    const value = decoded[key];
    return typeof value === "string" ? value : undefined;
  };
  const family = scalar("w");
  const length = Number(scalar("n"));
  const magnitude = scalar("m");
  const phase = scalar("p");
  const mask = Number(scalar("mask"));
  return {
    windowFamily:
      family !== undefined && isWindowFamily(family) ? family : FFT_DEFAULT_SETTINGS.windowFamily,
    windowLengthSamples: isWindowLength(length) ? length : FFT_DEFAULT_SETTINGS.windowLengthSamples,
    magnitudeMode: magnitude === "linear" ? "linear" : "db",
    phaseMode: phase === "unwrapped" ? "unwrapped" : "wrapped",
    phaseMaskDb:
      Number.isFinite(mask) && mask >= FFT_PHASE_MASK_MIN_DB && mask <= FFT_PHASE_MASK_MAX_DB
        ? mask
        : FFT_DEFAULT_SETTINGS.phaseMaskDb,
  };
}
