import { describe, expect, it } from "vitest";

import type { CodecLabMeta } from "../../session/ops";
import { aggregateCodecLanes } from "./codecLabLanes";

function meta(overrides: Partial<CodecLabMeta>): CodecLabMeta {
  return {
    codec: "rle",
    sampleCount: 100,
    sampleRateHz: 48_000,
    startSample: 0,
    endSample: 100,
    originalBytes: 200,
    compressedSizeBytes: 100,
    bitsPerSample: 8,
    bitrateKbps: 10,
    compressionRatio: 2,
    entropyBitsPerSymbol: 1,
    encodeMs: 2,
    decodeMs: 1,
    bitExact: true,
    mse: 0,
    snrDb: 0,
    segmentalSnrDb: 0,
    psnrDb: 0,
    histogram: [0, 0, 0, 0],
    codeLengths: [],
    coefficientSparsity: null,
    frameCount: null,
    bitsTotal: null,
    psychoacoustic: false,
    mdctEntropyBits: null,
    mdctSideInfoBits: null,
    mdctMaskedFraction: null,
    mdctBands: null,
    ...overrides,
  };
}

describe("aggregateCodecLanes", () => {
  it("sums amounts and derives entropy from merged histograms", () => {
    const aggregate = aggregateCodecLanes([
      meta({ histogram: [1, 0, 1, 0], originalBytes: 200, compressedSizeBytes: 100 }),
      meta({
        histogram: [0, 2, 0, 2],
        originalBytes: 300,
        compressedSizeBytes: 200,
        bitrateKbps: 20,
        encodeMs: 3,
        decodeMs: 4,
      }),
    ]);
    expect(aggregate).not.toBeNull();
    expect(aggregate).toMatchObject({
      sampleCount: 200,
      originalBytes: 500,
      compressedSizeBytes: 300,
      bitsPerSample: 12,
      bitrateKbps: 30,
      compressionRatio: 500 / 300,
      encodeMs: 5,
      decodeMs: 5,
      bitExact: true,
    });
    expect(aggregate?.entropyBitsPerSymbol).toBeCloseTo(1.918295834, 9);
  });

  it("is not an average of per-lane entropies", () => {
    const aggregate = aggregateCodecLanes([
      meta({ histogram: [1, 0, 1, 0] }),
      meta({ histogram: [0, 2, 0, 2] }),
    ]);
    expect(aggregate?.entropyBitsPerSymbol).not.toBeCloseTo(1, 9);
  });

  it("marks the aggregate inexact when any lane is inexact", () => {
    expect(aggregateCodecLanes([meta({}), meta({ bitExact: false })])?.bitExact).toBe(false);
  });

  it("returns null for no lanes and finite values for zero compressed bytes", () => {
    expect(aggregateCodecLanes([])).toBeNull();
    expect(aggregateCodecLanes([meta({ compressedSizeBytes: 0, histogram: [] })])).toMatchObject({
      bitsPerSample: 0,
      compressionRatio: Infinity,
      entropyBitsPerSymbol: 0,
    });
  });
});
