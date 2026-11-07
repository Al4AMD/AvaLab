import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { realRow } from "./comparison";

describe("realRow worker metrics", () => {
  it("keeps comparison.ts free of DSP imports", () => {
    const source = readFileSync(fileURLToPath(new URL("./comparison.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("@avalab/dsp");
    expect(source).not.toContain("computeQualityMetrics");
  });

  it("attaches precomputed metrics", () => {
    const reference = new Float32Array(4).fill(0.5);
    const row = realRow(
      {
        reference,
        decoded: new Float32Array(4).fill(0.25),
        channels: [new Float32Array(4).fill(0.25)],
        stats: {
          resultAudioId: "id",
          sizeBytes: 10,
          bitrateKbps: 64,
          encodeMs: 5,
          codecDelaySamples: 0,
          referenceStartSample: 0,
          alignedSampleCount: 4,
          durationSeconds: 1,
          sampleRateHz: 48_000,
          channels: 1,
          bitExact: false,
          lossless: false,
        },
      },
      "mp3",
      "codecLab.real.codec.mp3",
      { mse: 1, snrDb: 2, segmentalSnrDb: 3, psnrDb: 4, sampleCount: 4 },
    );
    expect(row.snrDb).toBe(2);
    expect(row.psnrDb).toBe(4);
  });
});
