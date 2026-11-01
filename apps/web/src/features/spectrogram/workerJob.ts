/**
 * Spectrogram job orchestration (F02, Wave-2 Plan 03 Task 3): the DSP op
 * analyses ONE bounded frame chunk per call, so this hook fans the source out
 * into chunk jobs through the store's `deriveWithSourceSlice` lane (each call
 * transfers only its slice, never the whole file) and keeps the settled
 * frame-major dB chunks in a ref for the painter.
 *
 * Column decimation is honest: `frameStride` widens the analysis hop so the
 * map stays under `MAX_CELLS` and `MAX_FRAMES`; the view prints the factor.
 * A params/source change cancels the previous chunk jobs and bumps the
 * generation token so stale results never paint.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { SpectrogramTilesParams } from "../../session/ops";
import type { SessionSource } from "../../session/store";
import { useSessionStore } from "../../session/store";

export const SPECTROGRAM_CHUNK_FRAMES = 128;
export const SPECTROGRAM_MAX_FRAMES = 8192;
export const SPECTROGRAM_MAX_CELLS = 4_000_000;
/** Fixed worker-side clamp floor; the dB-floor slider only re-clamps in paint. */
export const SPECTROGRAM_OP_DB_FLOOR_DB = -120;

export type SpectrogramAnalysisParams = {
  readonly windowFamily: SpectrogramTilesParams["windowFamily"];
  readonly windowLengthSamples: number;
  readonly hopFraction: number;
};

export type SpectrogramGeometry = {
  readonly sampleRateHz: number;
  readonly sampleCount: number;
  readonly hopLengthSamples: number;
  readonly binCount: number;
  readonly frameStride: number;
  /** Analysed (decimated) frame count = painted time columns. */
  readonly totalFrames: number;
  readonly chunkCount: number;
};

export type SpectrogramChunk = {
  readonly rowStart: number;
  readonly frameCount: number;
  readonly rows: Float32Array;
};

export function spectrogramGeometry(
  sampleCount: number,
  sampleRateHz: number,
  params: SpectrogramAnalysisParams,
): SpectrogramGeometry {
  const hopLengthSamples = Math.max(1, Math.round(params.windowLengthSamples * params.hopFraction));
  const binCount = Math.floor(params.windowLengthSamples / 2) + 1;
  const naturalFrames = sampleCount === 0 ? 0 : Math.ceil(sampleCount / hopLengthSamples);
  const frameStride = Math.max(
    1,
    Math.ceil(naturalFrames / SPECTROGRAM_MAX_FRAMES),
    Math.ceil((naturalFrames * binCount) / SPECTROGRAM_MAX_CELLS),
  );
  const totalFrames = naturalFrames === 0 ? 0 : Math.ceil(naturalFrames / frameStride);
  return {
    sampleRateHz,
    sampleCount,
    hopLengthSamples,
    binCount,
    frameStride,
    totalFrames,
    chunkCount: totalFrames === 0 ? 0 : Math.ceil(totalFrames / SPECTROGRAM_CHUNK_FRAMES),
  };
}

/** Wire params + source slice for one sampled-frame chunk. */
export function spectrogramChunkRequest(
  geometry: SpectrogramGeometry,
  params: SpectrogramAnalysisParams,
  chunkIndex: number,
): {
  readonly params: SpectrogramTilesParams;
  readonly startSample: number;
  readonly endSample: number;
} {
  const rowStart = chunkIndex * SPECTROGRAM_CHUNK_FRAMES;
  const frameCount = Math.min(SPECTROGRAM_CHUNK_FRAMES, geometry.totalFrames - rowStart);
  const startSample = rowStart * geometry.hopLengthSamples;
  const endSample = Math.min(
    geometry.sampleCount,
    (rowStart + (frameCount - 1) * geometry.frameStride) * geometry.hopLengthSamples +
      params.windowLengthSamples,
  );
  return {
    params: {
      sampleRateHz: geometry.sampleRateHz,
      windowFamily: params.windowFamily,
      windowLengthSamples: params.windowLengthSamples,
      hopFraction: params.hopFraction,
      dbFloorDb: SPECTROGRAM_OP_DB_FLOOR_DB,
      rowStart,
      rowCount: frameCount,
      frameStride: geometry.frameStride,
      sourceStartSample: startSample,
    },
    startSample,
    endSample,
  };
}

export type SpectrogramJob = {
  readonly geometry: SpectrogramGeometry | null;
  readonly chunks: ReadonlyMap<number, SpectrogramChunk>;
  /** Bumped when a chunk lands or the job restarts (paint trigger). */
  readonly paintVersion: number;
  readonly completedChunks: number;
  readonly error: boolean;
};

export function useSpectrogramJob(
  original: SessionSource | null,
  params: SpectrogramAnalysisParams,
): SpectrogramJob {
  const analysisKey = `${params.windowFamily}|${params.windowLengthSamples}|${params.hopFraction}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `analysisKey` is the canonical identity of `params` (all primitives).
  const geometry = useMemo(() => {
    if (original === null) {
      return null;
    }
    return spectrogramGeometry(original.samples.length, original.sampleRateHz, params);
    // `analysisKey` is the canonical identity of `params` (all primitives).
  }, [original, analysisKey]);
  const chunksRef = useRef<Map<number, SpectrogramChunk>>(new Map());
  const [paintVersion, setPaintVersion] = useState(0);
  const [completedChunks, setCompletedChunks] = useState(0);
  const [error, setError] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `analysisKey` is the canonical identity of `params` (all primitives).
  useEffect(() => {
    chunksRef.current = new Map();
    setCompletedChunks(0);
    setError(false);
    setPaintVersion((version) => version + 1);
    if (original === null || geometry === null || geometry.chunkCount === 0) {
      return;
    }
    let cancelled = false;
    const keys: string[] = [];
    const store = useSessionStore.getState();
    for (let chunkIndex = 0; chunkIndex < geometry.chunkCount; chunkIndex += 1) {
      const request = spectrogramChunkRequest(geometry, params, chunkIndex);
      const ticket = store.deriveWithSourceSlice(
        "spectrogramTiles",
        request.params,
        request.startSample,
        request.endSample,
      );
      keys.push(ticket.key);
      ticket.outcome.then(
        (outcome) => {
          if (cancelled) {
            return;
          }
          if ("cancelled" in outcome) {
            return;
          }
          if (outcome.payload === undefined) {
            setError(true);
            return;
          }
          const payload = outcome.payload;
          const rows = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
          chunksRef.current.set(chunkIndex, {
            rowStart: outcome.meta.rowStart,
            frameCount: outcome.meta.rowCount,
            rows,
          });
          setCompletedChunks(chunksRef.current.size);
          setPaintVersion((version) => version + 1);
        },
        () => {
          if (!cancelled) {
            setError(true);
          }
        },
      );
    }
    return () => {
      cancelled = true;
      const live = useSessionStore.getState();
      for (const key of keys) {
        live.cancel(key);
      }
    };
    // `analysisKey` covers every primitive of `params`.
  }, [original, geometry, analysisKey]);

  return { geometry, chunks: chunksRef.current, paintVersion, completedChunks, error };
}
