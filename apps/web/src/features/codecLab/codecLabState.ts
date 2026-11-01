/**
 * URL/state helpers for the F04 browser codec lab. Decoding is total: one bad
 * field falls back alone so an old share link opens a working view. The
 * excerpt defaults to a real sub-selection, else the first 30 s (AGENTS §9
 * live-preview budget); every explicit range is capped at 30 s because the
 * worker op rejects longer payloads.
 */

import { decodeParams, encodeParams } from "../../lib/url-state";
import type { CodecLabCodec } from "../../session/ops";

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

export type CodecLabSettings = {
  readonly codec: CodecLabCodec;
  readonly mdctBitsPerSecond: number;
  readonly startSample: number;
  readonly endSample: number;
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
  const kbps = Number(scalar("mbr"));
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
