import { describe, expect, it } from "vitest";

import {
  defaultExtentRange,
  defaultExtentTruncateLength,
  EXTENT_DEFAULT_SETTINGS,
  extentSettingsFromSearch,
  extentSettingsToSearch,
} from "./extentState";

const SOURCE = { sampleCount: 48_000, sampleRateHz: 48_000 };
const FULL = { startSample: 0, endSample: 48_000 };

describe("extent state codec", () => {
  it("round-trips settings through the URL", () => {
    const settings = {
      ...EXTENT_DEFAULT_SETTINGS,
      operation: "zeroPad" as const,
      shiftSamples: -120,
      scaleFactor: 0.5,
      truncateStartSample: 100,
      truncateLengthSamples: 2000,
      padStartSamples: 10,
      padEndSamples: 20,
      repetitions: 4,
      startSample: 100,
      endSample: 20_000,
    };
    expect(extentSettingsFromSearch(`?${extentSettingsToSearch(settings)}`, SOURCE, FULL)).toEqual(
      settings,
    );
  });

  it("falls back per field on invalid values", () => {
    const settings = extentSettingsFromSearch(
      "?op=bogus&sh=1.5&sf=0&ts=-1&tl=x&ps=-2&pe=x&rp=0",
      SOURCE,
      FULL,
    );
    expect(settings.operation).toBe("identity");
    expect(settings.shiftSamples).toBe(0);
    expect(settings.scaleFactor).toBe(EXTENT_DEFAULT_SETTINGS.scaleFactor);
    expect(settings.truncateStartSample).toBe(0);
    expect(settings.truncateLengthSamples).toBe(48_000);
    expect(settings.padStartSamples).toBe(0);
    expect(settings.padEndSamples).toBe(0);
    expect(settings.repetitions).toBe(1);
  });

  it("clamps shift, factor, truncation and repetitions", () => {
    expect(extentSettingsFromSearch("?sh=-999999", SOURCE, FULL).shiftSamples).toBe(-48_000);
    expect(extentSettingsFromSearch("?sh=999999", SOURCE, FULL).shiftSamples).toBe(48_000);
    expect(extentSettingsFromSearch("?sf=0.01", SOURCE, FULL).scaleFactor).toBe(0.25);
    expect(extentSettingsFromSearch("?sf=99", SOURCE, FULL).scaleFactor).toBe(4);
    expect(extentSettingsFromSearch("?ts=999999", SOURCE, FULL).truncateStartSample).toBe(48_000);
    expect(extentSettingsFromSearch("?tl=999999", SOURCE, FULL).truncateLengthSamples).toBe(48_000);
    expect(extentSettingsFromSearch("?rp=99", SOURCE, FULL).repetitions).toBe(16);
  });

  it("defaults truncation to one second of the source", () => {
    expect(defaultExtentTruncateLength(SOURCE)).toBe(48_000);
    expect(defaultExtentTruncateLength({ sampleCount: 12_000, sampleRateHz: 48_000 })).toBe(12_000);
    expect(defaultExtentTruncateLength({ sampleCount: 0, sampleRateHz: 48_000 })).toBe(0);
  });

  it("clamps an explicit range to the source", () => {
    expect(extentSettingsFromSearch("?from=-10&to=999999", SOURCE, FULL)).toMatchObject({
      startSample: 0,
      endSample: 48_000,
    });
    expect(extentSettingsFromSearch("?from=20000&to=100", SOURCE, FULL)).toMatchObject({
      startSample: 0,
      endSample: 48_000,
    });
  });

  it("uses a non-empty sub-selection as the preview range", () => {
    expect(
      defaultExtentRange({ startSample: 100, endSample: 200 }, SOURCE.sampleCount, 48_000),
    ).toEqual({ startSample: 100, endSample: 200 });
    expect(defaultExtentRange({ startSample: 0, endSample: 2_400_000 }, 2_400_000, 48_000)).toEqual(
      {
        startSample: 0,
        endSample: 1_440_000,
      },
    );
    expect(defaultExtentRange(FULL, 0, 48_000)).toEqual({ startSample: 0, endSample: 0 });
  });
});
