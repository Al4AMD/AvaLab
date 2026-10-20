/**
 * Purpose: quality metrics for the F05 "Quality Metrics" lab. Students compare
 * an original signal with a processed/codec-decoded signal and see the same
 * measurements the UI plots on the rate-distortion chart. Each function is
 * pure, deterministic and returns a plain number; codec delay/padding must be
 * compensated (cross-correlation alignment) by the caller before comparing
 * signals (AGENTS F05).
 *
 * Definitions (N = reference.length = test.length, e[n] = reference[n] - test[n]):
 *   mse               MSE = (1/N) * sum_{n=0}^{N-1} e[n]^2
 *   snrDb             SNR = 10*log10( sum ref[n]^2 / sum e[n]^2 )
 *   segmentalSnrDb    mean over active frames of
 *                     10*log10( sum_frame ref^2 / sum_frame e^2 ),
 *                     frames with zero reference energy skipped
 *   psnrDb            PSNR = 10*log10( peak^2 / MSE )
 *   compressionRatio  CR = originalBytes / compressedBytes
 *   bitrateKbps       R = bytes * 8 / (durationSeconds * 1000)
 *
 * PSNR peak convention (pinned, AGENTS F05): the caller MUST pass `peak`
 * explicitly. For float audio the convention is peak = 1.0 (full scale), and
 * the UI must display that definition next to the value. No default is
 * provided so no caller can silently mix conventions.
 *
 * Degenerate values (documented, not errors):
 *   - mse on empty input (N = 0) -> NaN (0/0 is undefined).
 *   - snrDb identical nonzero signals -> Infinity; identical silent signals
 *     (both energies 0) -> NaN; reference silent but test nonzero -> -Infinity
 *     (the log of a zero ratio); a silent test against a nonzero reference is
 *     the ordinary 0 dB case because the error energy equals the reference
 *     energy.
 *   - segmentalSnrDb with no active frame (empty input or all reference frames
 *     silent) -> Infinity; an active frame with zero error contributes
 *     Infinity, so any such frame makes the mean Infinity.
 *   - psnrDb with MSE = 0 -> Infinity; empty input (MSE NaN) -> NaN.
 *   - compressionRatio with compressedBytes = 0 -> Infinity.
 *   - bitrateKbps with bytes = 0 -> 0.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 2.1 (signal energy and power; the SNR is a ratio of signal energy to
 * error energy); PSNR formula from Gonzalez & Woods, "Digital Image
 * Processing", 4th ed. (with AvaLab's audio peak convention above). NumPy
 * reference values define the golden vectors in test-data/golden/metrics.json.
 *
 * Complexity: O(N) time and O(1) extra space per array metric; segmental SNR
 * is O(N) time and O(1) extra space (frame sums are accumulated in place).
 *
 * Edge cases (R6): a length mismatch between reference and test -> RangeError;
 * a NaN or +/-Infinity sample -> TypeError (sample data rule). Numeric
 * parameters are validated independently: `frameLengthSamples` must be a
 * positive integer, `peak` a finite number > 0, `originalBytes` finite > 0,
 * `compressedBytes` finite >= 0, `bytes` finite >= 0 and `durationSeconds`
 * finite > 0 -> RangeError otherwise. Inputs are never mutated.
 */

import type { FloatArray } from "../signals/extent.js";

export interface SegmentalSnrOptions {
  frameLengthSamples: number;
}

export interface PsnrOptions {
  /** Full-scale reference level; required. Float audio: peak = 1.0. */
  peak: number;
}

function assertFiniteSamples(samples: FloatArray, label: string): void {
  for (let n = 0; n < samples.length; n += 1) {
    const sample: number | undefined = samples[n];
    if (sample === undefined) {
      throw new TypeError(`${label}: samples[${n}] read out of bounds`);
    }
    if (!Number.isFinite(sample)) {
      throw new TypeError(`${label}: samples[${n}] must be finite (got ${sample})`);
    }
  }
}

function assertSameLength(reference: FloatArray, test: FloatArray, caller: string): void {
  if (reference.length !== test.length) {
    throw new RangeError(
      `${caller}: reference and test must have the same length (got ${reference.length} and ${test.length})`,
    );
  }
}

function validatePair(reference: FloatArray, test: FloatArray, caller: string): void {
  assertSameLength(reference, test, caller);
  assertFiniteSamples(reference, `${caller}: reference`);
  assertFiniteSamples(test, `${caller}: test`);
}

function errorEnergy(reference: FloatArray, test: FloatArray): number {
  let sum = 0;
  for (let n = 0; n < reference.length; n += 1) {
    const difference = (reference[n] ?? 0) - (test[n] ?? 0);
    sum += difference * difference;
  }
  return sum;
}

/**
 * Mean squared error: MSE = (1/N) sum (reference[n] - test[n])^2.
 * Empty input -> NaN (documented 0/0 convention).
 */
