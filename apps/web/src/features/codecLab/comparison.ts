/**
 * F04/F05 comparison rows (Wave-4 Plan 04 Task 1).
 *
 * Pure model only: the codec lab view builds one row from the last
 * hand-written result and one from the last real result. Numbers are kept as
 * measured (bitrate is the actual stream bitrate, never the requested preset)
 * and the CSV path stays locale-free.
 */
import type { CodecLabMeta } from "../../session/ops";
import type { SessionSource } from "../../session/store";
import { computeQualityMetrics } from "../metrics/metrics";
import type { RealCodecName, RealCodecRun } from "./backendCodecs";

export type ComparisonFamily = "handwritten" | "real";

export type ComparisonRow = {
  id: string;
  family: ComparisonFamily;
  codec: string;
  labelKey: string;
  bitrateKbps: number;
  compressionRatio: number;
  snrDb: number;
  psnrDb: number;
  encodeMs: number;
  bitExact: boolean;
  lossless: boolean;
  sampleCount: number;
  errorKey?: string;
};

const LOSSLESS_HANDWRITTEN = new Set(["rle", "huffman", "deltaHuffman"]);

export function handwrittenRow(meta: CodecLabMeta, labelKey: string): ComparisonRow {
  return {
    id: `handwritten:${meta.codec}:${meta.bitrateKbps}:${meta.sampleCount}`,
    family: "handwritten",
    codec: meta.codec,
    labelKey,
    bitrateKbps: meta.bitrateKbps,
    compressionRatio: meta.compressionRatio,
    snrDb: meta.snrDb,
    psnrDb: meta.psnrDb,
    encodeMs: meta.encodeMs,
    bitExact: meta.bitExact,
    lossless: LOSSLESS_HANDWRITTEN.has(meta.codec),
    sampleCount: meta.sampleCount,
  };
}

export function realRow(run: RealCodecRun, codec: RealCodecName, labelKey: string): ComparisonRow {
  const stats = run.stats;
  const originalBytes = run.reference.length * 2;
  let snrDb = Number.NaN;
  let psnrDb = Number.NaN;
  try {
    const metrics = computeQualityMetrics(run.reference, run.decoded, stats.sampleRateHz);
    snrDb = metrics.snrDb;
    psnrDb = metrics.psnrDb;
  } catch {
    // The view records the row and shows NaN when alignment metadata is bad.
  }
  return {
    id: `real:${codec}:${stats.bitrateKbps}:${stats.alignedSampleCount}`,
    family: "real",
    codec,
    labelKey,
    bitrateKbps: stats.bitrateKbps,
    compressionRatio: stats.sizeBytes > 0 ? originalBytes / stats.sizeBytes : Infinity,
    snrDb,
    psnrDb,
    encodeMs: stats.encodeMs,
    bitExact: stats.bitExact,
    lossless: stats.lossless,
    sampleCount: stats.alignedSampleCount,
  };
}

export function sortComparisonRows(rows: readonly ComparisonRow[]): ComparisonRow[] {
  return [...rows].sort((a, b) => {
    const aError = a.errorKey !== undefined;
    const bError = b.errorKey !== undefined;
    if (aError !== bError) {
      return aError ? 1 : -1;
    }
    if (!aError) {
      const aRate = Number.isFinite(a.bitrateKbps) ? a.bitrateKbps : Infinity;
      const bRate = Number.isFinite(b.bitrateKbps) ? b.bitrateKbps : Infinity;
      if (aRate !== bRate) {
        return aRate - bRate;
      }
    }
    const byLabel = a.labelKey.localeCompare(b.labelKey);
    return byLabel !== 0 ? byLabel : a.id.localeCompare(b.id);
  });
}

function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function numberField(value: number): string {
  if (Number.isNaN(value)) {
    return "NaN";
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? "Infinity" : "-Infinity";
  }
  return value.toFixed(3);
}

export function comparisonToCsv(rows: readonly ComparisonRow[]): string {
  const header = [
    "id",
    "family",
    "codec",
    "label_key",
    "bitrate_kbps",
    "compression_ratio",
    "snr_db",
    "psnr_db",
    "encode_ms",
    "bit_exact",
    "lossless",
    "sample_count",
    "error_key",
  ].join(",");
  const lines = sortComparisonRows(rows).map((row) =>
    [
      field(row.id),
      row.family,
      field(row.codec),
      field(row.labelKey),
      numberField(row.bitrateKbps),
      numberField(row.compressionRatio),
      numberField(row.snrDb),
      numberField(row.psnrDb),
      numberField(row.encodeMs),
      String(row.bitExact),
      String(row.lossless),
      String(row.sampleCount),
      field(row.errorKey ?? ""),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

let latestPublished: {
  readonly source: SessionSource | null;
  readonly rows: readonly ComparisonRow[];
} = { source: null, rows: [] };

/** Keep the last codec-lab table available to the AI neural-codec chart. */
export function publishCodecComparisonRows(
  source: SessionSource | null,
  rows: readonly ComparisonRow[],
): void {
  latestPublished = { source, rows };
}

/** Return rows only for the same immutable source object; stale audio is ignored. */
export function publishedCodecComparisonRows(
  source: SessionSource | null,
): readonly ComparisonRow[] {
  return source !== null && latestPublished.source === source ? latestPublished.rows : [];
}
