/**
 * URL + localStorage codec for the F11 filter lab. Decoding is total: one bad
 * field falls back alone so an old share link still opens a working view.
 * Cutoffs are clamped below Nyquist because the design op rejects equality.
 */
import { decodeParams, encodeParams } from "../../lib/url-state";
import type { FilterBand, FilterDesignKind, FilterWindowKind } from "../../session/ops";

export type FilterSettings = {
  readonly kind: FilterDesignKind;
  readonly band: FilterBand;
  readonly cutoffHz: number;
  readonly cutoff2Hz: number;
  readonly order: number;
  readonly taps: number;
  readonly window: FilterWindowKind;
  readonly rippleDb: number;
  readonly q: number;
  readonly gainDb: number;
  readonly sampleRateHz: number;
  readonly applyScope: "selection" | "all";
};

export const FILTER_DESIGN_KINDS: readonly FilterDesignKind[] = [
  "fir",
  "butterworth",
  "chebyshev1",
  "biquad",
];
export const FILTER_BANDS: readonly FilterBand[] = [
  "lowpass",
  "highpass",
  "bandpass",
  "bandstop",
  "notch",
  "peaking",
];
export const FILTER_WINDOWS: readonly FilterWindowKind[] = ["hamming", "blackman", "kaiser"];
export const FILTER_MIN_RATE_HZ = 1000;
export const FILTER_MAX_RATE_HZ = 96_000;
export const FILTER_STORAGE_KEY = "avalab.filters.last";

export const FILTER_DEFAULT_SETTINGS: FilterSettings = {
  kind: "butterworth",
  band: "lowpass",
  cutoffHz: 4000,
  cutoff2Hz: 8000,
  order: 4,
  taps: 101,
  window: "hamming",
  rippleDb: 0.5,
  q: Math.SQRT1_2,
  gainDb: 0,
  sampleRateHz: 48_000,
  applyScope: "selection",
};

export type FilterStorage = Pick<Storage, "getItem" | "setItem">;

function finiteIn(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function integerIn(value: number, min: number, max: number, fallback: number): number {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function clampCutoff(value: number, sampleRateHz: number): number {
  const maxHz = Math.max(1, sampleRateHz / 2 - 1);
  return Math.min(Math.max(1, value), maxHz);
}

export function filterSettingsToSearch(settings: FilterSettings): string {
  return encodeParams({
    as: settings.applyScope,
    bd: settings.band,
    c: settings.cutoffHz,
    c2: settings.cutoff2Hz,
    g: settings.gainDb,
    k: settings.kind,
    o: settings.order,
    q: settings.q,
    rp: settings.rippleDb,
    sr: settings.sampleRateHz,
    t: settings.taps,
    w: settings.window,
  });
}

export function filterSettingsFromSearch(search: string): FilterSettings {
  const decoded = decodeParams(search);
  const scalar = (key: string): string | undefined => {
    const value = decoded[key];
    return typeof value === "string" ? value : undefined;
  };
  const defaults = FILTER_DEFAULT_SETTINGS;
  const kind = scalar("k");
  const band = scalar("bd");
  const windowKind = scalar("w");
  const scope = scalar("as");
  const sampleRateHz = integerIn(
    Number(scalar("sr")),
    FILTER_MIN_RATE_HZ,
    FILTER_MAX_RATE_HZ,
    defaults.sampleRateHz,
  );
  const cutoffHz = clampCutoff(
    finiteIn(Number(scalar("c")), 1, Number.POSITIVE_INFINITY, defaults.cutoffHz),
    sampleRateHz,
  );
  const cutoff2Hz = Math.max(
    cutoffHz,
    clampCutoff(
      finiteIn(Number(scalar("c2")), 1, Number.POSITIVE_INFINITY, defaults.cutoff2Hz),
      sampleRateHz,
    ),
  );

  return {
    kind:
      kind !== undefined && (FILTER_DESIGN_KINDS as readonly string[]).includes(kind)
        ? (kind as FilterDesignKind)
        : defaults.kind,
    band:
      band !== undefined && (FILTER_BANDS as readonly string[]).includes(band)
        ? (band as FilterBand)
        : defaults.band,
    cutoffHz,
    cutoff2Hz,
    order: integerIn(Number(scalar("o")), 1, 8, defaults.order),
    taps:
      Number.isInteger(Number(scalar("t"))) && Number(scalar("t")) % 2 === 1
        ? integerIn(Number(scalar("t")), 3, 257, defaults.taps)
        : defaults.taps,
    window:
      windowKind !== undefined && (FILTER_WINDOWS as readonly string[]).includes(windowKind)
        ? (windowKind as FilterWindowKind)
        : defaults.window,
    rippleDb: finiteIn(Number(scalar("rp")), 0.1, 3, defaults.rippleDb),
    q: finiteIn(Number(scalar("q")), 0.1, 20, defaults.q),
    gainDb: finiteIn(Number(scalar("g")), -24, 24, defaults.gainDb),
    sampleRateHz,
    applyScope: scope === "all" ? "all" : "selection",
  };
}

function browserStorage(): FilterStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadFilterSettings(
  storage: FilterStorage | null = browserStorage(),
): FilterSettings {
  try {
    const stored = storage?.getItem(FILTER_STORAGE_KEY);
    return stored === null || stored === undefined
      ? FILTER_DEFAULT_SETTINGS
      : filterSettingsFromSearch(stored);
  } catch {
    return FILTER_DEFAULT_SETTINGS;
  }
}

export function saveFilterSettings(
  settings: FilterSettings,
  storage: FilterStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(FILTER_STORAGE_KEY, filterSettingsToSearch(settings));
  } catch {
    // Storage may be unavailable (private mode); the URL still carries state.
  }
}
