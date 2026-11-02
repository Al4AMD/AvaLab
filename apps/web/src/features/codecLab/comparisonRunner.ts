/**
 * F04/F05 comparison batch (Wave-4 Plan 04 Task 2).
 *
 * Pure orchestration: the view injects the worker and backend runners, this
 * module only sequences them, records failures as rows, and forwards progress.
 * One excerpt and one request in flight at a time; cancel stops the queue.
 */
import type { CodecLabCodec, CodecLabMeta } from "../../session/ops";
import {
  RealCodecError,
  type RealCodecName,
  type RealCodecParams,
  type RealCodecRun,
} from "./backendCodecs";
import { type ComparisonRow, handwrittenRow, realRow } from "./comparison";

export type ComparisonRequest =
  | {
      readonly kind: "handwritten";
      readonly codec: CodecLabCodec;
      readonly mdctBitsPerSecond: number;
    }
  | { readonly kind: "real"; readonly codec: RealCodecName; readonly params: RealCodecParams };

export const COMPARISON_EXCERPT_SECONDS = 30;

const DEFAULT_MDCT_BITS_PER_SECOND = 128_000;
const REAL_DEFAULT_BITRATE_KBPS = 128;

function defaultRealParams(codec: RealCodecName): RealCodecParams {
  switch (codec) {
    case "mp3":
    case "aac":
    case "opus":
      return { codec, bitrateKbps: REAL_DEFAULT_BITRATE_KBPS };
    case "vorbis":
      return { codec, quality: 5 };
    case "flac":
      return { codec, compressionLevel: 5 };
    case "wav":
      return { codec };
  }
}

export function defaultComparisonRequests(
  availableReal: readonly RealCodecName[],
): ComparisonRequest[] {
  const handwritten: ComparisonRequest[] = [
    { kind: "handwritten", codec: "rle", mdctBitsPerSecond: DEFAULT_MDCT_BITS_PER_SECOND },
    { kind: "handwritten", codec: "huffman", mdctBitsPerSecond: DEFAULT_MDCT_BITS_PER_SECOND },
    {
      kind: "handwritten",
      codec: "deltaHuffman",
      mdctBitsPerSecond: DEFAULT_MDCT_BITS_PER_SECOND,
    },
    { kind: "handwritten", codec: "mulaw", mdctBitsPerSecond: DEFAULT_MDCT_BITS_PER_SECOND },
    { kind: "handwritten", codec: "alaw", mdctBitsPerSecond: DEFAULT_MDCT_BITS_PER_SECOND },
    { kind: "handwritten", codec: "mdct", mdctBitsPerSecond: 64_000 },
    { kind: "handwritten", codec: "mdct", mdctBitsPerSecond: 128_000 },
    { kind: "handwritten", codec: "mdct", mdctBitsPerSecond: 256_000 },
  ];
  return [
    ...handwritten,
    ...availableReal.map(
      (codec): ComparisonRequest => ({ kind: "real", codec, params: defaultRealParams(codec) }),
    ),
  ];
}

function labelKeyFor(request: ComparisonRequest): string {
  return request.kind === "handwritten"
    ? `codecLab.codec.${request.codec}`
    : `codecLab.real.codec.${request.codec}`;
}

function failedRow(request: ComparisonRequest, index: number, errorKey: string): ComparisonRow {
  return {
    id: `error:${index}:${request.kind}:${request.codec}`,
    family: request.kind === "handwritten" ? "handwritten" : "real",
    codec: request.codec,
    labelKey: labelKeyFor(request),
    bitrateKbps: Number.NaN,
    compressionRatio: Number.NaN,
    snrDb: Number.NaN,
    psnrDb: Number.NaN,
    encodeMs: Number.NaN,
    bitExact: false,
    lossless: false,
    sampleCount: 0,
    errorKey,
  };
}

function errorKeyOf(error: unknown): string {
  return error instanceof RealCodecError ? error.messageKey : "codecLab.error.failed";
}

export type ComparisonRunners = {
  readonly runHandwritten: (
    request: Extract<ComparisonRequest, { kind: "handwritten" }>,
  ) => Promise<CodecLabMeta>;
  readonly runReal: (
    request: Extract<ComparisonRequest, { kind: "real" }>,
  ) => Promise<RealCodecRun>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (completed: number, total: number, row: ComparisonRow) => void;
};

export async function runComparison(
  _input: {
    readonly samples: Float32Array;
    readonly sampleRateHz: number;
    readonly startSample: number;
    readonly endSample: number;
  },
  requests: readonly ComparisonRequest[],
  options: ComparisonRunners,
): Promise<ComparisonRow[]> {
  const rows: ComparisonRow[] = [];
  for (let index = 0; index < requests.length; index += 1) {
    if (options.signal?.aborted) {
      break;
    }
    const request = requests[index];
    if (request === undefined) {
      break;
    }
    let row: ComparisonRow;
    try {
      if (request.kind === "handwritten") {
        const meta = await options.runHandwritten(request);
        row = handwrittenRow(meta, labelKeyFor(request));
      } else {
        const run = await options.runReal(request);
        row = realRow(run, request.codec, labelKeyFor(request));
      }
    } catch (error) {
      if (options.signal?.aborted) {
        break;
      }
      row = failedRow(request, index, errorKeyOf(error));
    }
    rows.push(row);
    options.onProgress?.(rows.length, requests.length, row);
  }
  return rows;
}

export type RateDistortionPoints = {
  readonly bitrateKbps: number[];
  readonly snrDb: number[];
  readonly psnrDb: number[];
  readonly labels: string[];
};

export type RateDistortionQuality = "snrDb" | "psnrDb";

export function rateDistortionPoints(
  rows: readonly ComparisonRow[],
  quality: RateDistortionQuality = "snrDb",
): RateDistortionPoints {
  const bitrateKbps: number[] = [];
  const snrDb: number[] = [];
  const psnrDb: number[] = [];
  const labels: string[] = [];
  for (const row of rows) {
    if (
      row.errorKey !== undefined ||
      !Number.isFinite(row.bitrateKbps) ||
      row.bitrateKbps <= 0 ||
      !Number.isFinite(row[quality])
    ) {
      continue;
    }
    bitrateKbps.push(row.bitrateKbps);
    snrDb.push(row.snrDb);
    psnrDb.push(row.psnrDb);
    labels.push(row.labelKey);
  }
  return { bitrateKbps, snrDb, psnrDb, labels };
}
