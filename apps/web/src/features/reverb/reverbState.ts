/**
 * URL codec for the F10 reverse/reverb lab. Decoding is total: one bad field
 * falls back alone so an old share link still opens a working view. Uploaded
 * IR audio is never serialized — `ir=upload` only records the choice, and the
 * view asks for the file again after a reload. The preview range defaults to
 * the current sub-selection, else the first 30 s (AGENTS §9).
 */
import { decodeParams, encodeParams } from "../../lib/url-state";

export const REVERB_IR_PRESETS = ["room", "hall", "plate", "telephone", "upload"] as const;

export type ReverbIrPreset = (typeof REVERB_IR_PRESETS)[number];

export type ReverbSettings = {
  readonly irKind: ReverbIrPreset;
  readonly rt60Seconds: number;
  readonly irDurationSeconds: number;
  readonly seed: number;
  readonly preDelayMs: number;
  readonly wetMix: number;
  readonly method: "fft" | "direct";
  readonly startSample: number;
  readonly endSample: number;
};

export type ReverbRange = { readonly startSample: number; readonly endSample: number };

export type ReverbSourceInfo = { readonly sampleCount: number; readonly sampleRateHz: number };

export const REVERB_PREVIEW_SECONDS = 30;
export const REVERB_MIN_RT60_SECONDS = 0.1;
export const REVERB_MAX_RT60_SECONDS = 5;
export const REVERB_MIN_IR_SECONDS = 0.05;
export const REVERB_MAX_IR_SECONDS = 10;
export const REVERB_MAX_PRE_DELAY_MS = 500;
export const REVERB_MAX_UPLOADED_IR_SECONDS = 10;
export const REVERB_MAX_SEED = 4_294_967_295;

export const REVERB_DEFAULT_SETTINGS: ReverbSettings = {
  irKind: "hall",
  rt60Seconds: 1.8,
  irDurationSeconds: 2,
  seed: 7,
  preDelayMs: 0,
  wetMix: 0.5,
  method: "fft",
  startSample: 0,
  endSample: 0,
};

/** Preset durations/RT60 values; `upload` keeps the built-in fallback values
 * for the URL fields even though the uploaded IR overrides them. */
export function reverbPresetDefaults(kind: ReverbIrPreset): {
  readonly durationSeconds: number;
  readonly rt60Seconds: number;
} {
  switch (kind) {
    case "room":
      return { durationSeconds: 0.6, rt60Seconds: 0.5 };
    case "hall":
      return { durationSeconds: 2, rt60Seconds: 1.8 };
    case "plate":
      return { durationSeconds: 1.5, rt60Seconds: 1.2 };
    case "telephone":
      return { durationSeconds: 0.4, rt60Seconds: 0.3 };
    case "upload":
      return { durationSeconds: 2, rt60Seconds: 1.8 };
  }
}

function clampRange(start: number, end: number, sampleCount: number): ReverbRange {
  const clampedStart = Math.max(0, Math.min(Math.round(start), sampleCount));
  const clampedEnd = Math.max(clampedStart, Math.min(Math.round(end), sampleCount));
  return { startSample: clampedStart, endSample: clampedEnd };
}

export function defaultReverbRange(
  selection: ReverbRange,
  sampleCount: number,
  sampleRateHz: number,
): ReverbRange {
  if (sampleCount <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  const selected = clampRange(selection.startSample, selection.endSample, sampleCount);
  const isSubSelection = selected.startSample > 0 || selected.endSample < sampleCount;
  if (isSubSelection && selected.endSample > selected.startSample) {
    return selected;
  }
  const previewEnd = Math.min(sampleCount, Math.round(REVERB_PREVIEW_SECONDS * sampleRateHz));
  return { startSample: 0, endSample: previewEnd };
}

export function reverbSettingsToSearch(settings: ReverbSettings): string {
  return encodeParams({
    du: settings.irDurationSeconds,
    from: settings.startSample,
    ir: settings.irKind,
    me: settings.method,
    pd: settings.preDelayMs,
    rt: settings.rt60Seconds,
    sd: settings.seed,
    to: settings.endSample,
    wm: settings.wetMix,
  });
}

export function reverbSettingsFromSearch(
  search: string,
  source: ReverbSourceInfo,
  selection: ReverbRange,
): ReverbSettings {
  const decoded = decodeParams(search);
  const scalar = (key: string): string | undefined => {
    const value = decoded[key];
    return typeof value === "string" ? value : undefined;
  };
  const fallbackRange = defaultReverbRange(selection, source.sampleCount, source.sampleRateHz);
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
  const kind = scalar("ir");
  const irKind = REVERB_IR_PRESETS.includes(kind as ReverbIrPreset)
    ? (kind as ReverbIrPreset)
    : REVERB_DEFAULT_SETTINGS.irKind;
  const presetDefaults = reverbPresetDefaults(irKind);
  const rt60 = Number(scalar("rt"));
  const duration = Number(scalar("du"));
  const seed = Number(scalar("sd"));
  const preDelay = Number(scalar("pd"));
  const wetMix = Number(scalar("wm"));
  const method = scalar("me");
  return {
    irKind,
    rt60Seconds:
      Number.isFinite(rt60) && rt60 > 0
        ? Math.max(REVERB_MIN_RT60_SECONDS, Math.min(REVERB_MAX_RT60_SECONDS, rt60))
        : presetDefaults.rt60Seconds,
    irDurationSeconds:
      Number.isFinite(duration) && duration > 0
        ? Math.max(REVERB_MIN_IR_SECONDS, Math.min(REVERB_MAX_IR_SECONDS, duration))
        : presetDefaults.durationSeconds,
    seed: Number.isSafeInteger(seed)
      ? Math.max(0, Math.min(REVERB_MAX_SEED, seed))
      : REVERB_DEFAULT_SETTINGS.seed,
    preDelayMs:
      Number.isFinite(preDelay) && preDelay >= 0
        ? Math.min(REVERB_MAX_PRE_DELAY_MS, preDelay)
        : REVERB_DEFAULT_SETTINGS.preDelayMs,
    wetMix:
      Number.isFinite(wetMix) && wetMix >= 0 ? Math.min(1, wetMix) : REVERB_DEFAULT_SETTINGS.wetMix,
    method: method === "fft" || method === "direct" ? method : REVERB_DEFAULT_SETTINGS.method,
    startSample: range.startSample,
    endSample: range.endSample,
  };
}
