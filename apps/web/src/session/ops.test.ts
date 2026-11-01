/**
 * Op table tests: sessionPing echo semantics, badParams typed throws, and
 * the type-lens wiring (params/result types + worker switch exhaustiveness)
 * that the "add one entry" rule leans on (ops.ts header).
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  aliasDemo,
  type ConvolutionStepsParams,
  convolutionSteps,
  DspOpError,
  type DspOpName,
  type DspOpParams,
  type DspOpResult,
  dspOps,
  type ExtentOperation,
  extentProcess,
  fftSelection,
  generateSynth,
  type ReverbProcessParams,
  reverbProcess,
  type SamplingProcessParams,
  samplingProcess,
  sessionPing,
  spectrogramTiles,
  speedTransform,
  waveformOverview,
  waveformRange,
  windowProfiles,
} from "./ops";
import type { TransferablePayload } from "./protocol";
import { float32PayloadOf, float32ValuesOf } from "./testDoubles";

describe("sessionPing handler", () => {
  it("echoes the payload descriptor with meta.received", () => {
    const bytes = new Uint8Array(8);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index + 1;
    }
    const payload: TransferablePayload = {
      buffer: bytes.buffer,
      byteOffset: 0,
      byteLength: bytes.byteLength,
    };
    const result = sessionPing({ count: 3 }, payload);

    expect(result.meta).toEqual({ received: true });
    // Same bytes, via the echoed descriptor's own range.
    expect(result.payload?.byteOffset).toBe(0);
    expect(result.payload?.byteLength).toBe(8);
    expect([...new Uint8Array(result.payload?.buffer ?? new ArrayBuffer(0))]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("answers with meta only when there is no payload", () => {
    const result = sessionPing({ count: 0 });
    expect(result).toEqual({ meta: { received: true } });
    expect(result.payload).toBeUndefined();
  });

  it("throws a typed badParams error for non-integer, negative or missing counts", () => {
    const expectBadParams = (act: () => unknown): void => {
      try {
        act();
        expect.unreachable("sessionPing must throw");
      } catch (error) {
        expect(error).toBeInstanceOf(DspOpError);
        expect((error as DspOpError).code).toBe("badParams");
      }
    };
    expectBadParams(() => sessionPing({ count: 1.5 }));
    expectBadParams(() => sessionPing({ count: -1 }));
    expectBadParams(() => sessionPing({ count: Number.NaN }));
    expectBadParams(() => sessionPing({ count: Number.POSITIVE_INFINITY }));
    // Wire frames can carry a missing params object; the handler owns the guard.
    expectBadParams(() => sessionPing(undefined as unknown as { count: number }));
  });
});

describe("waveformOverview handler", () => {
  it("buckets the source payload with meta/sampleCount read off the frame", () => {
    // Same hand-computed 5-sample/3-bucket vector as the dsp peaks test.
    const result = waveformOverview(
      { bucketCount: 3, sampleRateHz: 48_000 },
      float32PayloadOf([1, -2, 3, -0.5, 0.25]),
    );
    expect(result.meta).toEqual({ sampleCount: 5, sampleRateHz: 48_000, bucketCount: 3 });
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("waveformOverview must return a minMax payload");
    }
    expect(payload.byteLength).toBe(6 * 4);
    expect(payload.byteOffset).toBe(0);
    expect(float32ValuesOf(payload)).toEqual([1, 1, -2, 3, -0.5, 0.25]);
  });

  it("answers an empty source with an empty (zero-byte) minMax payload", () => {
    const result = waveformOverview({ bucketCount: 8, sampleRateHz: 44_100 }, {
      buffer: new ArrayBuffer(0),
      byteOffset: 0,
      byteLength: 0,
    } satisfies TransferablePayload);
    // meta self-description: an empty source yields 0 buckets even though
    // params requested 8 — meta describes the payload actually returned.
    expect(result.meta).toEqual({ sampleCount: 0, sampleRateHz: 44_100, bucketCount: 0 });
    expect(result.payload?.byteLength).toBe(0);
  });

  it("throws a typed badParams error for an invalid bucketCount or sampleRateHz", () => {
    const expectBadParams = (act: () => unknown): void => {
      try {
        act();
        expect.unreachable("waveformOverview must throw");
      } catch (error) {
        expect(error).toBeInstanceOf(DspOpError);
        expect((error as DspOpError).code).toBe("badParams");
      }
    };
    expectBadParams(() => waveformOverview({ bucketCount: 0, sampleRateHz: 48_000 }));
    expectBadParams(() => waveformOverview({ bucketCount: 2.5, sampleRateHz: 48_000 }));
    expectBadParams(() => waveformOverview({ bucketCount: Number.NaN, sampleRateHz: 48_000 }));
    expectBadParams(() => waveformOverview({ bucketCount: 8, sampleRateHz: 0 }));
    expectBadParams(() => waveformOverview({ bucketCount: 8, sampleRateHz: Number.NaN }));
    // Wire frames can carry a missing params object; the handler owns the guard.
    expectBadParams(() =>
      waveformOverview(undefined as unknown as { bucketCount: number; sampleRateHz: number }),
    );
  });

  it("throws a typed badPayload error for a missing/misaligned payload", () => {
    const expectBadPayload = (act: () => unknown): void => {
      try {
        act();
        expect.unreachable("waveformOverview must throw");
      } catch (error) {
        expect(error).toBeInstanceOf(DspOpError);
        expect((error as DspOpError).code).toBe("badPayload");
      }
    };
    expectBadPayload(() => waveformOverview({ bucketCount: 8, sampleRateHz: 48_000 }));
    // Not a multiple of 4 bytes → not a whole Float32 sample count.
    expectBadPayload(() =>
      waveformOverview(
        { bucketCount: 8, sampleRateHz: 48_000 },
        {
          buffer: new ArrayBuffer(6),
          byteOffset: 0,
          byteLength: 6,
        },
      ),
    );
    // Non-Float32-aligned inner slice (misaligned view into a bigger buffer).
    expectBadPayload(() =>
      waveformOverview(
        { bucketCount: 8, sampleRateHz: 48_000 },
        {
          buffer: new ArrayBuffer(16),
          byteOffset: 2,
          byteLength: 8,
        },
      ),
    );
  });
});

describe("speedTransform handler", () => {
  const SAMPLE_RATE = 48_000;

  function sine(seconds: number, frequencyHz: number): TransferablePayload {
    const sampleCount = Math.round(SAMPLE_RATE * seconds);
    const values = Array.from({ length: sampleCount }, (_, index) =>
      Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE),
    );
    return float32PayloadOf(values);
  }

  function run(
    mode: "resample" | "timeStretch",
    speedFactor: number,
    semitones = 0,
    reverse = false,
    payload = sine(1, 440),
  ) {
    return speedTransform(
      {
        sampleRateHz: SAMPLE_RATE,
        startSample: 0,
        endSample: SAMPLE_RATE,
        mode,
        speedFactor,
        semitones,
        reverse,
      },
      payload,
    );
  }

  function zeroCrossingHz(values: number[], sampleRateHz: number): number {
    let crossings = 0;
    for (let index = 1; index < values.length; index += 1) {
      if ((values[index - 1] ?? 0) < 0 !== (values[index] ?? 0) < 0) {
        crossings += 1;
      }
    }
    return (crossings * sampleRateHz) / (2 * values.length);
  }

  it("resamples 2x: half the samples, peak near 880 Hz at the source rate", () => {
    const result = run("resample", 2);
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = float32ValuesOf(payload);
    expect(values.length).toBeGreaterThan(23_500);
    expect(values.length).toBeLessThan(24_500);
    expect(result.meta.sampleRateHz).toBe(SAMPLE_RATE);
    expect(result.meta.actualSpeedFactor).toBeCloseTo(2, 6);
    expect(zeroCrossingHz(values, SAMPLE_RATE)).toBeGreaterThan(840);
    expect(zeroCrossingHz(values, SAMPLE_RATE)).toBeLessThan(920);
  });

  it("time-stretches 2x: half the samples, pitch stays near 440 Hz", () => {
    const result = run("timeStretch", 2);
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = float32ValuesOf(payload);
    expect(values.length).toBeGreaterThan(23_500);
    expect(values.length).toBeLessThan(24_500);
    expect(result.meta.sampleRateHz).toBe(SAMPLE_RATE);
    expect(result.meta.actualSpeedFactor).toBeCloseTo(2, 6);
    expect(zeroCrossingHz(values, SAMPLE_RATE)).toBeGreaterThan(420);
    expect(zeroCrossingHz(values, SAMPLE_RATE)).toBeLessThan(460);
  });

  it("pitch-shifts +12 semitones without changing the length", () => {
    const result = run("timeStretch", 1, 12);
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = float32ValuesOf(payload);
    expect(values.length).toBeGreaterThan(47_000);
    expect(values.length).toBeLessThan(49_000);
    expect(zeroCrossingHz(values, SAMPLE_RATE)).toBeGreaterThan(840);
    expect(zeroCrossingHz(values, SAMPLE_RATE)).toBeLessThan(920);
  });

  it("reverses the output last", () => {
    const result = run("resample", 1, 0, true, float32PayloadOf([0, 0.25, 0.5, 0.75, 1]));
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    expect(float32ValuesOf(payload)).toEqual([1, 0.75, 0.5, 0.25, 0]);
  });

  it("throws tooLong for a 5-minute source slowed to 0.5x", () => {
    const payload = float32PayloadOf(Array.from({ length: 3000 }, () => 0.1));
    expect(() =>
      speedTransform(
        {
          sampleRateHz: 10,
          startSample: 0,
          endSample: 3000,
          mode: "resample",
          speedFactor: 0.5,
          semitones: 0,
          reverse: false,
        },
        payload,
      ),
    ).toThrowError(expect.objectContaining({ code: "tooLong" }));
  });

  it("throws badParams for an out-of-range speed", () => {
    expect(() => run("resample", 5)).toThrowError(expect.objectContaining({ code: "badParams" }));
    expect(() => run("resample", Number.NaN)).toThrowError(
      expect.objectContaining({ code: "badParams" }),
    );
  });
});

describe("samplingProcess handler", () => {
  const SAMPLE_RATE = 48_000;

  function sinePayload(frequencyHz: number, seconds = 1): TransferablePayload {
    const sampleCount = Math.round(SAMPLE_RATE * seconds);
    const values = Array.from({ length: sampleCount }, (_, index) =>
      Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE),
    );
    return float32PayloadOf(values);
  }

  function run(
    overrides: Partial<SamplingProcessParams> = {},
    payload: TransferablePayload = sinePayload(440),
  ) {
    return samplingProcess(
      {
        sampleRateHz: SAMPLE_RATE,
        startSample: 0,
        endSample: SAMPLE_RATE,
        targetRateHz: 8000,
        antiAlias: false,
        bits: 16,
        dither: false,
        seed: 1,
        ...overrides,
      },
      payload,
    );
  }

  function zeroCrossingHz(values: number[], sampleRateHz: number): number {
    let crossings = 0;
    for (let index = 1; index < values.length; index += 1) {
      if ((values[index - 1] ?? 0) < 0 !== (values[index] ?? 0) < 0) {
        crossings += 1;
      }
    }
    return (crossings * sampleRateHz) / (2 * values.length);
  }

  function rms(values: number[]): number {
    let energy = 0;
    for (const value of values) {
      energy += value * value;
    }
    return Math.sqrt(energy / values.length);
  }

  it("resamples to 8 kHz and returns quantized + error halves", () => {
    const result = run();
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = float32ValuesOf(payload);
    expect(result.meta.outputSampleCount).toBeGreaterThan(7900);
    expect(result.meta.outputSampleCount).toBeLessThan(8100);
    expect(values.length).toBe(2 * result.meta.outputSampleCount);
    expect(result.meta.sampleRateHz).toBe(8000);
    expect(result.meta.theorySnrDb).toBeCloseTo(6.02 * 16 + 1.76, 6);
    const quantized = values.slice(0, result.meta.outputSampleCount);
    expect(zeroCrossingHz(quantized, 8000)).toBeGreaterThan(420);
    expect(zeroCrossingHz(quantized, 8000)).toBeLessThan(460);
  });

  it("shows the 3 kHz fold-back without the filter and removes it with it", () => {
    const unfiltered = run({ antiAlias: false }, sinePayload(5000));
    const filtered = run({ antiAlias: true }, sinePayload(5000));
    const unfilteredPayload = unfiltered.payload;
    const filteredPayload = filtered.payload;
    if (unfilteredPayload === undefined || filteredPayload === undefined) {
      throw new Error("missing payload");
    }
    const unfilteredValues = float32ValuesOf(unfilteredPayload);
    const filteredValues = float32ValuesOf(filteredPayload);
    const unfilteredQuantized = unfilteredValues.slice(0, unfiltered.meta.outputSampleCount);
    const filteredQuantized = filteredValues.slice(0, filtered.meta.outputSampleCount);
    expect(zeroCrossingHz(unfilteredQuantized, 8000)).toBeGreaterThan(2900);
    expect(zeroCrossingHz(unfilteredQuantized, 8000)).toBeLessThan(3100);
    expect(rms(unfilteredQuantized)).toBeGreaterThan(0.5);
    expect(rms(filteredQuantized)).toBeLessThan(0.01);
  });

  it("measures 16-bit SNR within 3 dB of theory on a full-scale sine", () => {
    const result = run({ targetRateHz: SAMPLE_RATE, antiAlias: true, bits: 16 });
    expect(result.meta.snrDb).toBeGreaterThan(result.meta.theorySnrDb - 3);
    expect(result.meta.snrDb).toBeLessThan(result.meta.theorySnrDb + 3);
    expect(result.meta.mse).toBeGreaterThan(0);
    expect(result.meta.psnrDb).toBeGreaterThan(90);
  });

  it("changes the dither error sequence with the seed", () => {
    const first = run({ bits: 8, dither: true, seed: 1 });
    const repeat = run({ bits: 8, dither: true, seed: 1 });
    const other = run({ bits: 8, dither: true, seed: 2 });
    if (
      first.payload === undefined ||
      repeat.payload === undefined ||
      other.payload === undefined
    ) {
      throw new Error("missing payload");
    }
    const errorOf = (payload: TransferablePayload, count: number): number[] =>
      float32ValuesOf(payload).slice(count);
    const firstError = errorOf(first.payload, first.meta.outputSampleCount);
    expect(errorOf(repeat.payload, repeat.meta.outputSampleCount)).toEqual(firstError);
    expect(errorOf(other.payload, other.meta.outputSampleCount)).not.toEqual(firstError);
  });

  it("throws badParams for out-of-range bits and invalid rates", () => {
    const expectBadParams = (act: () => unknown): void => {
      expect(act).toThrowError(expect.objectContaining({ code: "badParams" }));
    };
    expectBadParams(() => run({ bits: 0 }));
    expectBadParams(() => run({ bits: 25 }));
    expectBadParams(() => run({ bits: 8.5 }));
    expectBadParams(() => run({ targetRateHz: 0 }));
    expectBadParams(() => run({ targetRateHz: 8000.5 }));
    expectBadParams(() => run({ targetRateHz: 96_001 }));
    expectBadParams(() => run({ startSample: -1 }));
    expectBadParams(() => run({ endSample: 10, startSample: 11 }));
  });
});

describe("aliasDemo handler", () => {
  function run(frequencyHz: number, antiAlias: boolean) {
    return aliasDemo({
      sourceRateHz: 48_000,
      targetRateHz: 8000,
      frequencyHz,
      durationSeconds: 1,
      antiAlias,
    });
  }

  it("predicts and measures the 3 kHz fold-back without the filter", () => {
    const result = run(5000, false);
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = float32ValuesOf(payload);
    let crossings = 0;
    for (let index = 1; index < values.length; index += 1) {
      if ((values[index - 1] ?? 0) < 0 !== (values[index] ?? 0) < 0) {
        crossings += 1;
      }
    }
    expect(result.meta.aliasFrequencyHz).toBe(3000);
    expect(result.meta.measuredPeakHz).toBeGreaterThan(2900);
    expect(result.meta.measuredPeakHz).toBeLessThan(3100);
    expect(result.meta.outputSampleCount).toBe(values.length);
    expect((crossings * 8000) / (2 * values.length)).toBeGreaterThan(2900);
  });

  it("removes the fold-back with the anti-alias filter", () => {
    const result = run(5000, true);
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = float32ValuesOf(payload);
    let energy = 0;
    for (const value of values) {
      energy += value * value;
    }
    expect(Math.sqrt(energy / values.length)).toBeLessThan(0.01);
    expect(result.meta.aliasFrequencyHz).toBe(3000);
  });

  it("keeps a below-Nyquist tone unchanged", () => {
    const result = run(440, false);
    expect(result.meta.aliasFrequencyHz).toBe(440);
    expect(result.meta.measuredPeakHz).toBeGreaterThan(420);
    expect(result.meta.measuredPeakHz).toBeLessThan(460);
  });
});

describe("extentProcess handler", () => {
  const SAMPLE_RATE = 48_000;

  function run(operation: ExtentOperation, values: number[]) {
    return extentProcess({ sampleRateHz: SAMPLE_RATE, ...operation }, float32PayloadOf(values));
  }

  function outputOf(result: ReturnType<typeof run>): number[] {
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    return float32ValuesOf(payload);
  }

  it("identity copies the input and reports support, energy and power", () => {
    const result = run({ operation: "identity" }, [0, 0, 1, 0, 0]);
    expect(outputOf(result)).toEqual([0, 0, 1, 0, 0]);
    expect(result.meta).toMatchObject({
      outputSampleCount: 5,
      durationSeconds: 5 / SAMPLE_RATE,
      supportStartSample: 2,
      supportEndSample: 2,
      energy: 1,
      averagePower: 0.2,
      signalType: "energy",
    });
    expect(result.meta.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("shift moves the support and keeps the length", () => {
    const values = new Array<number>(1000).fill(0);
    values[100] = 1;
    const delayed = run({ operation: "shift", shiftSamples: 50 }, values);
    const advanced = run({ operation: "shift", shiftSamples: -50 }, values);
    expect(delayed.meta.outputSampleCount).toBe(1000);
    expect(delayed.meta.supportStartSample).toBe(150);
    expect(delayed.meta.supportEndSample).toBe(150);
    expect(advanced.meta.supportStartSample).toBe(50);
    expect(advanced.meta.supportEndSample).toBe(50);
  });

  it("scale 2 halves the duration and moves the support", () => {
    const values = new Array<number>(1000).fill(0);
    values[100] = 1;
    const result = run({ operation: "scale", factor: 2 }, values);
    expect(result.meta.outputSampleCount).toBe(500);
    expect(result.meta.durationSeconds).toBe(500 / SAMPLE_RATE);
    expect(result.meta.supportStartSample).toBe(50);
    expect(result.meta.supportEndSample).toBe(50);
  });

  it("reverse flips the sample order", () => {
    const result = run({ operation: "reverse" }, [1, 2, 3, 4]);
    expect(outputOf(result)).toEqual([4, 3, 2, 1]);
    expect(result.meta.supportStartSample).toBe(0);
    expect(result.meta.supportEndSample).toBe(3);
  });

  it("truncate returns only the requested window", () => {
    const values = Array.from({ length: 1000 }, (_, index) => index);
    const result = run(
      { operation: "truncate", startSampleIndex: 100, lengthSamples: 200 },
      values,
    );
    expect(result.meta.outputSampleCount).toBe(200);
    expect(outputOf(result)[0]).toBe(100);
    expect(outputOf(result)[199]).toBe(299);
    expect(result.meta.supportStartSample).toBe(0);
    expect(result.meta.supportEndSample).toBe(199);
  });

  it("zero padding adds zeros and preserves energy", () => {
    const result = run({ operation: "zeroPad", padStartSamples: 2, padEndSamples: 3 }, [0, 1, 0]);
    expect(result.meta.outputSampleCount).toBe(8);
    expect(result.meta.supportStartSample).toBe(3);
    expect(result.meta.supportEndSample).toBe(3);
    expect(result.meta.energy).toBe(1);
    expect(outputOf(result)).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it("periodic extension triples the length and repeats the energy", () => {
    const result = run({ operation: "periodicExtend", repetitions: 3 }, [1, 2, 3]);
    expect(result.meta.outputSampleCount).toBe(9);
    expect(outputOf(result)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(result.meta.energy).toBe(42);
    expect(result.meta.signalType).toBe("power");
  });

  it("classifies an interior pulse as energy and a constant as power", () => {
    expect(run({ operation: "identity" }, [0, 0, 1, 0]).meta.signalType).toBe("energy");
    expect(run({ operation: "identity" }, [1, 1, 1, 1]).meta.signalType).toBe("power");
  });

  it("rejects an output above the 300 s processed cap before allocating", () => {
    expect(() =>
      run(
        { operation: "zeroPad", padStartSamples: 0, padEndSamples: 300 * SAMPLE_RATE + 1 },
        [1, 0],
      ),
    ).toThrowError(expect.objectContaining({ code: "tooLong" }));
    expect(() =>
      run({ operation: "periodicExtend", repetitions: 300 * SAMPLE_RATE + 1 }, [1]),
    ).toThrowError(expect.objectContaining({ code: "tooLong" }));
  });

  it("throws badParams for invalid operation parameters", () => {
    const bad = (operation: ExtentOperation): void => {
      expect(() => run(operation, [1, 2, 3])).toThrowError(
        expect.objectContaining({ code: "badParams" }),
      );
    };
    bad({ operation: "scale", factor: 0 });
    bad({ operation: "shift", shiftSamples: 1.5 });
    bad({ operation: "zeroPad", padStartSamples: -1, padEndSamples: 0 });
    bad({ operation: "periodicExtend", repetitions: 0 });
    bad({ operation: "truncate", startSampleIndex: -1, lengthSamples: 2 });
  });
});

describe("reverbProcess handler", () => {
  const SAMPLE_RATE = 48_000;
  const IR = {
    kind: "hall" as const,
    durationSeconds: 0.2,
    rt60Seconds: 0.4,
    seed: 7,
  };

  function run(
    source: number[],
    uploadedIr: number[],
    overrides: Partial<ReverbProcessParams> = {},
  ) {
    const values = [...source, ...uploadedIr];
    const params: ReverbProcessParams = {
      sampleRateHz: SAMPLE_RATE,
      startSample: 0,
      endSample: source.length,
      ir: IR,
      uploadedIrSampleCount: uploadedIr.length,
      preDelayMs: 0,
      wetMix: 1,
      method: "fft",
      ...overrides,
    };
    return reverbProcess(params, float32PayloadOf(values));
  }

  function outputOf(result: ReturnType<typeof run>): number[] {
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    return float32ValuesOf(payload);
  }

  it("keeps an impulse unchanged through a delta IR", () => {
    const result = run([1, 0, 0, 0], [1]);
    expect(outputOf(result)).toEqual([1, 0, 0, 0]);
    expect(result.meta).toMatchObject({
      outputSampleCount: 4,
      irSampleCount: 1,
      method: "fft",
      preDelaySamples: 0,
    });
  });

  it("keeps the full convolution tail", () => {
    const result = run([1, 2], [1, 1, 1]);
    expect(result.meta.outputSampleCount).toBe(4);
    expect(outputOf(result)).toEqual([1, 3, 3, 2]);
  });

  it("pads the dry signal to the convolution length for wetMix 0", () => {
    const result = run([1, 2], [1, 1], { wetMix: 0 });
    expect(outputOf(result)).toEqual([1, 2, 0]);
  });

  it("applies the pre-delay before convolution", () => {
    const result = run([1], [1], { preDelayMs: 1000 / SAMPLE_RATE });
    expect(result.meta.preDelaySamples).toBe(1);
    expect(outputOf(result)).toEqual([0, 1]);
  });

  it("agrees between the FFT and direct methods on a one-second excerpt", () => {
    const source = Array.from({ length: SAMPLE_RATE }, (_, index) =>
      Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE),
    );
    const uploadedIr = Array.from({ length: 64 }, (_, index) => 0.9 ** index);
    const fft = run(source, uploadedIr, { method: "fft" });
    const direct = run(source, uploadedIr, { method: "direct" });
    const fftValues = outputOf(fft);
    const directValues = outputOf(direct);
    expect(fftValues.length).toBe(directValues.length);
    let maxDifference = 0;
    for (let index = 0; index < fftValues.length; index += 1) {
      maxDifference = Math.max(
        maxDifference,
        Math.abs((fftValues[index] ?? 0) - (directValues[index] ?? 0)),
      );
    }
    expect(maxDifference).toBeLessThan(1e-6);
  });

  it("rejects the direct method above two seconds of input", () => {
    const source = new Array<number>(2 * SAMPLE_RATE + 1).fill(0);
    expect(() => run(source, [1], { method: "direct" })).toThrowError(
      expect.objectContaining({ code: "badParams" }),
    );
  });

  it("rejects an output above the 300 s processed cap", () => {
    expect(() => run([1], [1], { preDelayMs: 300_000 })).toThrowError(
      expect.objectContaining({ code: "tooLong" }),
    );
  });

  it("throws badParams for invalid parameters", () => {
    const bad = (overrides: Partial<ReverbProcessParams>): void => {
      expect(() => run([1, 2, 3], [1], overrides)).toThrowError(
        expect.objectContaining({ code: "badParams" }),
      );
    };
    bad({ wetMix: 1.5 });
    bad({ preDelayMs: -1 });
    bad({ method: "other" as ReverbProcessParams["method"] });
    bad({ uploadedIrSampleCount: 9 });
    bad({ startSample: -1 });
    bad({ ir: { ...IR, durationSeconds: 0 } });
  });
});

describe("convolutionSteps handler", () => {
  function directConvolution(signal: number[], ir: number[]): number[] {
    const output = new Array<number>(signal.length + ir.length - 1).fill(0);
    for (let m = 0; m < ir.length; m += 1) {
      for (let i = 0; i < signal.length; i += 1) {
        output[m + i] = (output[m + i] ?? 0) + (signal[i] ?? 0) * (ir[m] ?? 0);
      }
    }
    return output;
  }

  it("returns one partial per IR tap and the partials sum to the direct result", () => {
    const signal = [1, 2, 3];
    const ir = [4, 5];
    const params: ConvolutionStepsParams = { signal, ir };
    const result = convolutionSteps(params);
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = float32ValuesOf(payload);
    const outputLength = signal.length + ir.length - 1;
    expect(result.meta).toEqual({
      signalSampleCount: 3,
      irSampleCount: 2,
      stepCount: 2,
      outputSampleCount: 4,
    });
    expect(values.length).toBe(2 * outputLength);
    expect(values.slice(0, outputLength)).toEqual([4, 8, 12, 0]);
    expect(values.slice(outputLength)).toEqual([0, 5, 10, 15]);
    const summed = new Array<number>(outputLength).fill(0);
    for (let step = 0; step < 2; step += 1) {
      for (let index = 0; index < outputLength; index += 1) {
        summed[index] = (summed[index] ?? 0) + (values[step * outputLength + index] ?? 0);
      }
    }
    expect(summed).toEqual(directConvolution(signal, ir));
  });

  it("throws badParams for empty or non-finite inputs", () => {
    expect(() => convolutionSteps({ signal: [], ir: [1] })).toThrowError(
      expect.objectContaining({ code: "badParams" }),
    );
    expect(() => convolutionSteps({ signal: [1], ir: [] })).toThrowError(
      expect.objectContaining({ code: "badParams" }),
    );
    expect(() => convolutionSteps({ signal: [1, Number.NaN], ir: [1] })).toThrowError(
      expect.objectContaining({ code: "badParams" }),
    );
  });
});

describe("op table wiring", () => {
  it("carries the handler for dispatch", () => {
    expect(dspOps.sessionPing.handler).toBe(sessionPing);
    expect(dspOps.waveformOverview.handler).toBe(waveformOverview);
    expect(dspOps.waveformRange.handler).toBe(waveformRange);
    expect(dspOps.spectrogramTiles.handler).toBe(spectrogramTiles);
    expect(dspOps.fftSelection.handler).toBe(fftSelection);
    expect(dspOps.windowProfiles.handler).toBe(windowProfiles);
    expect(dspOps.generateSynth.handler).toBe(generateSynth);
    expect(dspOps.speedTransform.handler).toBe(speedTransform);
    expect(dspOps.samplingProcess.handler).toBe(samplingProcess);
    expect(dspOps.aliasDemo.handler).toBe(aliasDemo);
    expect(dspOps.extentProcess.handler).toBe(extentProcess);
    expect(dspOps.reverbProcess.handler).toBe(reverbProcess);
    expect(dspOps.convolutionSteps.handler).toBe(convolutionSteps);
  });

  it("derives typed params/results from the table (the add-one-entry lens)", () => {
    expectTypeOf<DspOpName>().toEqualTypeOf<
      | "sessionPing"
      | "spectrogramTiles"
      | "waveformOverview"
      | "waveformRange"
      | "fftSelection"
      | "windowProfiles"
      | "generateSynth"
      | "speedTransform"
      | "samplingProcess"
      | "aliasDemo"
      | "extentProcess"
      | "reverbProcess"
      | "convolutionSteps"
    >();
    expectTypeOf<DspOpParams<"sessionPing">>().toEqualTypeOf<{ count: number }>();
    expectTypeOf<DspOpResult<"sessionPing">>().toEqualTypeOf<{
      meta: { received: true };
      payload?: TransferablePayload;
    }>();
    expectTypeOf<DspOpParams<"waveformOverview">>().toEqualTypeOf<{
      bucketCount: number;
      sampleRateHz: number;
    }>();
    expectTypeOf<DspOpResult<"waveformOverview">>().toEqualTypeOf<{
      meta: { sampleCount: number; sampleRateHz: number; bucketCount: number };
      payload?: TransferablePayload;
    }>();
    expectTypeOf<DspOpParams<"waveformRange">>().toEqualTypeOf<{
      bucketCount: number;
      sampleRateHz: number;
      startSample: number;
      endSample: number;
    }>();
    expectTypeOf<DspOpResult<"waveformRange">>().toEqualTypeOf<{
      meta: {
        sampleCount: number;
        sampleRateHz: number;
        bucketCount: number;
        startSample: number;
        endSample: number;
      };
      payload?: TransferablePayload;
    }>();
    expectTypeOf<DspOpParams<"spectrogramTiles">>().toEqualTypeOf<{
      sampleRateHz: number;
      windowFamily: "rect" | "hann" | "hamming" | "blackman" | "kaiser";
      windowLengthSamples: number;
      hopFraction: number;
      dbFloorDb: number;
      rowStart: number;
      rowCount: number;
      frameStride?: number;
      sourceStartSample: number;
    }>();
    expectTypeOf<DspOpResult<"spectrogramTiles">>().toEqualTypeOf<{
      meta: {
        rowStart: number;
        rowCount: number;
        frameStride: number;
        columnCount: number;
        hopLengthSamples: number;
        fftLengthSamples: number;
        sampleRateHz: number;
        dbFloorDb: number;
        sourceStartSample: number;
      };
      payload?: TransferablePayload;
    }>();
  });

  it("type-level: unknown ops are not table keys", () => {
    // @ts-expect-error an op no plan ever adds — table keys stay closed.
    void dspOps.definitelyNotAnOp;
  });
});

describe("fftSelection handler", () => {
  const SAMPLE_RATE = 8192;
  const TONE_HZ = 1000;
  const SAMPLES = 8192;

  function toneSamples(frequencyHz: number): TransferablePayload {
    const values = Array.from({ length: SAMPLES }, (_, index) =>
      Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE),
    );
    return float32PayloadOf(values);
  }

  function run(frequencyHz: number, family: "rect" | "hann") {
    return fftSelection(
      {
        sampleRateHz: SAMPLE_RATE,
        startSample: 0,
        endSample: SAMPLES,
        windowFamily: family,
        windowLengthSamples: SAMPLES,
        magnitudeMode: "db",
        phaseMode: "wrapped",
      },
      toneSamples(frequencyHz),
    );
  }

  it("puts a bin-centred full-scale tone at 0 dB in its bin", () => {
    const result = run(TONE_HZ, "hann");
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = new Float64Array(payload.buffer, payload.byteOffset, payload.byteLength / 8);
    const binCount = result.meta.binCount;
    const magnitudes = values.subarray(binCount, binCount * 2);
    let peakBin = 0;
    for (let bin = 1; bin < binCount; bin += 1) {
      if ((magnitudes[bin] ?? -Infinity) > (magnitudes[peakBin] ?? -Infinity)) {
        peakBin = bin;
      }
    }
    expect(peakBin).toBe(TONE_HZ);
    expect(Math.abs(magnitudes[peakBin] ?? 0)).toBeLessThan(0.1);
    expect(result.meta.fftLengthSamples).toBe(SAMPLES);
    expect(result.meta.zeroPadSamples).toBe(0);
    expect(result.meta.capped).toBe(false);
  });

  it("changes leakage when the window changes (off-bin tone)", () => {
    const rect = run(TONE_HZ + 0.5, "rect");
    const hann = run(TONE_HZ + 0.5, "hann");
    const binCount = rect.meta.binCount;
    const valuesOf = (result: typeof rect): Float64Array => {
      const payload = result.payload;
      if (payload === undefined) {
        throw new Error("missing payload");
      }
      return new Float64Array(payload.buffer, payload.byteOffset, payload.byteLength / 8);
    };
    const rectValues = valuesOf(rect);
    const hannValues = valuesOf(hann);
    const rectLeak = rectValues[binCount + TONE_HZ + 100] ?? 0;
    const hannLeak = hannValues[binCount + TONE_HZ + 100] ?? 0;
    expect(hannLeak).toBeLessThan(rectLeak);
  });

  it("rejects an empty selection with a typed badParams", () => {
    expect(() =>
      fftSelection(
        {
          sampleRateHz: SAMPLE_RATE,
          startSample: 0,
          endSample: 0,
          windowFamily: "hann",
          windowLengthSamples: 1024,
          magnitudeMode: "db",
          phaseMode: "wrapped",
        },
        float32PayloadOf([]),
      ),
    ).toThrowError(DspOpError);
  });
});

describe("windowProfiles handler", () => {
  it("measures the textbook Hann side lobe and main-lobe width", () => {
    const result = windowProfiles({ sampleRateHz: 48000, windowLengthSamples: 256 });
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const hannIndex = result.meta.families.indexOf("hann");
    expect(hannIndex).toBeGreaterThanOrEqual(0);
    expect(result.meta.sideLobeLevelsDb[hannIndex] ?? 0).toBeCloseTo(-31.5, 0);
    const expectedWidthHz = (4 * 48000) / 256;
    expect(result.meta.mainLobeWidthsHz[hannIndex] ?? 0).toBeCloseTo(expectedWidthHz, -1);
    expect(result.meta.binCount).toBe(result.meta.fftLengthSamples / 2 + 1);
    expect(payload.byteLength / 8).toBe(result.meta.families.length * result.meta.binCount);
  });
});

describe("generateSynth handler", () => {
  it("returns exact-duration sine samples for load-as-source", () => {
    const result = generateSynth({
      waveform: "sine",
      sampleRateHz: 8000,
      durationSeconds: 0.1,
      amplitude: 0.5,
      frequencyHz: 440,
      previewBucketCount: 0,
    });
    expect(result.meta.mode).toBe("source");
    expect(result.meta.sampleCount).toBe(800);
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    const values = float32ValuesOf(payload);
    expect(values).toHaveLength(800);
    let energy = 0;
    for (const value of values) {
      energy += value * value;
    }
    const rms = Math.sqrt(energy / values.length);
    expect(rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("returns min/max buckets for the preview mode", () => {
    const result = generateSynth({
      waveform: "chirp",
      sampleRateHz: 8000,
      durationSeconds: 0.5,
      amplitude: 0.8,
      chirpFromHz: 100,
      chirpToHz: 2000,
      chirpLog: true,
      previewBucketCount: 64,
    });
    expect(result.meta.mode).toBe("preview");
    expect(result.meta.bucketCount).toBe(64);
    const payload = result.payload;
    if (payload === undefined) {
      throw new Error("missing payload");
    }
    expect(float32ValuesOf(payload)).toHaveLength(128);
  });
});
