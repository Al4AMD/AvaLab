/**
 * Purpose: F08 benchmark helpers. `benchmarkFft` compares our radix-2 FFT with
 * the third-party fft.js package on identical deterministic input and reports
 * median wall-clock times plus the maximum absolute coefficient error.
 * `stftBenchmarkChunk` measures our FFT-based Hann-windowed STFT over a bounded
 * frame range so the UI can walk a whole file in chunks with progress/cancel.
 *
 * Formula: same transform for both implementations, X[k] = sum x[n]
 * e^(-j 2 pi k n / N), with an unscaled forward transform. The STFT uses
 * periodic Hann frames of length N and hop H:
 *   X_m[k] = sum_{n=0}^{N-1} w[n] x[mH+n] e^(-j 2 pi k n / N).
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * §9.3 and §10.3; fft.js 4.0.4 (MIT) is used for the benchmark only.
 *
 * Complexity: O(N log N) per transform; the benchmark runs
 * `iterations + 1` transforms per implementation (one warm-up).
 *
 * Edge cases: supported FFT sizes are 256, 1024, 4096 and 16384; a bad size,
 * iteration count, hop/frame count or out-of-range chunk -> RangeError;
 * non-finite input -> TypeError. Wall-clock numbers are machine-dependent;
 * tests assert only finiteness and accuracy, never timing.
 */

import FFT from "fft.js";
import { fftRadix2 } from "./fft.js";
import { window } from "./windows.js";

export const FFT_BENCHMARK_SIZES = [256, 1024, 4096, 16384] as const;
const DEFAULT_ITERATIONS = 10;
const MIN_MEASURABLE_MS = 1e-6;

export interface FftBenchmarkResult {
  readonly fftLengthSamples: number;
  readonly iterations: number;
  readonly oursMedianMs: number;
  readonly libraryMedianMs: number;
  readonly speedRatio: number;
  readonly maxAbsError: number;
}

function deterministicSamples(length: number): Float64Array {
  // Small LCG: same input for both implementations and every run.
  let state = 0x1234_5678;
  const samples = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    samples[index] = (state / 0x1_0000_0000) * 2 - 1;
  }
  return samples;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function benchmarkFft(
  fftLengthSamples: number,
  iterations: number = DEFAULT_ITERATIONS,
): FftBenchmarkResult {
  if (!(FFT_BENCHMARK_SIZES as readonly number[]).includes(fftLengthSamples)) {
    throw new RangeError(
      `benchmarkFft: fftLengthSamples must be one of ${FFT_BENCHMARK_SIZES.join(", ")} (got ${fftLengthSamples})`,
    );
  }
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) {
    throw new RangeError(
      `benchmarkFft: iterations must be an integer in [1, 1000] (got ${iterations})`,
    );
  }

  const samples = deterministicSamples(fftLengthSamples);
  const library = new FFT(fftLengthSamples);
  const libraryInput = library.createComplexArray() as number[];
  for (let index = 0; index < fftLengthSamples; index += 1) {
    libraryInput[2 * index] = samples[index] ?? 0;
    libraryInput[2 * index + 1] = 0;
  }
  const libraryOutput = library.createComplexArray() as number[];

  // Warm-up once per implementation.
  const ourWarm = fftRadix2(samples);
  library.transform(libraryOutput, libraryInput);

  const oursTimes: number[] = [];
  const libraryTimes: number[] = [];
  let latestOurs = ourWarm;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const oursStart = performance.now();
    latestOurs = fftRadix2(samples);
    oursTimes.push(performance.now() - oursStart);

    const libraryStart = performance.now();
    library.transform(libraryOutput, libraryInput);
    libraryTimes.push(performance.now() - libraryStart);
  }

  let maxAbsError = 0;
  for (let bin = 0; bin < fftLengthSamples; bin += 1) {
    maxAbsError = Math.max(
      maxAbsError,
      Math.abs((latestOurs.re[bin] ?? 0) - (libraryOutput[2 * bin] ?? 0)),
      Math.abs((latestOurs.im[bin] ?? 0) - (libraryOutput[2 * bin + 1] ?? 0)),
    );
  }

  const oursMedianMs = median(oursTimes);
  const libraryMedianMs = median(libraryTimes);
  return {
    fftLengthSamples,
    iterations,
    oursMedianMs,
    libraryMedianMs,
    speedRatio: oursMedianMs / Math.max(libraryMedianMs, MIN_MEASURABLE_MS),
    maxAbsError,
  };
}

export interface StftBenchmarkChunkParams {
  readonly fftLengthSamples: number;
  readonly hopSamples: number;
  readonly startSample: number;
  readonly frameCount: number;
}

export interface StftBenchmarkChunkResult {
  readonly framesProcessed: number;
  readonly elapsedMs: number;
  readonly checksum: number;
}

function assertFiniteSamples(samples: Float32Array | Float64Array): void {
  for (let index = 0; index < samples.length; index += 1) {
    const value: number | undefined = samples[index];
    if (value === undefined || !Number.isFinite(value)) {
      throw new TypeError(`stftBenchmarkChunk: samples[${index}] is not finite`);
    }
  }
}

export function stftBenchmarkChunk(
  samples: Float32Array | Float64Array,
  params: StftBenchmarkChunkParams,
): StftBenchmarkChunkResult {
  const { fftLengthSamples, hopSamples, startSample, frameCount } = params;
  if (
    !Number.isInteger(fftLengthSamples) ||
    fftLengthSamples < 8 ||
    !Number.isInteger(hopSamples) ||
    hopSamples < 1 ||
    hopSamples > fftLengthSamples ||
    !Number.isInteger(startSample) ||
    startSample < 0 ||
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    frameCount > 512
  ) {
    throw new RangeError(`stftBenchmarkChunk: invalid params ${JSON.stringify(params)}`);
  }
  const requiredSamples = (frameCount - 1) * hopSamples + fftLengthSamples;
  if (startSample + requiredSamples > samples.length) {
    throw new RangeError(
      `stftBenchmarkChunk: sample range ${startSample}..${startSample + requiredSamples} exceeds source length ${samples.length}`,
    );
  }
  assertFiniteSamples(samples);

  const hann = window("hann", fftLengthSamples);
  const frame = new Float64Array(fftLengthSamples);
  let checksum = 0;
  const startedAt = performance.now();
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const offset = startSample + frameIndex * hopSamples;
    for (let index = 0; index < fftLengthSamples; index += 1) {
      frame[index] = (samples[offset + index] ?? 0) * (hann[index] ?? 0);
    }
    const spectrum = fftRadix2(frame);
    for (let bin = 0; bin <= fftLengthSamples / 2; bin += 1) {
      checksum += Math.hypot(spectrum.re[bin] ?? 0, spectrum.im[bin] ?? 0);
    }
  }
  const elapsedMs = performance.now() - startedAt;
  return { framesProcessed: frameCount, elapsedMs, checksum };
}
