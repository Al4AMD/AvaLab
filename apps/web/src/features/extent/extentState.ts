/**
 * URL codec for the F07 signal-extent lab. Decoding is total: one bad field
 * falls back alone so an old share link still opens a working view. The
 * preview range defaults to the current sub-selection, else the first 30 s
 * (AGENTS §9 live-preview budget); "apply to whole file" writes the full
 * source range into the URL.
 */
import { decodeParams, encodeParams } from "../../lib/url-state";

export const EXTENT_OPERATIONS = [
  "identity",
  "shift",
  "scale",
  "reverse",
  "truncate",
  "zeroPad",
  "periodic",
] as const;

export type ExtentOperationName = (typeof EXTENT_OPERATIONS)[number];

export type ExtentSettings = {
  readonly operation: ExtentOperationName;
  readonly shiftSamples: number;
  readonly scaleFactor: number;
  readonly truncateStartSample: number;
  readonly truncateLengthSamples: number;
  readonly padStartSamples: number;
  readonly padEndSamples: number;
  readonly repetitions: number;
  readonly startSample: number;
  readonly endSample: number;
};

export type ExtentRange = { readonly startSample: number; readonly endSample: number };

export type ExtentSourceInfo = { readonly sampleCount: number; readonly sampleRateHz: number };

export const EXTENT_PREVIEW_SECONDS = 30;
export const EXTENT_MIN_FACTOR = 0.25;
export const EXTENT_MAX_FACTOR = 4;
export const EXTENT_MIN_REPETITIONS = 1;
export const EXTENT_MAX_REPETITIONS = 16;
export const EXTENT_TRUNCATE_DEFAULT_SECONDS = 1;

export const EXTENT_DEFAULT_SETTINGS: ExtentSettings = {
  operation: "identity",
  shiftSamples: 0,
  scaleFactor: 2,
  truncateStartSample: 0,
  truncateLengthSamples: 0,
  padStartSamples: 0,
  padEndSamples: 0,
  repetitions: 3,
  startSample: 0,
  endSample: 0,
};

function clampRange(start: number, end: number, sampleCount: number): ExtentRange {
  const clampedStart = Math.max(0, Math.min(Math.round(start), sampleCount));
  const clampedEnd = Math.max(clampedStart, Math.min(Math.round(end), sampleCount));
  return { startSample: clampedStart, endSample: clampedEnd };
}

/** Preview range: a real sub-selection when the user made one, otherwise
 * the first 30 s of the source (or the whole source when shorter). */
export function defaultExtentRange(
  selection: ExtentRange,
  sampleCount: number,
  sampleRateHz: number,
): ExtentRange {
  if (sampleCount <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  const selected = clampRange(selection.startSample, selection.endSample, sampleCount);
  const isSubSelection = selected.startSample > 0 || selected.endSample < sampleCount;
  if (isSubSelection && selected.endSample > selected.startSample) {
    return selected;
  }
  const previewEnd = Math.min(sampleCount, Math.round(EXTENT_PREVIEW_SECONDS * sampleRateHz));
  return { startSample: 0, endSample: previewEnd };
}

export function defaultExtentTruncateLength(source: ExtentSourceInfo): number {
  if (source.sampleCount <= 0) {
    return 0;
  }
  const oneSecond = Math.round(EXTENT_TRUNCATE_DEFAULT_SECONDS * source.sampleRateHz);
  return Math.max(1, Math.min(source.sampleCount, oneSecond));
}

export function extentSettingsToSearch(settings: ExtentSettings): string {
  return encodeParams({
    from: settings.startSample,
    op: settings.operation,
    pe: settings.padEndSamples,
    ps: settings.padStartSamples,
    rp: settings.repetitions,
    sf: settings.scaleFactor,
    sh: settings.shiftSamples,
    tl: settings.truncateLengthSamples,
    to: settings.endSample,
    ts: settings.truncateStartSample,
  });
}

export function extentSettingsFromSearch(
  search: string,
  source: ExtentSourceInfo,
  selection: ExtentRange,
): ExtentSettings {
  const decoded = decodeParams(search);
  const scalar = (key: string): string | undefined => {
    const value = decoded[key];
    return typeof value === "string" ? value : undefined;
  };
  const fallbackRange = defaultExtentRange(selection, source.sampleCount, source.sampleRateHz);
  const from = Number(scalar("from"));
  const to = Number(scalar("to"));
  const explicitRange =
    Number.isSafeInteger(from) && Number.isSafeInteger(to)
      ? clampRange(from, to, source.sampleCount)
      : null;
  const range =
    explicitRange !== null && explicitRange.endSample > explicitRange.startSample
      ? explicitRange
      : fallbackRange;
  const shift = Number(scalar("sh"));
  const factor = Number(scalar("sf"));
  const truncateStart = Number(scalar("ts"));
  const truncateLength = Number(scalar("tl"));
  const padStart = Number(scalar("ps"));
  const padEnd = Number(scalar("pe"));
  const repetitions = Number(scalar("rp"));
  const operation = scalar("op");
  return {
    operation: EXTENT_OPERATIONS.includes(operation as ExtentOperationName)
      ? (operation as ExtentOperationName)
      : EXTENT_DEFAULT_SETTINGS.operation,
    shiftSamples: Number.isSafeInteger(shift)
      ? Math.max(-source.sampleCount, Math.min(source.sampleCount, shift))
      : EXTENT_DEFAULT_SETTINGS.shiftSamples,
    scaleFactor:
      Number.isFinite(factor) && factor > 0
        ? Math.max(EXTENT_MIN_FACTOR, Math.min(EXTENT_MAX_FACTOR, factor))
        : EXTENT_DEFAULT_SETTINGS.scaleFactor,
    truncateStartSample: Number.isSafeInteger(truncateStart)
      ? Math.max(0, Math.min(source.sampleCount, truncateStart))
      : EXTENT_DEFAULT_SETTINGS.truncateStartSample,
    truncateLengthSamples: Number.isSafeInteger(truncateLength)
      ? Math.max(0, Math.min(source.sampleCount, truncateLength))
      : defaultExtentTruncateLength(source),
    padStartSamples: Number.isSafeInteger(padStart) ? Math.max(0, padStart) : 0,
    padEndSamples: Number.isSafeInteger(padEnd) ? Math.max(0, padEnd) : 0,
    repetitions: Number.isInteger(repetitions)
      ? Math.max(EXTENT_MIN_REPETITIONS, Math.min(EXTENT_MAX_REPETITIONS, repetitions))
      : EXTENT_DEFAULT_SETTINGS.repetitions,
    startSample: range.startSample,
    endSample: range.endSample,
  };
}
