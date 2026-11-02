/**
 * URL/state helpers for the F04 browser codec lab. Decoding is total: one bad
 * field falls back alone so an old share link opens a working view. The
 * excerpt defaults to a real sub-selection, else the first 30 s (AGENTS §9
 * live-preview budget); every explicit range is capped at 30 s because the
 * worker op rejects longer payloads.
 */

import { decodeParams, encodeParams } from "../../lib/url-state";
import type { CodecLabCodec } from "../../session/ops";
import { REAL_CODEC_NAMES, type RealCodecName } from "./backendCodecs";

export const CODEC_LAB_CODECS: readonly CodecLabCodec[] = [
  "rle",
  "huffman",
  "deltaHuffman",
  "mulaw",
  "alaw",
  "mdct",
];

export const CODEC_LAB_MDCT_KBPS = [32, 64, 96, 128, 192, 256, 320, 512] as const;
export const CODEC_LAB_DEFAULT_MDCT_KBPS = 128;
export const CODEC_LAB_PREVIEW_SECONDS = 30;
export const CODEC_LAB_MIN_MDCT_KBPS = 32;
export const CODEC_LAB_MAX_MDCT_KBPS = 512;
export const CODEC_LAB_REAL_BITRATES_KBPS = [32, 64, 96, 128, 192, 256] as const;
export const CODEC_LAB_DEFAULT_REAL_BITRATE_KBPS = 128;
export const CODEC_LAB_REAL_QUALITY_MIN = 0;
export const CODEC_LAB_REAL_QUALITY_MAX = 10;
export const CODEC_LAB_REAL_COMPRESSION_MIN = 0;
export const CODEC_LAB_REAL_COMPRESSION_MAX = 12;

export type CodecLabSettings = {
  readonly codec: CodecLabCodec;
  readonly mdctBitsPerSecond: number;
  readonly startSample: number;
  readonly endSample: number;
  readonly realCodec: RealCodecName;
  readonly realBitrateKbps: number;
  readonly realQuality: number;
  readonly realCompressionLevel: number;
};

export type CodecLabRange = { readonly startSample: number; readonly endSample: number };

export type CodecLabSourceInfo = {
  readonly sampleCount: number;
  readonly sampleRateHz: number;
};

export const CODEC_LAB_DEFAULT_SETTINGS: CodecLabSettings = {
  codec: "rle",
  mdctBitsPerSecond: CODEC_LAB_DEFAULT_MDCT_KBPS * 1000,
  startSample: 0,
  endSample: 0,
  realCodec: "flac",
  realBitrateKbps: CODEC_LAB_DEFAULT_REAL_BITRATE_KBPS,
  realQuality: 5,
  realCompressionLevel: 5,
};

