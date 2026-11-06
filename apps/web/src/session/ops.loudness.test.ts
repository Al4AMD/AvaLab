import { measureLoudness } from "@avalab/dsp";
import { describe, expect, it } from "vitest";
import { DspOpError, loudnessMeasure } from "./ops";
import { float32PayloadOf } from "./testDoubles";

const SAMPLE_RATE = 48_000;

function twoLevelSamples(): Float32Array {
  const loudAmplitude = Math.SQRT2 * 0.1;
  const quietAmplitude = loudAmplitude * 10 ** (-15 / 20);
  const loudCount = Math.round(0.4 * SAMPLE_RATE);
  const quietCount = Math.round(0.5 * SAMPLE_RATE);
  return Float32Array.from({ length: loudCount + quietCount }, (_, index) => {
    const amplitude = index < loudCount ? loudAmplitude : quietAmplitude;
    return amplitude * Math.sin((2 * Math.PI * 1_000 * index) / SAMPLE_RATE);
  });
}

function expectOpError(act: () => unknown, code: string): void {
  try {
    act();
    expect.unreachable(`expected a ${code} throw`);
  } catch (error) {
    expect(error).toBeInstanceOf(DspOpError);
    expect((error as DspOpError).code).toBe(code);
  }
}

describe("loudnessMeasure", () => {
  it("returns the DSP integrated loudness, block gating and constants", () => {
    const samples = twoLevelSamples();
    const direct = measureLoudness(samples, { sampleRateHz: SAMPLE_RATE });
    const result = loudnessMeasure({ sampleRateHz: SAMPLE_RATE }, float32PayloadOf([...samples]));

    expect(result.integratedLufs).toBe(direct.integratedLufs);
    expect(result.blockCount).toBe(direct.blocks.length);
    expect(result.blockDurationSeconds).toBe(0.4);
    expect(result.blockHopSeconds).toBe(0.1);
    expect(result.blocks).toEqual(
      direct.blocks.map((block) => ({
        startSample: block.startSample,
        loudnessLufs: block.loudnessLufs,
        absoluteGated: block.absoluteGated,
        relativeGated: block.relativeGated,
      })),
    );
    expect(result.blocks.some((block) => block.relativeGated)).toBe(true);
    expect(result.blocks.some((block) => !block.relativeGated)).toBe(true);
  });

  it("rejects missing, empty, unaligned and non-finite payloads", () => {
    expectOpError(() => loudnessMeasure({ sampleRateHz: SAMPLE_RATE }), "badPayload");
    expectOpError(
      () => loudnessMeasure({ sampleRateHz: SAMPLE_RATE }, float32PayloadOf([])),
      "badPayload",
    );
    expectOpError(
      () =>
        loudnessMeasure(
          { sampleRateHz: SAMPLE_RATE },
          { buffer: new ArrayBuffer(5), byteOffset: 0, byteLength: 5 },
        ),
      "badPayload",
    );
    expectOpError(
      () => loudnessMeasure({ sampleRateHz: SAMPLE_RATE }, float32PayloadOf([0, Number.NaN, 0])),
      "badPayload",
    );
  });

  it("rejects invalid params and payloads longer than 300 s", () => {
    expectOpError(() => loudnessMeasure({ sampleRateHz: 0 }, float32PayloadOf([0])), "badParams");
    expectOpError(
      () =>
        loudnessMeasure(
          { sampleRateHz: 1_000 },
          float32PayloadOf(new Array<number>(301_000).fill(0)),
        ),
      "badParams",
    );
  });
});
