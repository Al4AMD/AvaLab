/**
 * Shared F05 quality-metrics wrapper (Wave-4 Plan 03 Task 3).
 *
 * The DSP library owns the formulas; this wrapper owns the lab conventions:
 * PSNR peak = 1.0 (full scale) and 20 ms segmental frames. Callers must align
 * reference and test first (length equality here is the precondition, not an
 * alignment strategy).
 */
import { mse, psnrDb, segmentalSnrDb, snrDb } from "@avalab/dsp";

export const PSNR_PEAK = 1;
export const SEGMENTAL_FRAME_SECONDS = 0.02;

export type QualityMetrics = {
  readonly mse: number;
  readonly snrDb: number;
  readonly segmentalSnrDb: number;
  readonly psnrDb: number;
  readonly sampleCount: number;
};

export type MetricsErrorCode = "empty" | "lengthMismatch" | "invalidRate";

export class MetricsError extends Error {
  readonly code: MetricsErrorCode;

  constructor(code: MetricsErrorCode) {
    super(`metrics: ${code}`);
    this.name = "MetricsError";
    this.code = code;
  }
}

export function computeQualityMetrics(
  reference: Float32Array,
  test: Float32Array,
  sampleRateHz: number,
): QualityMetrics {
  if (reference.length === 0 || test.length === 0) {
    throw new MetricsError("empty");
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new MetricsError("invalidRate");
  }
  if (reference.length !== test.length) {
    throw new MetricsError("lengthMismatch");
  }
  const frameLengthSamples = Math.max(1, Math.round(SEGMENTAL_FRAME_SECONDS * sampleRateHz));
  return {
    mse: mse(reference, test),
    snrDb: snrDb(reference, test),
    segmentalSnrDb: segmentalSnrDb(reference, test, { frameLengthSamples }),
    psnrDb: psnrDb(reference, test, { peak: PSNR_PEAK }),
    sampleCount: reference.length,
  };
}

export function formatMetric(value: number, digits = 2): string {
  if (value === Number.POSITIVE_INFINITY) {
    return "∞";
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return "-∞";
  }
  if (Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(digits);
}
