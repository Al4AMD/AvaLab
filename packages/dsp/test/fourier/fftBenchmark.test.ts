import { describe, expect, it } from "vitest";
import { benchmarkFft, FFT_BENCHMARK_SIZES, stftBenchmarkChunk } from "../../src/index.js";

describe("benchmarkFft", () => {
  it.each(FFT_BENCHMARK_SIZES)("reports finite timing and accuracy for N=%i", (size) => {
    const result = benchmarkFft(size, 3);
    expect(result.fftLengthSamples).toBe(size);
    expect(result.iterations).toBe(3);
    expect(Number.isFinite(result.oursMedianMs)).toBe(true);
    expect(Number.isFinite(result.libraryMedianMs)).toBe(true);
    expect(result.oursMedianMs).toBeGreaterThanOrEqual(0);
    expect(result.libraryMedianMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.speedRatio)).toBe(true);
    expect(result.speedRatio).toBeGreaterThanOrEqual(0);
    expect(result.maxAbsError).toBeLessThanOrEqual(1e-5);
  });

  it("rejects unsupported sizes and iteration counts", () => {
    expect(() => benchmarkFft(128, 1)).toThrow(RangeError);
    expect(() => benchmarkFft(256, 0)).toThrow(RangeError);
    expect(() => benchmarkFft(256, 2.5)).toThrow(RangeError);
  });
});

describe("stftBenchmarkChunk", () => {
  const samples = new Float32Array(4096);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin(0.1 * index);
  }

  it("processes the requested frames and returns a finite checksum", () => {
    const result = stftBenchmarkChunk(samples, {
      fftLengthSamples: 256,
      hopSamples: 128,
      startSample: 0,
      frameCount: 4,
    });
    expect(result.framesProcessed).toBe(4);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.checksum)).toBe(true);
    expect(result.checksum).toBeGreaterThan(0);
  });

  it("rejects invalid params and out-of-range chunks", () => {
    expect(() =>
      stftBenchmarkChunk(samples, {
        fftLengthSamples: 256,
        hopSamples: 0,
        startSample: 0,
        frameCount: 4,
      }),
    ).toThrow(RangeError);
    expect(() =>
      stftBenchmarkChunk(samples, {
        fftLengthSamples: 256,
        hopSamples: 128,
        startSample: 0,
        frameCount: 513,
      }),
    ).toThrow(RangeError);
    expect(() =>
      stftBenchmarkChunk(samples, {
        fftLengthSamples: 256,
        hopSamples: 128,
        startSample: 4000,
        frameCount: 4,
      }),
    ).toThrow(RangeError);
  });

  it("rejects non-finite samples", () => {
    const bad = new Float32Array(1024);
    bad[3] = Number.NaN;
    expect(() =>
      stftBenchmarkChunk(bad, {
        fftLengthSamples: 256,
        hopSamples: 128,
        startSample: 0,
        frameCount: 1,
      }),
    ).toThrow(TypeError);
  });
});
