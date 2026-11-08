import { describe, expect, it } from "vitest";

import {
  defaultSpeedRange,
  SPEED_DEFAULT_SETTINGS,
  speedLanes,
  speedSettingsFromSearch,
  speedSettingsToSearch,
} from "./speedState";

const SOURCE = { sampleCount: 48_000, sampleRateHz: 48_000 };
const FULL = { startSample: 0, endSample: 48_000 };

describe("speed state codec", () => {
  it("round-trips settings through the URL", () => {
    const settings = {
      ...SPEED_DEFAULT_SETTINGS,
      mode: "timeStretch" as const,
      speedFactor: 1.5,
      semitones: -3,
      reverse: true,
      startSample: 100,
      endSample: 20_000,
    };
    expect(speedSettingsFromSearch(`?${speedSettingsToSearch(settings)}`, SOURCE, FULL)).toEqual(
      settings,
    );
  });

  it("falls back per field on invalid values", () => {
    const settings = speedSettingsFromSearch("?sp=9&m=bogus&p=99&rv=2", SOURCE, FULL);
    expect(settings.speedFactor).toBe(SPEED_DEFAULT_SETTINGS.speedFactor);
    expect(settings.mode).toBe(SPEED_DEFAULT_SETTINGS.mode);
    expect(settings.semitones).toBe(SPEED_DEFAULT_SETTINGS.semitones);
    expect(settings.reverse).toBe(false);
    expect(settings.startSample).toBe(0);
    expect(settings.endSample).toBe(SOURCE.sampleCount);
  });

  it("round-trips independent lane reverse flags", () => {
    const settings = {
      ...SPEED_DEFAULT_SETTINGS,
      reverse: true,
      right: { reverse: false },
      editLane: "right" as const,
      startSample: 100,
      endSample: 20_000,
    };
    expect(speedSettingsFromSearch(`?${speedSettingsToSearch(settings)}`, SOURCE, FULL)).toEqual(
      settings,
    );
    expect(speedLanes(settings)).toEqual({
      left: { reverse: true },
      right: { reverse: false },
    });
  });

  it("keeps old links linked to the primary lane", () => {
    const settings = speedSettingsFromSearch("?rv=1", SOURCE, FULL);
    expect(settings.right).toBeUndefined();
    expect(settings.editLane).toBe("left");
    expect(speedLanes(settings).right).toEqual({ reverse: true });
  });

  it("falls back an invalid right reverse flag to the primary lane", () => {
    const settings = speedSettingsFromSearch("?rv=1&rrrv=x", SOURCE, FULL);
    expect(settings.right).toEqual({ reverse: true });
  });

  it("clamps an explicit range to the source", () => {
    const settings = speedSettingsFromSearch("?from=-10&to=999999", SOURCE, FULL);
    expect(settings.startSample).toBe(0);
    expect(settings.endSample).toBe(SOURCE.sampleCount);
    const inverted = speedSettingsFromSearch("?from=20000&to=100", SOURCE, FULL);
    expect(inverted.startSample).toBe(0);
    expect(inverted.endSample).toBe(SOURCE.sampleCount);
  });

  it("uses a non-empty sub-selection as the preview range", () => {
    expect(
      defaultSpeedRange(
        { startSample: 100, endSample: 200 },
        SOURCE.sampleCount,
        SOURCE.sampleRateHz,
      ),
    ).toEqual({ startSample: 100, endSample: 200 });
  });

  it("falls back to the first 30 s when the selection is the whole source", () => {
    expect(defaultSpeedRange({ startSample: 0, endSample: 2_400_000 }, 2_400_000, 48_000)).toEqual({
      startSample: 0,
      endSample: 1_440_000,
    });
    expect(defaultSpeedRange(FULL, 48_000, 48_000)).toEqual(FULL);
  });

  it("returns an empty range for an empty source", () => {
    expect(defaultSpeedRange(FULL, 0, 48_000)).toEqual({ startSample: 0, endSample: 0 });
  });
});
