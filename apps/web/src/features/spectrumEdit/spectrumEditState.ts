/**
 * URL/state helpers for the F09 spectrum editor. Only the shareable edit list,
 * Hermitian flag and selection range ride the URL; transient builder fields
 * (band Hz, target, mode, value) stay in the view. Decoding is total per
 * field, and every edit is re-validated so a hand-edited link cannot make the
 * worker throw.
 */
import {
  buildSpectrumPreset,
  nextPowerOfTwo,
  type SpectrumCurveEdit,
  type SpectrumEdit,
} from "@avalab/dsp";
import { type LastUsedStorage, readLastUsed } from "../../lib/lastUsed";
import { decodeParams, encodeParams } from "../../lib/url-state";
import { FFT_MAX_LENGTH } from "../../session/ops";
import { CURVE_URL_KEY, decodeCurves, encodeCurves } from "./curveState";

export const SPECTRUM_EDIT_TARGETS = ["re", "im", "mag", "phase"] as const;
export const SPECTRUM_EDIT_MODES = ["zero", "scale", "set"] as const;
export const SPECTRUM_EDIT_PRESETS = [
  "zeroIm",
  "zeroRe",
  "zeroPhase",
  "linearPhase",
  "randomPhase",
  "magnitudeOnly",
  "phaseOnly",
] as const;

export type SpectrumEditPreset = (typeof SPECTRUM_EDIT_PRESETS)[number];

export type SpectrumEditSettings = {
  readonly hermitian: boolean;
  readonly edits: readonly SpectrumEdit[];
  readonly curves: readonly SpectrumCurveEdit[];
  readonly startSample: number;
  readonly endSample: number;
};

export type SpectrumEditRange = { readonly startSample: number; readonly endSample: number };

export type SpectrumEditSourceInfo = {
  readonly sampleCount: number;
  readonly sampleRateHz: number;
};

export const SPECTRUM_EDIT_STORAGE_KEY = "avalab.spectrum-edit.last";

export const SPECTRUM_EDIT_DEFAULT_SETTINGS: SpectrumEditSettings = {
  hermitian: true,
  edits: [],
  curves: [],
  startSample: 0,
  endSample: 0,
};

const PRESET_SEED = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validSpectrumEdit(value: unknown): value is SpectrumEdit {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Number.isInteger(value.startBin) &&
    Number.isInteger(value.endBin) &&
    (value.startBin as number) >= 0 &&
    (value.endBin as number) >= (value.startBin as number) &&
    (SPECTRUM_EDIT_TARGETS as readonly string[]).includes(value.target as string) &&
    (SPECTRUM_EDIT_MODES as readonly string[]).includes(value.mode as string) &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
  );
}

function decodeEdits(raw: string | undefined): SpectrumEdit[] {
  if (raw === undefined) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(validSpectrumEdit) : [];
}

function clampRange(start: number, end: number, sampleCount: number): SpectrumEditRange {
  const clampedStart = Math.max(0, Math.min(Math.round(start), sampleCount));
  const clampedEnd = Math.max(clampedStart, Math.min(Math.round(end), sampleCount));
  return { startSample: clampedStart, endSample: clampedEnd };
}

export function defaultSpectrumEditRange(
  selection: SpectrumEditRange,
  sampleCount: number,
): SpectrumEditRange {
  if (sampleCount <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  const selected = clampRange(selection.startSample, selection.endSample, sampleCount);
  if (selected.endSample > selected.startSample) {
    return selected;
  }
  return { startSample: 0, endSample: Math.min(sampleCount, FFT_MAX_LENGTH) };
}

export function binsFromHz(
  startHz: number,
  endHz: number,
  sampleRateHz: number,
  fftLengthSamples: number,
): { readonly startBin: number; readonly endBin: number } {
  if (
    !Number.isFinite(startHz) ||
    !Number.isFinite(endHz) ||
    !Number.isFinite(sampleRateHz) ||
    sampleRateHz <= 0 ||
    !Number.isInteger(fftLengthSamples) ||
    fftLengthSamples < 1
  ) {
    return { startBin: 0, endBin: 0 };
  }
  const binCount = Math.floor(fftLengthSamples / 2) + 1;
  const resolutionHz = sampleRateHz / fftLengthSamples;
  const low = Math.max(0, Math.min(startHz, endHz));
  const high = Math.max(startHz, endHz);
  const startBin = Math.max(0, Math.min(binCount, Math.floor(low / resolutionHz)));
  const endBin = Math.max(startBin, Math.min(binCount, Math.ceil(high / resolutionHz)));
  return { startBin, endBin };
}

export function presetEdits(
  preset: SpectrumEditPreset,
  binCount: number,
  seed = PRESET_SEED,
): SpectrumEdit[] {
  return buildSpectrumPreset(preset, binCount, seed);
}

export function spectrumEditSettingsToSearch(settings: SpectrumEditSettings): string {
  const curves = encodeCurves(settings.curves);
  return encodeParams({
    ...(curves === null ? {} : { [CURVE_URL_KEY]: curves }),
    ed: JSON.stringify(settings.edits),
    from: settings.startSample,
    h: settings.hermitian ? 1 : 0,
    to: settings.endSample,
  });
}

export function spectrumEditSettingsFromSearch(
  search: string,
  source: SpectrumEditSourceInfo,
  selection: SpectrumEditRange,
): SpectrumEditSettings {
  const decoded = decodeParams(search);
  const scalar = (key: string): string | undefined => {
    const value = decoded[key];
    return typeof value === "string" ? value : undefined;
  };
  const fallbackRange = defaultSpectrumEditRange(selection, source.sampleCount);
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
  const analysisLength = Math.min(range.endSample - range.startSample, FFT_MAX_LENGTH);
  const fftLengthSamples = analysisLength <= 1 ? 1 : nextPowerOfTwo(analysisLength);
  const maxBin = Math.floor(fftLengthSamples / 2);
  return {
    hermitian: scalar("h") !== "0",
    edits: decodeEdits(scalar("ed")),
    curves: decodeCurves(scalar(CURVE_URL_KEY), maxBin),
    startSample: range.startSample,
    endSample: range.endSample,
  };
}

/** Last-used panel; missing/invalid storage decodes to the same defaults. */
export function loadSpectrumEditSettings(
  source: SpectrumEditSourceInfo,
  selection: SpectrumEditRange,
  storage?: LastUsedStorage | null,
): SpectrumEditSettings {
  const stored = readLastUsed(SPECTRUM_EDIT_STORAGE_KEY, storage);
  return spectrumEditSettingsFromSearch(stored === null ? "" : stored, source, selection);
}
