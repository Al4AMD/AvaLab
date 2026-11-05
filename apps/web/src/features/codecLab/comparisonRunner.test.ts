import { describe, expect, it } from "vitest";

import type { CodecLabMeta } from "../../session/ops";
import type { RealCodecRun } from "./backendCodecs";
import type { ComparisonRow } from "./comparison";
import {
  type ComparisonRequest,
  defaultComparisonRequests,
  rateDistortionPoints,
  runComparison,
} from "./comparisonRunner";

function meta(patch: Partial<CodecLabMeta> = {}): CodecLabMeta {
  return {
    codec: "rle",
    sampleCount: 100,
    sampleRateHz: 48_000,
    startSample: 0,
    endSample: 100,
    originalBytes: 200,
    compressedSizeBytes: 100,
    bitsPerSample: 8,
    bitrateKbps: 100,
    compressionRatio: 2,
    entropyBitsPerSymbol: 7,
    encodeMs: 1,
    decodeMs: 1,
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

function realRun(bitrateKbps: number): RealCodecRun {
  const reference = new Float32Array(100).fill(0.5);
  const decoded = new Float32Array(100).fill(0.25);
  return {
    reference,
    decoded,
    stats: {
      resultAudioId: "id",
      sizeBytes: 100,
      bitrateKbps,
      encodeMs: 5,
      codecDelaySamples: 0,
      referenceStartSample: 0,
      alignedSampleCount: 100,
      durationSeconds: 0.002,
      sampleRateHz: 48_000,
      bitExact: false,
      lossless: false,
    },
  };
}

function hand(
  codec: Extract<ComparisonRequest, { kind: "handwritten" }>["codec"],
): ComparisonRequest {
  return { kind: "handwritten", codec, mdctBitsPerSecond: 128_000 };
}

const input = {
  samples: new Float32Array(0),
  sampleRateHz: 48_000,
  startSample: 0,
  endSample: 100,
};

describe("defaultComparisonRequests", () => {
  it("lists the hand-written ladder first and real codecs with their defaults", () => {
    const requests = defaultComparisonRequests(["flac", "mp3", "vorbis", "wav"]);
    expect(requests.map((request) => [request.kind, request.codec])).toEqual([
      ["handwritten", "rle"],
      ["handwritten", "huffman"],
      ["handwritten", "deltaHuffman"],
      ["handwritten", "mulaw"],
      ["handwritten", "alaw"],
      ["handwritten", "mdct"],
      ["handwritten", "mdct"],
      ["handwritten", "mdct"],
      ["real", "flac"],
      ["real", "mp3"],
      ["real", "vorbis"],
      ["real", "wav"],
    ]);
    expect(requests[5]).toEqual({ kind: "handwritten", codec: "mdct", mdctBitsPerSecond: 64_000 });
    expect(requests[6]).toEqual({
      kind: "handwritten",
      codec: "mdct",
      mdctBitsPerSecond: 128_000,
    });
    expect(requests[7]).toEqual({
      kind: "handwritten",
      codec: "mdct",
      mdctBitsPerSecond: 256_000,
    });
    expect(requests[8]).toEqual({
      kind: "real",
      codec: "flac",
      params: { codec: "flac", compressionLevel: 5 },
    });
    expect(requests[9]).toEqual({
      kind: "real",
      codec: "mp3",
      params: { codec: "mp3", bitrateKbps: 128 },
    });
    expect(requests[10]).toEqual({
      kind: "real",
      codec: "vorbis",
      params: { codec: "vorbis", quality: 5 },
    });
    expect(requests[11]).toEqual({ kind: "real", codec: "wav", params: { codec: "wav" } });
  });
});

describe("runComparison", () => {
  it("runs one request at a time and reports each completed row", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const progress: number[] = [];
    const rows = await runComparison(input, [hand("rle"), hand("huffman")], {
      runHandwritten: async (request) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        order.push(request.codec);
        active -= 1;
        return meta({ codec: request.codec, bitrateKbps: request.codec === "rle" ? 10 : 20 });
      },
      runReal: async () => realRun(64),
      onProgress: (completed) => progress.push(completed),
    });
    expect(maxActive).toBe(1);
    expect(order).toEqual(["rle", "huffman"]);
    expect(progress).toEqual([1, 2]);
    expect(rows.map((row) => row.bitrateKbps)).toEqual([10, 20]);
  });

  it("does not call a runner after the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const rows = await runComparison(input, [hand("rle"), hand("huffman")], {
      runHandwritten: async () => {
        calls += 1;
        return meta();
      },
      runReal: async () => realRun(64),
      signal: controller.signal,
    });
    expect(calls).toBe(0);
    expect(rows).toEqual([]);
  });

  it("measures real rows in the worker and keeps the row when metrics fail", async () => {
    const rows = await runComparison(
      input,
      [{ kind: "real", codec: "mp3", params: { codec: "mp3", bitrateKbps: 128 } }],
      {
        runHandwritten: async () => meta(),
        runReal: async () => realRun(64),
        measureQuality: async () => ({
          mse: 0.0625,
          snrDb: 6.0206,
          segmentalSnrDb: 6.0206,
          psnrDb: 12.0412,
          sampleCount: 100,
        }),
      },
    );
    expect(rows[0]?.snrDb).toBeCloseTo(6.0206, 3);
    const failed = await runComparison(
      input,
      [{ kind: "real", codec: "mp3", params: { codec: "mp3", bitrateKbps: 128 } }],
      {
        runHandwritten: async () => meta(),
        runReal: async () => realRun(64),
        measureQuality: async () => {
          throw new Error("worker failed");
        },
      },
    );
    expect(failed[0]?.errorKey).toBeUndefined();
    expect(failed[0]?.snrDb).toBeNaN();
  });

  it("records a failed request as an error row and continues", async () => {
    const rows = await runComparison(input, [hand("rle"), hand("huffman")], {
      runHandwritten: async (request) => {
        if (request.codec === "rle") {
          throw new Error("boom");
        }
        return meta({ codec: "huffman", bitrateKbps: 20 });
      },
      runReal: async () => realRun(64),
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      codec: "rle",
      errorKey: "codecLab.error.failed",
    });
    expect(rows[1]).toMatchObject({ codec: "huffman", bitrateKbps: 20 });
    expect(rows[0]?.errorKey).toBeDefined();
  });
});

