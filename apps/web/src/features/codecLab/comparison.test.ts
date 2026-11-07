import { describe, expect, it } from "vitest";

import type { CodecLabMeta } from "../../session/ops";
import type { RealCodecRun } from "./backendCodecs";
import {
  type ComparisonRow,
  comparisonToCsv,
  handwrittenRow,
  realRow,
  sortComparisonRows,
} from "./comparison";

function meta(patch: Partial<CodecLabMeta> = {}): CodecLabMeta {
  return {
    codec: "rle",
    sampleCount: 1000,
    sampleRateHz: 48_000,
    startSample: 0,
    endSample: 1000,
    originalBytes: 2000,
    compressedSizeBytes: 500,
    bitsPerSample: 4,
    bitrateKbps: 192,
    compressionRatio: 4,
    entropyBitsPerSymbol: 7.2,
    encodeMs: 12,
    decodeMs: 3,
    bitExact: true,
    mse: 0,
    snrDb: Infinity,
    segmentalSnrDb: Infinity,
    psnrDb: Infinity,
    histogram: [],
    codeLengths: [],
    coefficientSparsity: null,
    frameCount: null,
    bitsTotal: null,
    psychoacoustic: false,
    mdctEntropyBits: null,
    mdctSideInfoBits: null,
    mdctMaskedFraction: null,
    mdctBands: null,
    ...patch,
  };
}

function realRun(patch: Partial<RealCodecRun["stats"]> = {}): RealCodecRun {
  const decoded = new Float32Array(1000).fill(0.25);
  return {
    reference: new Float32Array(1000).fill(0.5),
    decoded,
    channels: [decoded],
    stats: {
      resultAudioId: "abc",
      sizeBytes: 500,
      bitrateKbps: 64,
      encodeMs: 42,
      codecDelaySamples: 12,
      referenceStartSample: 0,
      alignedSampleCount: 1000,
      durationSeconds: 1,
      sampleRateHz: 48_000,
      channels: 1,
      bitExact: false,
      lossless: false,
      ...patch,
    },
  };
}

describe("handwrittenRow", () => {
  it("maps the measured meta and marks only the lossless hand-written codecs", () => {
    const row = handwrittenRow(meta(), "codecLab.codec.rle");
    expect(row).toMatchObject({
      family: "handwritten",
      codec: "rle",
      labelKey: "codecLab.codec.rle",
      bitrateKbps: 192,
      compressionRatio: 4,
      snrDb: Infinity,
      psnrDb: Infinity,
      encodeMs: 12,
      bitExact: true,
      lossless: true,
      sampleCount: 1000,
    });
    expect(handwrittenRow(meta({ codec: "deltaHuffman" }), "k").lossless).toBe(true);
    expect(handwrittenRow(meta({ codec: "mdct" }), "k").lossless).toBe(false);
    expect(handwrittenRow(meta({ codec: "mulaw" }), "k").lossless).toBe(false);
  });

  it("keeps MDCT rates as separate row ids", () => {
    const first = handwrittenRow(meta({ codec: "mdct", bitrateKbps: 64 }), "k");
    const second = handwrittenRow(meta({ codec: "mdct", bitrateKbps: 128 }), "k");
    expect(first.id).not.toBe(second.id);
  });
});

describe("realRow", () => {
  it("uses actual stream bitrate and the aligned reference byte count", () => {
    const row = realRow(realRun(), "mp3", "codecLab.real.codec.mp3", {
      mse: 0.0625,
      snrDb: 6.0206,
      segmentalSnrDb: 6.0206,
      psnrDb: 12.0412,
      sampleCount: 1000,
    });
    expect(row.bitrateKbps).toBe(64);
    expect(row.compressionRatio).toBe(4);
    expect(row.encodeMs).toBe(42);
    expect(row.sampleCount).toBe(1000);
    expect(row.lossless).toBe(false);
    expect(row.snrDb).toBeCloseTo(6.0206, 3);
    expect(row.psnrDb).toBeCloseTo(12.0412, 3);
  });

  it("shows NaN when the worker has not produced metrics", () => {
    const row = realRow(realRun(), "mp3", "codecLab.real.codec.mp3", null);
    expect(row.snrDb).toBeNaN();
    expect(row.psnrDb).toBeNaN();
  });
});

describe("sortComparisonRows", () => {
  it("orders errors last, then bitrate ascending, then label", () => {
    const rows: ComparisonRow[] = [
      handwrittenRow(meta({ bitrateKbps: 192 }), "z"),
      { ...handwrittenRow(meta({ bitrateKbps: 64 }), "b") },
      { ...handwrittenRow(meta({ bitrateKbps: 64 }), "a") },
      { ...handwrittenRow(meta({ bitrateKbps: NaN }), "e"), errorKey: "codecLab.error.failed" },
      { ...handwrittenRow(meta({ bitrateKbps: 32 }), "c") },
    ];
    expect(sortComparisonRows(rows).map((row) => row.labelKey)).toEqual(["c", "a", "b", "z", "e"]);
  });
});

describe("comparisonToCsv", () => {
  it("uses Infinity for non-finite values and escapes commas/quotes", () => {
    const rows = [handwrittenRow(meta({ snrDb: Infinity, psnrDb: NaN }), 'label,"quoted"')];
    const csv = comparisonToCsv(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "id,family,codec,label_key,bitrate_kbps,compression_ratio,snr_db,psnr_db,encode_ms,bit_exact,lossless,sample_count,error_key",
    );
    expect(lines[1]).toContain('"label,""quoted"""');
    expect(lines[1]).toContain(",Infinity,NaN,");
  });
});
