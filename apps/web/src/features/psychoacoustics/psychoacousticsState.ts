/**
 * URL codec for the F13 psychoacoustics lab. Decoding is total: one bad
 * field falls back alone, so an old share link still opens a working view.
 * The analysis window is not part of the URL: it follows the current
 * sub-selection, else the first 30 s (AGENTS §9 live-preview budget).
 */
import { decodeParams, encodeParams } from "../../lib/url-state";

export const PSYCHOACOUSTICS_REFERENCE_MIN = 80;
export const PSYCHOACOUSTICS_REFERENCE_MAX = 100;
export const PSYCHOACOUSTICS_REFERENCE_DEFAULT = 94;
export const PSYCHOACOUSTICS_PREVIEW_SECONDS = 30;

export type PsychoacousticsFrequencyScale = "linear" | "log";

export type PsychoacousticsSettings = {
  readonly referenceSplDb: number;
  readonly frequencyScale: PsychoacousticsFrequencyScale;
  readonly showThreshold: boolean;
};

export type PsychoacousticsRange = {
  readonly startSample: number;
  readonly endSample: number;
};

export const PSYCHOACOUSTICS_DEFAULT_SETTINGS: PsychoacousticsSettings = {
  referenceSplDb: PSYCHOACOUSTICS_REFERENCE_DEFAULT,
  frequencyScale: "log",
  showThreshold: true,
};

export function clampPsychoacousticsReferenceSpl(value: number): number {
  if (!Number.isFinite(value)) {
    return PSYCHOACOUSTICS_REFERENCE_DEFAULT;
  }
  return Math.max(
    PSYCHOACOUSTICS_REFERENCE_MIN,
    Math.min(PSYCHOACOUSTICS_REFERENCE_MAX, Math.round(value)),
  );
}

export function psychoacousticsSettingsToSearch(settings: PsychoacousticsSettings): string {
  return encodeParams({
    fs: settings.frequencyScale,
    rspl: settings.referenceSplDb,
    th: settings.showThreshold ? 1 : 0,
  });
}

export function psychoacousticsSettingsFromSearch(search: string): PsychoacousticsSettings {
  const decoded = decodeParams(search);
  const scalar = (key: string): string | undefined => {
    const value = decoded[key];
    return typeof value === "string" ? value : undefined;
  };
  const rawReference = Number(scalar("rspl"));
  const frequencyScale = scalar("fs") === "linear" ? "linear" : "log";
  return {
    referenceSplDb:
      scalar("rspl") === undefined
        ? PSYCHOACOUSTICS_REFERENCE_DEFAULT
        : clampPsychoacousticsReferenceSpl(rawReference),
    frequencyScale,
    showThreshold: scalar("th") !== "0",
  };
}

/** Current sub-selection, else the first 30 s (or the whole source). */
export function psychoacousticsAnalysisRange(
  selection: PsychoacousticsRange,
  sampleCount: number,
  sampleRateHz: number,
): PsychoacousticsRange {
  if (sampleCount <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  const start = Math.max(0, Math.min(Math.round(selection.startSample), sampleCount));
  const end = Math.max(start, Math.min(Math.round(selection.endSample), sampleCount));
  if (start > 0 || end < sampleCount) {
    return { startSample: start, endSample: end };
  }
  return {
    startSample: 0,
    endSample: Math.min(sampleCount, Math.round(PSYCHOACOUSTICS_PREVIEW_SECONDS * sampleRateHz)),
  };
}