function clampRange(
  start: number,
  end: number,
  sampleCount: number,
  sampleRateHz: number,
): CodecLabRange {
  if (sampleCount <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  const clampedStart = Math.max(0, Math.min(Math.round(start), sampleCount));
  const clampedEnd = Math.max(clampedStart, Math.min(Math.round(end), sampleCount));
  const capSamples = Math.max(1, Math.round(CODEC_LAB_PREVIEW_SECONDS * sampleRateHz));
  return {
    startSample: clampedStart,
    endSample: Math.min(clampedEnd, clampedStart + capSamples),
  };
}

/** A real sub-selection when the user made one, otherwise the first 30 s. */
export function defaultCodecLabRange(
  selection: CodecLabRange,
  sampleCount: number,
  sampleRateHz: number,
): CodecLabRange {
  if (sampleCount <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  const selected = clampRange(
    selection.startSample,
    selection.endSample,
    sampleCount,
    sampleRateHz,
  );
  const isSubSelection = selected.startSample > 0 || selected.endSample < sampleCount;
  if (isSubSelection && selected.endSample > selected.startSample) {
    return selected;
  }
  return clampRange(0, sampleCount, sampleCount, sampleRateHz);
}

/** "Use selection" keeps the store's range (already clamped by the store). */
export function codecLabRangeFromSelection(
  selection: CodecLabRange,
  sampleCount: number,
  sampleRateHz: number,
): CodecLabRange {
  return clampRange(selection.startSample, selection.endSample, sampleCount, sampleRateHz);
}

function clampInteger(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function snapRealBitrate(raw: number): number {
  if (!Number.isFinite(raw)) {
    return CODEC_LAB_DEFAULT_REAL_BITRATE_KBPS;
  }
  const minKbps = CODEC_LAB_REAL_BITRATES_KBPS[0] ?? 32;
  const maxKbps = CODEC_LAB_REAL_BITRATES_KBPS[CODEC_LAB_REAL_BITRATES_KBPS.length - 1] ?? 256;
  const clamped = Math.max(minKbps, Math.min(maxKbps, Math.round(raw)));
  return CODEC_LAB_REAL_BITRATES_KBPS.reduce((best, candidate) =>
    Math.abs(candidate - clamped) < Math.abs(best - clamped) ? candidate : best,
  );
}

function snapMdctKbps(raw: number): number {
  const clamped = Math.max(
    CODEC_LAB_MIN_MDCT_KBPS,
    Math.min(CODEC_LAB_MAX_MDCT_KBPS, Math.round(raw)),
  );
  return CODEC_LAB_MDCT_KBPS.reduce((best, candidate) =>
    Math.abs(candidate - clamped) < Math.abs(best - clamped) ? candidate : best,
  );
}

export function codecLabSettingsToSearch(settings: CodecLabSettings): string {
  return encodeParams({
    c: settings.codec,
    from: settings.startSample,
    mbr: settings.mdctBitsPerSecond / 1000,
    rc: settings.realCodec,
    rbr: settings.realBitrateKbps,
    rcl: settings.realCompressionLevel,
    rq: settings.realQuality,
    to: settings.endSample,
  });
}

export function codecLabSettingsFromSearch(
  search: string,
  source: CodecLabSourceInfo,
  selection: CodecLabRange,
): CodecLabSettings {
  const decoded = decodeParams(search);
  const scalar = (key: string): string | undefined => {
    const value = decoded[key];
    return typeof value === "string" ? value : undefined;
  };
  const codec = scalar("c");
  const realCodec = scalar("rc");
  const kbps = Number(scalar("mbr"));
  const realBitrate = Number(scalar("rbr"));
  const realQuality = Number(scalar("rq"));
  const realCompression = Number(scalar("rcl"));
  const fallbackRange = defaultCodecLabRange(selection, source.sampleCount, source.sampleRateHz);
  const from = Number(scalar("from"));
  const to = Number(scalar("to"));
  const explicitRange =
    Number.isSafeInteger(from) && Number.isSafeInteger(to)
      ? clampRange(from, to, source.sampleCount, source.sampleRateHz)
      : null;
  const range =
    explicitRange !== null && explicitRange.endSample > explicitRange.startSample
      ? explicitRange
      : fallbackRange;
  return {
    codec: CODEC_LAB_CODECS.includes(codec as CodecLabCodec)
      ? (codec as CodecLabCodec)
      : CODEC_LAB_DEFAULT_SETTINGS.codec,
    mdctBitsPerSecond:
      (Number.isFinite(kbps) ? snapMdctKbps(kbps) : CODEC_LAB_DEFAULT_MDCT_KBPS) * 1000,
    startSample: range.startSample,
    endSample: range.endSample,
    realCodec: (REAL_CODEC_NAMES as readonly string[]).includes(realCodec ?? "")
      ? (realCodec as RealCodecName)
      : CODEC_LAB_DEFAULT_SETTINGS.realCodec,
    realBitrateKbps: snapRealBitrate(realBitrate),
    realQuality: clampInteger(
      realQuality,
      CODEC_LAB_REAL_QUALITY_MIN,
      CODEC_LAB_REAL_QUALITY_MAX,
      CODEC_LAB_DEFAULT_SETTINGS.realQuality,
    ),
    realCompressionLevel: clampInteger(
      realCompression,
      CODEC_LAB_REAL_COMPRESSION_MIN,
      CODEC_LAB_REAL_COMPRESSION_MAX,
      CODEC_LAB_DEFAULT_SETTINGS.realCompressionLevel,
    ),
  };
}

export function isCodecLabStale(
  current: CodecLabSettings,
  resultSettings: CodecLabSettings,
): boolean {
  return (
    current.codec !== resultSettings.codec ||
    current.mdctBitsPerSecond !== resultSettings.mdctBitsPerSecond ||
    current.startSample !== resultSettings.startSample ||
    current.endSample !== resultSettings.endSample
  );
}

export function isRealCodecStale(
  current: CodecLabSettings,
  resultSettings: CodecLabSettings,
): boolean {
  return (
    current.realCodec !== resultSettings.realCodec ||
    current.realBitrateKbps !== resultSettings.realBitrateKbps ||
    current.realQuality !== resultSettings.realQuality ||
    current.realCompressionLevel !== resultSettings.realCompressionLevel ||
    current.startSample !== resultSettings.startSample ||
    current.endSample !== resultSettings.endSample
  );
}
