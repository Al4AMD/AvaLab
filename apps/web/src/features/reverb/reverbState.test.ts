import { describe, expect, it } from "vitest";

import {
  defaultReverbRange,
  REVERB_DEFAULT_SETTINGS,
  reverbPresetDefaults,
  reverbSettingsFromSearch,
  reverbSettingsToSearch,
} from "./reverbState";

const SOURCE = { sampleCount: 48_000, sampleRateHz: 48_000 };
const FULL = { startSample: 0, endSample: 48_000 };

describe("reverb state codec", () => {
  it("round-trips settings through the URL", () => {
    const settings = {
      ...REVERB_DEFAULT_SETTINGS,
      irKind: "plate" as const,
      rt60Seconds: 2.5,
      irDurationSeconds: 3,
      seed: 99,
      preDelayMs: 25,
      wetMix: 0.75,
      method: "direct" as const,
      startSample: 100,
      endSample: 20_000,
    };
    expect(reverbSettingsFromSearch(`?${reverbSettingsToSearch(settings)}`, SOURCE, FULL)).toEqual(
      settings,
    );
  });

  it("round-trips the upload choice without audio", () => {
    const settings = {
      ...REVERB_DEFAULT_SETTINGS,
      irKind: "upload" as const,
      startSample: 100,
      endSample: 20_000,
    };
    expect(reverbSettingsFromSearch(`?${reverbSettingsToSearch(settings)}`, SOURCE, FULL)).toEqual(
      settings,
    );
  });

  it("falls back per field on invalid values", () => {
    const settings = reverbSettingsFromSearch(
      "?ir=bogus&rt=x&du=-1&sd=1.5&pd=-2&wm=2&me=other",
      SOURCE,
      FULL,
    );
    expect(settings.irKind).toBe(REVERB_DEFAULT_SETTINGS.irKind);
    expect(settings.rt60Seconds).toBe(reverbPresetDefaults("hall").rt60Seconds);
    expect(settings.irDurationSeconds).toBe(reverbPresetDefaults("hall").durationSeconds);
    expect(settings.seed).toBe(REVERB_DEFAULT_SETTINGS.seed);
    expect(settings.preDelayMs).toBe(REVERB_DEFAULT_SETTINGS.preDelayMs);
    expect(settings.wetMix).toBe(1);
    expect(settings.method).toBe(REVERB_DEFAULT_SETTINGS.method);
  });

  it("clamps RT60, duration, seed, pre-delay and wet mix", () => {
    expect(reverbSettingsFromSearch("?rt=99", SOURCE, FULL).rt60Seconds).toBe(5);
    expect(reverbSettingsFromSearch("?rt=0.01", SOURCE, FULL).rt60Seconds).toBe(0.1);
    expect(reverbSettingsFromSearch("?du=99", SOURCE, FULL).irDurationSeconds).toBe(10);
    expect(reverbSettingsFromSearch("?du=0.001", SOURCE, FULL).irDurationSeconds).toBe(0.05);
    expect(reverbSettingsFromSearch("?sd=-5", SOURCE, FULL).seed).toBe(0);
    expect(reverbSettingsFromSearch("?pd=9999", SOURCE, FULL).preDelayMs).toBe(500);
    expect(reverbSettingsFromSearch("?wm=-1", SOURCE, FULL).wetMix).toBe(
      REVERB_DEFAULT_SETTINGS.wetMix,
    );
  });

  it("uses preset defaults when the URL omits duration and RT60", () => {
    const telephone = reverbPresetDefaults("telephone");
    expect(reverbSettingsFromSearch("?ir=telephone", SOURCE, FULL)).toMatchObject({
      irDurationSeconds: telephone.durationSeconds,
      rt60Seconds: telephone.rt60Seconds,
    });
    expect(reverbPresetDefaults("upload")).toEqual(reverbPresetDefaults("hall"));
  });

  it("uses a non-empty sub-selection as the preview range", () => {
    expect(
      defaultReverbRange({ startSample: 100, endSample: 200 }, SOURCE.sampleCount, 48_000),
    ).toEqual({ startSample: 100, endSample: 200 });
    expect(defaultReverbRange(FULL, SOURCE.sampleCount, 48_000)).toEqual({
      startSample: 0,
      endSample: 48_000,
    });
    expect(defaultReverbRange({ startSample: 0, endSample: 2_400_000 }, 2_400_000, 48_000)).toEqual(
      {
        startSample: 0,
        endSample: 1_440_000,
      },
    );
    expect(defaultReverbRange(FULL, 0, 48_000)).toEqual({ startSample: 0, endSample: 0 });
  });
});