describe("rateDistortionPoints", () => {
  function row(patch: Partial<ComparisonRow>): ComparisonRow {
    return {
      id: "id",
      family: "handwritten",
      codec: "rle",
      labelKey: "codecLab.codec.rle",
      bitrateKbps: 128,
      compressionRatio: 2,
      snrDb: 20,
      psnrDb: 25,
      encodeMs: 1,
      bitExact: false,
      lossless: false,
      sampleCount: 100,
      ...patch,
    };
  }

  it("keeps finite positive bitrate and finite quality points only", () => {
    const points = rateDistortionPoints([
      row({ labelKey: "a", bitrateKbps: 64, snrDb: 10 }),
      row({ labelKey: "b", bitrateKbps: 0, snrDb: 11 }),
      row({ labelKey: "c", bitrateKbps: 128, snrDb: Infinity }),
      row({ labelKey: "d", bitrateKbps: NaN, snrDb: 12 }),
      row({ labelKey: "e", bitrateKbps: 256, snrDb: 13, errorKey: "codecLab.error.failed" }),
    ]);
    expect(points).toEqual({
      bitrateKbps: [64],
      snrDb: [10],
      psnrDb: [25],
      labels: ["a"],
    });
  });

  it("filters on the selected quality metric", () => {
    const points = rateDistortionPoints(
      [row({ labelKey: "a", psnrDb: Infinity }), row({ labelKey: "b", psnrDb: 30 })],
      "psnrDb",
    );
    expect(points.labels).toEqual(["b"]);
    expect(points.psnrDb).toEqual([30]);
  });
});