export function mse(reference: FloatArray, test: FloatArray): number {
  validatePair(reference, test, "mse");
  if (reference.length === 0) {
    return Number.NaN;
  }
  return errorEnergy(reference, test) / reference.length;
}

/**
 * Signal-to-noise ratio in decibels:
 * SNR = 10*log10( sum reference^2 / sum error^2 ).
 * Identical nonzero signals -> Infinity; both silent -> NaN (documented).
 */
export function snrDb(reference: FloatArray, test: FloatArray): number {
  validatePair(reference, test, "snrDb");

  let referenceEnergy = 0;
  for (let n = 0; n < reference.length; n += 1) {
    const sample = reference[n] ?? 0;
    referenceEnergy += sample * sample;
  }
  const noiseEnergy = errorEnergy(reference, test);

  if (noiseEnergy === 0) {
    return referenceEnergy === 0 ? Number.NaN : Number.POSITIVE_INFINITY;
  }
  return 10 * Math.log10(referenceEnergy / noiseEnergy);
}

/**
 * Segmental SNR in decibels: split the pair into consecutive frames of
 * `frameLengthSamples` (the last frame may be shorter and is included, R8),
 * compute 10*log10(refEnergy/errorEnergy) per frame, skip frames whose
 * reference energy is exactly 0, and return the arithmetic mean of the
 * remaining frame SNRs. No active frame -> Infinity.
 */
export function segmentalSnrDb(
  reference: FloatArray,
  test: FloatArray,
  options: SegmentalSnrOptions,
): number {
  validatePair(reference, test, "segmentalSnrDb");
  const frameLengthSamples = options?.frameLengthSamples;
  if (!Number.isInteger(frameLengthSamples) || frameLengthSamples <= 0) {
    throw new RangeError(
      `segmentalSnrDb: frameLengthSamples must be a positive integer (got ${frameLengthSamples})`,
    );
  }

  let activeFrameCount = 0;
  let snrSum = 0;
  for (let start = 0; start < reference.length; start += frameLengthSamples) {
    const end = Math.min(start + frameLengthSamples, reference.length);
    let frameReferenceEnergy = 0;
    let frameErrorEnergy = 0;
    for (let n = start; n < end; n += 1) {
      const referenceSample = reference[n] ?? 0;
      const difference = referenceSample - (test[n] ?? 0);
      frameReferenceEnergy += referenceSample * referenceSample;
      frameErrorEnergy += difference * difference;
    }
    if (frameReferenceEnergy === 0) {
      continue;
    }
    activeFrameCount += 1;
    snrSum +=
      frameErrorEnergy === 0
        ? Number.POSITIVE_INFINITY
        : 10 * Math.log10(frameReferenceEnergy / frameErrorEnergy);
  }

  if (activeFrameCount === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return snrSum / activeFrameCount;
}

/**
 * Peak signal-to-noise ratio in decibels: PSNR = 10*log10(peak^2 / MSE).
 * `peak` is REQUIRED (no default) and must be finite and > 0; the caller
 * states the convention, and the UI must show it. Float audio uses peak = 1.0.
 * MSE = 0 -> Infinity; empty input (MSE NaN) -> NaN.
 */
export function psnrDb(reference: FloatArray, test: FloatArray, options: PsnrOptions): number {
  const peak = options?.peak;
  if (!Number.isFinite(peak) || peak <= 0) {
    throw new RangeError(`psnrDb: peak must be a finite number > 0 (got ${peak})`);
  }
  const meanSquaredError = mse(reference, test);
  if (meanSquaredError === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return 10 * Math.log10((peak * peak) / meanSquaredError);
}

/**
 * Compression ratio CR = originalBytes / compressedBytes. The original must
 * be finite and > 0; compressed must be finite and >= 0. A zero compressed
 * size (nothing emitted) is the documented Infinity case.
 */
export function compressionRatio(originalBytes: number, compressedBytes: number): number {
  if (!Number.isFinite(originalBytes) || originalBytes <= 0) {
    throw new RangeError(
      `compressionRatio: originalBytes must be a finite number > 0 (got ${originalBytes})`,
    );
  }
  if (!Number.isFinite(compressedBytes) || compressedBytes < 0) {
    throw new RangeError(
      `compressionRatio: compressedBytes must be a finite number >= 0 (got ${compressedBytes})`,
    );
  }
  if (compressedBytes === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return originalBytes / compressedBytes;
}

/**
 * Bit rate in kilobits per second (1 kbps = 1000 bit/s):
 * bitrateKbps = bytes * 8 / (durationSeconds * 1000).
 * `bytes` must be finite and >= 0; `durationSeconds` finite and > 0.
 */
export function bitrateKbps(bytes: number, durationSeconds: number): number {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`bitrateKbps: bytes must be a finite number >= 0 (got ${bytes})`);
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new RangeError(
      `bitrateKbps: durationSeconds must be a finite number > 0 (got ${durationSeconds})`,
    );
  }
  return (bytes * 8) / (durationSeconds * 1000);
}
