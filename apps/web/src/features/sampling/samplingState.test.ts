import { describe, expect, it } from "vitest";

import {
  defaultSamplingRange,
  SAMPLING_DEFAULT_SETTINGS,
  samplingLanes,
  samplingSettingsFromSearch,
  samplingSettingsToSearch,
} from "./samplingState";

const SOURCE = { sampleCount: 48_000, sampleRateHz: 48_000 };
const FULL = { startSample: 0, endSample: 48_000 };

describe("sampling state codec", () => {
  it("round-trips settings through the URL", () => {
    const settings = {
      ...SAMPLING_DEFAULT_SETTINGS,
      targetRateHz: 8000,
      antiAlias: false,
      bits: 8,
      dither: true,
      seed: 7,
      startSample: 100,
      endSample: 20_000,
    };
    expect(
      samplingSettingsFromSearch(`?${samplingSettingsToSearch(settings)}`, SOURCE, FULL),
    ).toEqual(settings);
  });

  it("falls back per field on invalid values", () => {
    const settings = samplingSettingsFromSearch("?tr=0&aa=9&bd=99&dt=2&seed=x", SOURCE, FULL);
    expect(settings.targetRateHz).toBe(SOURCE.sampleRateHz);
    expect(settings.antiAlias).toBe(SAMPLING_DEFAULT_SETTINGS.antiAlias);
    expect(settings.bits).toBe(SAMPLING_DEFAULT_SETTINGS.bits);
    expect(settings.dither).toBe(false);
    expect(settings.seed).toBe(SAMPLING_DEFAULT_SETTINGS.seed);
    expect(settings.startSample).toBe(0);
    expect(settings.endSample).toBe(SOURCE.sampleCount);
  });

  it("round-trips independent lane bit depths and dither", () => {
    const settings = {
      ...SAMPLING_DEFAULT_SETTINGS,
      bits: 12,
      dither: false,
      right: { bits: 4, dither: true },
      editLane: "right" as const,
      startSample: 100,
      endSample: 20_000,
    };
    expect(
      samplingSettingsFromSearch(`?${samplingSettingsToSearch(settings)}`, SOURCE, FULL),
    ).toEqual(settings);
    expect(samplingLanes(settings)).toEqual({
      left: { bits: 12, dither: false },
      right: { bits: 4, dither: true },
    });
  });

  it("keeps old links linked to the primary lane", () => {
    const settings = samplingSettingsFromSearch("?bd=8&dt=1", SOURCE, FULL);
    expect(settings.right).toBeUndefined();
    expect(settings.editLane).toBe("left");
    expect(samplingLanes(settings).right).toEqual({ bits: 8, dither: true });
  });

  it("falls back invalid right-lane fields to the primary lane", () => {
    const settings = samplingSettingsFromSearch("?bd=6&dt=0&rrbd=x&rrdt=x", SOURCE, FULL);
    expect(settings.right).toEqual({ bits: 6, dither: false });
  });

  it("clamps an explicit range to the source", () => {
    const settings = samplingSettingsFromSearch("?from=-10&to=999999", SOURCE, FULL);
    expect(settings.startSample).toBe(0);
    expect(settings.endSample).toBe(SOURCE.sampleCount);
    const inverted = samplingSettingsFromSearch("?from=20000&to=100", SOURCE, FULL);
    expect(inverted.startSample).toBe(0);
    expect(inverted.endSample).toBe(SOURCE.sampleCount);
  });

  it("clamps target rates and bits into the lab range", () => {
    expect(samplingSettingsFromSearch("?tr=1000", SOURCE, FULL).targetRateHz).toBe(1000);
    expect(samplingSettingsFromSearch("?tr=96000", SOURCE, FULL).targetRateHz).toBe(96_000);
    expect(samplingSettingsFromSearch("?tr=999999", SOURCE, FULL).targetRateHz).toBe(48_000);
    expect(samplingSettingsFromSearch("?tr=8000.5", SOURCE, FULL).targetRateHz).toBe(48_000);
    expect(samplingSettingsFromSearch("?bd=0", SOURCE, FULL).bits).toBe(1);
    expect(samplingSettingsFromSearch("?bd=16", SOURCE, FULL).bits).toBe(16);
    expect(samplingSettingsFromSearch("?bd=17", SOURCE, FULL).bits).toBe(16);
  });

  it("uses a non-empty sub-selection as the preview range", () => {
    expect(
      defaultSamplingRange(
        { startSample: 100, endSample: 200 },
        SOURCE.sampleCount,
        SOURCE.sampleRateHz,
      ),
    ).toEqual({ startSample: 100, endSample: 200 });
  });

  it("falls back to the first 30 s when the selection is the whole source", () => {
    expect(
      defaultSamplingRange({ startSample: 0, endSample: 2_400_000 }, 2_400_000, 48_000),
    ).toEqual({ startSample: 0, endSample: 1_440_000 });
    expect(defaultSamplingRange(FULL, 48_000, 48_000)).toEqual(FULL);
  });

  it("returns an empty range for an empty source", () => {
    expect(defaultSamplingRange(FULL, 0, 48_000)).toEqual({ startSample: 0, endSample: 0 });
  });
});
