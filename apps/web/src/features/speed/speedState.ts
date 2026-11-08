/**
 * URL codec for the F06 speed/direction lab. Decoding is total: one bad
 * field falls back alone so an old share link still opens a working view.
 * The preview range defaults to the current sub-selection, else the first
 * 30 s (AGENTS §9 live-preview budget); "apply to whole file" writes the
 * full source range into the URL.
 */

import { type ResolvedLaneParams, resolveLaneParams } from "../../lib/laneParams";
import { type LastUsedStorage, readLastUsed } from "../../lib/lastUsed";
import { decodeParams, encodeParams } from "../../lib/url-state";

export type SpeedMode = "resample" | "timeStretch";

export type SpeedLaneSettings = {
  readonly reverse: boolean;
};

export type SpeedEditLane = "left" | "right";

export type SpeedSettings = SpeedLaneSettings & {
  readonly mode: SpeedMode;
  readonly speedFactor: number;
  readonly semitones: number;
  readonly startSample: number;
  readonly endSample: number;
  readonly right?: SpeedLaneSettings;
  readonly editLane: SpeedEditLane;
};

export type SpeedRange = { readonly startSample: number; readonly endSample: number };

export type SpeedSourceInfo = { readonly sampleCount: number; readonly sampleRateHz: number };

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const SPEED_SEMITONE_MIN = -12;
export const SPEED_SEMITONE_MAX = 12;
export const SPEED_PREVIEW_SECONDS = 30;

export const SPEED_STORAGE_KEY = "avalab.speed.last";

export const SPEED_DEFAULT_SETTINGS: SpeedSettings = {
  mode: "resample",
  speedFactor: 1,
  semitones: 0,
  reverse: false,
  startSample: 0,
  endSample: 0,
  editLane: "left",
};

function clampRange(start: number, end: number, sampleCount: number): SpeedRange {
  const clampedStart = Math.max(0, Math.min(Math.round(start), sampleCount));
  const clampedEnd = Math.max(clampedStart, Math.min(Math.round(end), sampleCount));
  return { startSample: clampedStart, endSample: clampedEnd };
}

/** Preview range: a real sub-selection when the user made one, otherwise
 * the first 30 s of the source (or the whole source when shorter). */
export function defaultSpeedRange(
  selection: SpeedRange,
  sampleCount: number,
  sampleRateHz: number,
): SpeedRange {
  if (sampleCount <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  const selected = clampRange(selection.startSample, selection.endSample, sampleCount);
  const isSubSelection = selected.startSample > 0 || selected.endSample < sampleCount;
  if (isSubSelection && selected.endSample > selected.startSample) {
    return selected;
  }
  const previewEnd = Math.min(sampleCount, Math.round(SPEED_PREVIEW_SECONDS * sampleRateHz));
  return { startSample: 0, endSample: previewEnd };
}

export function speedSettingsToSearch(settings: SpeedSettings): string {
  const params: Record<string, string | number> = {
    from: settings.startSample,
    m: settings.mode,
    p: settings.semitones,
    rv: settings.reverse ? 1 : 0,
    sp: settings.speedFactor,
    to: settings.endSample,
  };
  if (settings.editLane === "right") {
    params.el = "right";
  }
  if (settings.right !== undefined) {
    params.rrrv = settings.right.reverse ? 1 : 0;
  }
  return encodeParams(params);
}

export function speedLanes(settings: SpeedSettings): ResolvedLaneParams<SpeedLaneSettings> {
  return resolveLaneParams({
    primary: { reverse: settings.reverse },
    ...(settings.right === undefined ? {} : { right: settings.right }),
  });
}

function laneReverse(raw: string | undefined, fallback: boolean): boolean {
  if (raw === "1") {
    return true;
  }
  if (raw === "0") {
    return false;
  }
  return fallback;
}

export function speedSettingsFromSearch(
  search: string,
  source: SpeedSourceInfo,
  selection: SpeedRange,
): SpeedSettings {
  const decoded = decodeParams(search);
  const scalar = (key: string): string | undefined => {
    const value = decoded[key];
    return typeof value === "string" ? value : undefined;
  };
  const speed = Number(scalar("sp"));
  const semitones = Number(scalar("p"));
  const fallbackRange = defaultSpeedRange(selection, source.sampleCount, source.sampleRateHz);
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
  const primaryReverse = laneReverse(scalar("rv"), SPEED_DEFAULT_SETTINGS.reverse);
  const hasRight = Object.keys(decoded).some(
    (key) => key.startsWith("rr") && key.length > "rr".length,
  );
  const right = hasRight ? { reverse: laneReverse(scalar("rrrv"), primaryReverse) } : undefined;
  return {
    mode: scalar("m") === "timeStretch" ? "timeStretch" : "resample",
    speedFactor:
      Number.isFinite(speed) && speed >= SPEED_MIN && speed <= SPEED_MAX
        ? speed
        : SPEED_DEFAULT_SETTINGS.speedFactor,
    semitones:
      Number.isFinite(semitones) &&
      semitones >= SPEED_SEMITONE_MIN &&
      semitones <= SPEED_SEMITONE_MAX
        ? semitones
        : SPEED_DEFAULT_SETTINGS.semitones,
    reverse: primaryReverse,
    startSample: range.startSample,
    endSample: range.endSample,
    ...(right === undefined ? {} : { right }),
    editLane: scalar("el") === "right" ? "right" : "left",
  };
}

/** Last-used panel; missing/invalid storage decodes to the same defaults. */
export function loadSpeedSettings(
  source: SpeedSourceInfo,
  selection: SpeedRange,
  storage?: LastUsedStorage | null,
): SpeedSettings {
  const stored = readLastUsed(SPEED_STORAGE_KEY, storage);
  return speedSettingsFromSearch(stored === null ? "" : stored, source, selection);
}
