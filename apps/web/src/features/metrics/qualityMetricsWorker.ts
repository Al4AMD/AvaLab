import { useSessionStore } from "../../session/store";
import type { QualityMetrics } from "./metrics";

/** Measure F05 metrics in the DSP worker. Callers keep alignment validation
 * on the main thread so a mismatch becomes a typed message, not bad audio. */
export async function measureQualityMetrics(
  reference: Float32Array,
  test: Float32Array,
  sampleRateHz: number,
): Promise<QualityMetrics> {
  if (reference.length === 0 || test.length === 0) {
    throw new Error("metrics: empty");
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new Error("metrics: invalidRate");
  }
  if (reference.length !== test.length) {
    throw new Error("metrics: lengthMismatch");
  }
  const combined = new Float32Array(reference.length + test.length);
  combined.set(reference, 0);
  combined.set(test, reference.length);
  const ticket = useSessionStore
    .getState()
    .deriveStandalone(
      "qualityMetrics",
      { sampleRateHz, sampleCount: reference.length },
      { buffer: combined.buffer, byteOffset: 0, byteLength: combined.byteLength },
    );
  const outcome = await ticket.outcome;
  if ("cancelled" in outcome) {
    throw new Error("metrics: cancelled");
  }
  return {
    mse: outcome.mse,
    snrDb: outcome.snrDb,
    segmentalSnrDb: outcome.segmentalSnrDb,
    psnrDb: outcome.psnrDb,
    sampleCount: outcome.meta.sampleCount,
  };
}
