/**
 * URL codec for the F03 sampling and bit-depth lab. Decoding is total: one
 * bad field falls back alone so an old share link still opens a working view.
 * The preview range defaults to the current sub-selection, else the first
 * 30 s (AGENTS §9 live-preview budget); "apply to whole file" writes the
 * full source range into the URL.
 */

import { type ResolvedLaneParams, resolveLaneParams } from "../../lib/laneParams";
import { type LastUsedStorage, readLastUsed } from "../../lib/lastUsed";
import { decodeParams, encodeParams } from "../../lib/url-state";

export type SamplingLaneSettings = {
  readonly bits: number;
  readonly dither: boolean;
};

export type SamplingEditLane = "left" | "right";

export type SamplingSettings = SamplingLaneSettings & {
  readonly targetRateHz: number;
  readonly antiAlias: boolean;
  readonly seed: number;
  readonly startSample: number;
  readonly endSample: number;
  readonly right?: SamplingLaneSettings;
  readonly editLane: SamplingEditLane;
};

export type SamplingRange = { readonly startSample: number; readonly endSample: number };

export type SamplingSourceInfo = { readonly sampleCount: number; readonly sampleRateHz: number };

export const SAMPLING_RATE_PRESETS = [48_000, 44_100, 22_050, 16_000, 8000, 4000, 1000] as const;
export const SAMPLING_MIN_RATE_HZ = 1000;
export const SAMPLING_MAX_RATE_HZ = 96_000;
export const SAMPLING_MIN_BITS = 1;
export const SAMPLING_MAX_BITS = 16;
export const SAMPLING_PREVIEW_SECONDS = 30;

export const SAMPLING_STORAGE_KEY = "avalab.sampling.last";

export const SAMPLING_DEFAULT_SETTINGS: SamplingSettings = {
  targetRateHz: 48_000,
  antiAlias: true,
  bits: 16,
  dither: false,
  seed: 1,
  startSample: 0,
  endSample: 0,
  editLane: "left",
};

function clampRange(start: number, end: number, sampleCount: number): SamplingRange {
  const clampedStart = Math.max(0, Math.min(Math.round(start), sampleCount));
  const clampedEnd = Math.max(clampedStart, Math.min(Math.round(end), sampleCount));
  return { startSample: clampedStart, endSample: clampedEnd };
}

/** Preview range: a real sub-selection when the user made one, otherwise
 * the first 30 s of the source (or the whole source when shorter). */
export function defaultSamplingRange(
  selection: SamplingRange,
  sampleCount: number,
  sampleRateHz: number,
): SamplingRange {
  if (sampleCount <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  const selected = clampRange(selection.startSample, selection.endSample, sampleCount);
  const isSubSelection = selected.startSample > 0 || selected.endSample < sampleCount;
  if (isSubSelection && selected.endSample > selected.startSample) {
    return selected;
  }
  const previewEnd = Math.min(sampleCount, Math.round(SAMPLING_PREVIEW_SECONDS * sampleRateHz));
  return { startSample: 0, endSample: previewEnd };
}

function defaultTargetRate(source: SamplingSourceInfo): number {
  const rate = Math.round(source.sampleRateHz);
  return Number.isSafeInteger(rate) && rate >= SAMPLING_MIN_RATE_HZ && rate <= SAMPLING_MAX_RATE_HZ
    ? rate
    : SAMPLING_DEFAULT_SETTINGS.targetRateHz;
}

export function samplingSettingsToSearch(settings: SamplingSettings): string {
  const params: Record<string, string | number> = {
    aa: settings.antiAlias ? 1 : 0,
    bd: settings.bits,
    dt: settings.dither ? 1 : 0,
    from: settings.startSample,
    seed: settings.seed,
    to: settings.endSample,
    tr: settings.targetRateHz,
  };
  if (settings.editLane === "right") {
    params.el = "right";
  }
  if (settings.right !== undefined) {
    params.rrbd = settings.right.bits;
    params.rrdt = settings.right.dither ? 1 : 0;
  }
  return encodeParams(params);
}

export function samplingLanes(
  settings: SamplingSettings,
): ResolvedLaneParams<SamplingLaneSettings> {
  return resolveLaneParams({
    primary: { bits: settings.bits, dither: settings.dither },
    ...(settings.right === undefined ? {} : { right: settings.right }),
  });
}

function clampBits(raw: number, fallback: number): number {
  return Number.isInteger(raw)
    ? Math.max(SAMPLING_MIN_BITS, Math.min(SAMPLING_MAX_BITS, raw))
    : fallback;
}

function laneDither(raw: string | undefined, fallback: boolean): boolean {
  if (raw === "1") {
    return true;
  }
  if (raw === "0") {
    return false;
  }
  return fallback;
}

export function samplingSettingsFromSearch(
  search: string,
  source: SamplingSourceInfo,
  selection: SamplingRange,
): SamplingSettings {
  const decoded = decodeParams(search);
  const scalar = (key: string): string | undefined => {
    const value = decoded[key];
    return typeof value === "string" ? value : undefined;
  };
  const targetRate = Number(scalar("tr"));
  const bits = Number(scalar("bd"));
  const seed = Number(scalar("seed"));
  const fallbackRange = defaultSamplingRange(selection, source.sampleCount, source.sampleRateHz);
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
  const primaryBits = clampBits(bits, SAMPLING_DEFAULT_SETTINGS.bits);
  const primaryDither = laneDither(scalar("dt"), SAMPLING_DEFAULT_SETTINGS.dither);
  const hasRight = Object.keys(decoded).some(
    (key) => key.startsWith("rr") && key.length > "rr".length,
  );
  const right = hasRight
    ? {
        bits: clampBits(Number(scalar("rrbd")), primaryBits),
        dither: laneDither(scalar("rrdt"), primaryDither),
      }
    : undefined;
  return {
    targetRateHz:
      Number.isSafeInteger(targetRate) &&
      targetRate >= SAMPLING_MIN_RATE_HZ &&
      targetRate <= SAMPLING_MAX_RATE_HZ
        ? targetRate
        : defaultTargetRate(source),
    antiAlias: scalar("aa") === "0" ? false : SAMPLING_DEFAULT_SETTINGS.antiAlias,
    bits: primaryBits,
    dither: primaryDither,
    seed: Number.isSafeInteger(seed) && seed >= 0 ? seed : SAMPLING_DEFAULT_SETTINGS.seed,
    startSample: range.startSample,
    endSample: range.endSample,
    ...(right === undefined ? {} : { right }),
    editLane: scalar("el") === "right" ? "right" : "left",
  };
}

/** Last-used panel; missing/invalid storage decodes to the same defaults. */
export function loadSamplingSettings(
  source: SamplingSourceInfo,
  selection: SamplingRange,
  storage?: LastUsedStorage | null,
): SamplingSettings {
  const stored = readLastUsed(SAMPLING_STORAGE_KEY, storage);
  return samplingSettingsFromSearch(stored === null ? "" : stored, source, selection);
}
