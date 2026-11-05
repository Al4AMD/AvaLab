import { describe, expect, it } from "vitest";

import {
  CODEC_LAB_DEFAULT_SETTINGS,
  type CodecLabSettings,
  codecLabRangeFromSelection,
  codecLabSettingsFromSearch,
  codecLabSettingsToSearch,
  defaultCodecLabRange,
  isCodecLabStale,
  isRealCodecStale,
} from "./codecLabState";

const SOURCE = { sampleCount: 2_400_000, sampleRateHz: 48_000 };
const FULL = { startSample: 0, endSample: 2_400_000 };

describe("codec lab state codec", () => {
  it("round-trips every setting through the URL", () => {
    const settings: CodecLabSettings = {
      codec: "mdct",
      mdctBitsPerSecond: 320_000,
      mdctPsychoacoustic: true,
      mdctReferenceSplDb: 96,
      startSample: 4800,
      endSample: 52_800,
      realCodec: "vorbis",
      realBitrateKbps: 192,
      realQuality: 7,
      realCompressionLevel: 9,
    };
    expect(
      codecLabSettingsFromSearch(`?${codecLabSettingsToSearch(settings)}`, SOURCE, FULL),
    ).toEqual(settings);
  });

  it("falls back to RLE and clamps the MDCT bitrate", () => {
    expect(codecLabSettingsFromSearch("?c=bogus", SOURCE, FULL).codec).toBe("rle");
    expect(codecLabSettingsFromSearch("?mbr=1", SOURCE, FULL).mdctBitsPerSecond).toBe(32_000);
    expect(codecLabSettingsFromSearch("?mbr=999", SOURCE, FULL).mdctBitsPerSecond).toBe(512_000);
    expect(codecLabSettingsFromSearch("?mbr=100", SOURCE, FULL).mdctBitsPerSecond).toBe(96_000);
  });

  it("parses and clamps the psychoacoustic mode fields", () => {
    expect(codecLabSettingsFromSearch("?pm=1", SOURCE, FULL).mdctPsychoacoustic).toBe(true);
    expect(codecLabSettingsFromSearch("?pm=0", SOURCE, FULL).mdctPsychoacoustic).toBe(false);
    expect(codecLabSettingsFromSearch("?c=mdct", SOURCE, FULL).mdctPsychoacoustic).toBe(false);
    expect(codecLabSettingsFromSearch("?rspl=79", SOURCE, FULL).mdctReferenceSplDb).toBe(80);
    expect(codecLabSettingsFromSearch("?rspl=101", SOURCE, FULL).mdctReferenceSplDb).toBe(100);
    expect(codecLabSettingsFromSearch("?rspl=wat", SOURCE, FULL).mdctReferenceSplDb).toBe(94);
    expect(codecLabSettingsFromSearch("?rspl=", SOURCE, FULL).mdctReferenceSplDb).toBe(94);
  });

  it("marks the MDCT result stale when either mode field changes", () => {
    const result = { ...CODEC_LAB_DEFAULT_SETTINGS, startSample: 0, endSample: 24_000 };
    expect(isCodecLabStale(result, { ...result, mdctPsychoacoustic: false })).toBe(true);
    expect(isCodecLabStale(result, { ...result, mdctReferenceSplDb: 90 })).toBe(true);
  });

  it("clamps an explicit excerpt to the source and the 30 s cap", () => {
    expect(codecLabSettingsFromSearch("?from=-10&to=999999", SOURCE, FULL)).toMatchObject({
      startSample: 0,
      endSample: 999_999,
    });
    expect(codecLabSettingsFromSearch("?from=20000&to=100", SOURCE, FULL)).toMatchObject({
      startSample: 0,
      endSample: 30 * 48_000,
    });
    expect(codecLabSettingsFromSearch("?from=1000&to=1500000", SOURCE, FULL)).toMatchObject({
      startSample: 1000,
      endSample: 1000 + 30 * 48_000,
    });
  });

  it("defaults to the first 30 s or a real sub-selection", () => {
    expect(defaultCodecLabRange(FULL, SOURCE.sampleCount, SOURCE.sampleRateHz)).toEqual({
      startSample: 0,
      endSample: 30 * 48_000,
    });
    expect(
      defaultCodecLabRange(
        { startSample: 100, endSample: 200 },
        SOURCE.sampleCount,
        SOURCE.sampleRateHz,
      ),
    ).toEqual({ startSample: 100, endSample: 200 });
    expect(defaultCodecLabRange(FULL, 0, SOURCE.sampleRateHz)).toEqual({
      startSample: 0,
      endSample: 0,
    });
  });

  it("uses the store selection, capped at 30 s", () => {
    expect(
      codecLabRangeFromSelection(
        { startSample: 1200, endSample: 2400 },
        SOURCE.sampleCount,
        SOURCE.sampleRateHz,
      ),
    ).toEqual({ startSample: 1200, endSample: 2400 });
    expect(
      codecLabRangeFromSelection(
        { startSample: 1000, endSample: 1_500_000 },
        SOURCE.sampleCount,
        SOURCE.sampleRateHz,
      ),
    ).toEqual({ startSample: 1000, endSample: 1000 + 30 * 48_000 });
  });

  it("marks a result stale when any setting changes", () => {
    const result = { ...CODEC_LAB_DEFAULT_SETTINGS, startSample: 0, endSample: 24_000 };
    expect(isCodecLabStale(result, result)).toBe(false);
    expect(isCodecLabStale(result, { ...result, codec: "mdct" })).toBe(true);
    expect(isCodecLabStale(result, { ...result, mdctBitsPerSecond: 64_000 })).toBe(true);
    expect(isCodecLabStale(result, { ...result, endSample: 12_000 })).toBe(true);
  });

  it("round-trips and clamps the real-codec controls", () => {
    const parsed = codecLabSettingsFromSearch("?rc=mp3&rbr=999&rq=-4&rcl=99", SOURCE, FULL);
    expect(parsed).toMatchObject({
      realCodec: "mp3",
      realBitrateKbps: 256,
      realQuality: 0,
      realCompressionLevel: 12,
    });
    expect(codecLabSettingsFromSearch("?rc=bogus", SOURCE, FULL).realCodec).toBe("flac");
    expect(codecLabSettingsFromSearch("?rbr=70", SOURCE, FULL).realBitrateKbps).toBe(64);
  });

  it("marks only the real result stale when a real control changes", () => {
    const result = { ...CODEC_LAB_DEFAULT_SETTINGS, startSample: 0, endSample: 24_000 };
    expect(isRealCodecStale(result, result)).toBe(false);
    expect(isRealCodecStale(result, { ...result, realBitrateKbps: 64 })).toBe(true);
    expect(isRealCodecStale(result, { ...result, realCodec: "mp3" })).toBe(true);
    expect(isRealCodecStale(result, { ...result, mdctBitsPerSecond: 64_000 })).toBe(false);
  });
});
