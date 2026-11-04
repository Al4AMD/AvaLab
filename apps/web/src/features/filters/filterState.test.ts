import { describe, expect, it } from "vitest";

import {
  FILTER_DEFAULT_SETTINGS,
  FILTER_STORAGE_KEY,
  filterSettingsFromSearch,
  filterSettingsToSearch,
  loadFilterSettings,
  saveFilterSettings,
} from "./filterState";

function memoryStorage(initial: readonly [string, string][] = []) {
  const values = new Map(initial);
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
  };
}

describe("filter state codec", () => {
  it("round-trips settings through the URL", () => {
    const settings = {
      ...FILTER_DEFAULT_SETTINGS,
      kind: "fir" as const,
      band: "bandpass" as const,
      cutoffHz: 1200,
      cutoff2Hz: 6800,
      order: 6,
      taps: 127,
      window: "kaiser" as const,
      rippleDb: 1.2,
      q: 1.4,
      gainDb: -3,
      sampleRateHz: 44_100,
      applyScope: "all" as const,
    };

    expect(filterSettingsFromSearch(`?${filterSettingsToSearch(settings)}`)).toEqual(settings);
  });

  it("falls back per field on unknown values", () => {
    const settings = filterSettingsFromSearch(
      "?k=nope&bd=wide&c=abc&c2=def&o=99&t=100&w=nope&rp=99&q=-1&g=nan&sr=0&as=no",
    );

    expect(settings).toEqual(FILTER_DEFAULT_SETTINGS);
  });

  it("clamps both cutoffs below Nyquist", () => {
    const settings = filterSettingsFromSearch("?sr=44100&c=30000&c2=50000");

    expect(settings.sampleRateHz).toBe(44_100);
    expect(settings.cutoffHz).toBeLessThan(22_050);
    expect(settings.cutoff2Hz).toBeLessThan(22_050);
    expect(settings.cutoff2Hz).toBeGreaterThanOrEqual(settings.cutoffHz);
  });

  it("keeps valid fields when a neighbour is unknown", () => {
    const settings = filterSettingsFromSearch("?k=biquad&bd=notch&c=1000&o=0");

    expect(settings.kind).toBe("biquad");
    expect(settings.band).toBe("notch");
    expect(settings.cutoffHz).toBe(1000);
    expect(settings.order).toBe(FILTER_DEFAULT_SETTINGS.order);
  });

  it("loads and saves through localStorage best-effort", () => {
    const storage = memoryStorage();
    const settings = { ...FILTER_DEFAULT_SETTINGS, cutoffHz: 2500, applyScope: "all" as const };

    saveFilterSettings(settings, storage);
    expect(storage.getItem(FILTER_STORAGE_KEY)).toBe(filterSettingsToSearch(settings));
    expect(loadFilterSettings(storage)).toEqual(settings);
  });

  it("falls back when storage is empty or throws", () => {
    const throwing = {
      getItem: (): string => {
        throw new Error("private mode");
      },
      setItem: (): void => {
        throw new Error("private mode");
      },
    };

    expect(loadFilterSettings(memoryStorage())).toEqual(FILTER_DEFAULT_SETTINGS);
    expect(loadFilterSettings(throwing)).toEqual(FILTER_DEFAULT_SETTINGS);
    expect(() => saveFilterSettings(FILTER_DEFAULT_SETTINGS, throwing)).not.toThrow();
  });
});
