import { describe, expect, it } from "vitest";

import {
  FILTER_DEFAULT_SETTINGS,
  FILTER_STORAGE_KEY,
  type FilterPairSettings,
  filterPairAtRate,
  filterPairFromSearch,
  filterPairToSearch,
  filterSettingsFromSearch,
  filterSettingsToSearch,
  loadFilterPair,
  loadFilterSettings,
  saveFilterPair,
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

describe("filter pair state codec", () => {
  it("round-trips primary-only settings without right or edit-lane keys", () => {
    const pair: FilterPairSettings = { primary: FILTER_DEFAULT_SETTINGS, editLane: "left" };
    const search = filterPairToSearch(pair);

    expect(search).not.toContain("rr");
    expect(search).not.toContain("el=");
    expect(filterPairFromSearch(`?${search}`)).toEqual(pair);
  });

  it("round-trips an independent right override", () => {
    const pair: FilterPairSettings = {
      primary: { ...FILTER_DEFAULT_SETTINGS, cutoffHz: 1200, kind: "chebyshev1" },
      right: { ...FILTER_DEFAULT_SETTINGS, cutoffHz: 6400, kind: "fir" },
      editLane: "right",
    };

    expect(filterPairFromSearch(`?${filterPairToSearch(pair)}`)).toEqual(pair);
  });

  it("decodes an old single-lane URL to a primary-only left edit lane", () => {
    const settings = { ...FILTER_DEFAULT_SETTINGS, cutoffHz: 2500 };

    const pair = filterPairFromSearch(`?${filterSettingsToSearch(settings)}`);

    expect(pair.primary).toEqual(settings);
    expect(pair.right).toBeUndefined();
    expect(pair.editLane).toBe("left");
  });

  it("keeps the primary ripple key separate from right-lane keys", () => {
    const pair = filterPairFromSearch("?k=chebyshev1&rp=2.5&rrc=9000&sr=44100");

    expect(pair.primary.rippleDb).toBe(2.5);
    expect(pair.primary.cutoffHz).toBe(FILTER_DEFAULT_SETTINGS.cutoffHz);
    expect(pair.right?.cutoffHz).toBe(9000);
  });

  it("clamps a right cutoff at Nyquist independently", () => {
    const pair = filterPairFromSearch("?sr=44100&c=1000&rrc=50000");

    expect(pair.primary.cutoffHz).toBe(1000);
    expect(pair.right?.cutoffHz).toBeLessThan(22_050);
    expect(pair.right?.cutoffHz).toBeGreaterThan(1000);
  });

  it("round-trips the pair through storage and loads old single-lane storage", () => {
    const storage = memoryStorage();
    const pair: FilterPairSettings = {
      primary: { ...FILTER_DEFAULT_SETTINGS, cutoffHz: 2200 },
      right: { ...FILTER_DEFAULT_SETTINGS, cutoffHz: 3300 },
      editLane: "right",
    };

    saveFilterPair(pair, storage);
    expect(loadFilterPair(storage)).toEqual(pair);

    const old = { ...FILTER_DEFAULT_SETTINGS, cutoffHz: 1500 };
    storage.setItem(FILTER_STORAGE_KEY, filterSettingsToSearch(old));
    const loaded = loadFilterPair(storage);
    expect(loaded.primary).toEqual(old);
    expect(loaded.right).toBeUndefined();
    expect(loaded.editLane).toBe("left");
  });

  it("re-clamps both lanes at the loaded source rate", () => {
    const pair: FilterPairSettings = {
      primary: { ...FILTER_DEFAULT_SETTINGS, cutoffHz: 20_000 },
      right: { ...FILTER_DEFAULT_SETTINGS, cutoffHz: 23_000 },
      editLane: "left",
    };

    const adjusted = filterPairAtRate(pair, 44_100);

    expect(adjusted.primary.sampleRateHz).toBe(44_100);
    expect(adjusted.right?.sampleRateHz).toBe(44_100);
    expect(adjusted.primary.cutoffHz).toBe(20_000);
    expect(adjusted.right?.cutoffHz).toBeLessThan(22_050);
  });
});
