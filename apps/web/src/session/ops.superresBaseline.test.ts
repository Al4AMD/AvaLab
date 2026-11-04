import { describe, expect, it } from "vitest";

import { DspOpError, superresBaseline } from "./ops";

function tone(sampleRateHz: number, frequencyHz: number, sampleCount: number): Float32Array {
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = 0.5 * Math.sin((2 * Math.PI * frequencyHz * index) / sampleRateHz);
  }
  return samples;
}

function payloadOf(samples: Float32Array): {
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
} {
  const copy = samples.slice();
  return { buffer: copy.buffer, byteOffset: 0, byteLength: copy.byteLength };
}

function magnitudeAt(samples: Float32Array, sampleRateHz: number, frequencyHz: number): number {
  let real = 0;
  let imag = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    const phase = (2 * Math.PI * frequencyHz * index) / sampleRateHz;
    real += sample * Math.cos(phase);
    imag -= sample * Math.sin(phase);
  }
  return Math.hypot(real, imag) / samples.length;
}

function baselineSamples(result: ReturnType<typeof superresBaseline>): Float32Array {
  const payload = result.payload;
  if (payload === undefined) {
    throw new Error("superresBaseline must return samples");
  }
  return new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
}

describe("superresBaseline", () => {
  it("upsamples 8 kHz to 48 kHz with the kaiser-sinc filter and no image", () => {
    const input = tone(8_000, 1_000, 800);
    const result = superresBaseline(
      { sampleRateHz: 8_000, targetRateHz: 48_000 },
      payloadOf(input),
    );
    const output = baselineSamples(result);

    expect(output.length).toBe(4_800);
    expect(result.meta).toMatchObject({
      sampleCount: 4_800,
      sampleRateHz: 48_000,
      inputSampleRateHz: 8_000,
      delaySamples: 0,
    });
    expect(output.every(Number.isFinite)).toBe(true);

    const fundamental = magnitudeAt(output, 48_000, 1_000);
    const image = magnitudeAt(output, 48_000, 7_000);
    expect(fundamental).toBeGreaterThan(0.2);
    expect(image).toBeLessThan(fundamental / 40);
  });

  it("rejects a missing payload and invalid rates", () => {
    expect(() => superresBaseline({ sampleRateHz: 8_000, targetRateHz: 48_000 })).toThrow(
      DspOpError,
    );
    expect(() =>
      superresBaseline({ sampleRateHz: 0, targetRateHz: 48_000 }, payloadOf(tone(8_000, 1_000, 8))),
    ).toThrow(DspOpError);
    expect(() =>
      superresBaseline(
        { sampleRateHz: 8_000, targetRateHz: 44_100.5 },
        payloadOf(tone(8_000, 1_000, 8)),
      ),
    ).toThrow(DspOpError);
  });
});
