import { describe, expect, it } from "vitest";

import {
  appendRateDistortionPoints,
  type RateDistortionExtraPoint,
  rateDistortionPoints,
} from "./comparisonRunner";

const point: RateDistortionExtraPoint = {
  labelKey: "ai.neuralCodec.point",
  bitrateKbps: 6,
  snrDb: 12.5,
};

describe("appendRateDistortionPoints", () => {
  it("appends finite extras after the measured rows", () => {
    const base = rateDistortionPoints([
      {
        id: "a",
        family: "real",
        codec: "mp3",
        labelKey: "codecLab.real.codec.mp3",
        bitrateKbps: 128,
        compressionRatio: 4,
        snrDb: 20,
        psnrDb: 25,
        encodeMs: 1,
        bitExact: false,
        lossless: false,
        sampleCount: 100,
      },
    ]);
    const points = appendRateDistortionPoints(base, [point], "snrDb");

    expect(points.labels).toEqual(["codecLab.real.codec.mp3", "ai.neuralCodec.point"]);
    expect(points.bitrateKbps).toEqual([128, 6]);
    expect(points.snrDb).toEqual([20, 12.5]);
    expect(points.psnrDb).toHaveLength(2);
  });

  it("filters non-finite or non-positive extras", () => {
    const points = appendRateDistortionPoints(
      { bitrateKbps: [], snrDb: [], psnrDb: [], labels: [] },
      [
        point,
        { ...point, bitrateKbps: 0 },
        { ...point, bitrateKbps: Number.NaN },
        { ...point, snrDb: Number.POSITIVE_INFINITY },
      ],
      "snrDb",
    );

    expect(points.labels).toEqual(["ai.neuralCodec.point"]);
    expect(points.bitrateKbps).toEqual([6]);
  });

  it("does not invent PSNR for extras", () => {
    const points = appendRateDistortionPoints(
      { bitrateKbps: [], snrDb: [], psnrDb: [], labels: [] },
      [point],
      "psnrDb",
    );

    expect(points).toEqual({ bitrateKbps: [], snrDb: [], psnrDb: [], labels: [] });
  });
});
