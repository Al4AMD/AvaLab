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
import type { AnalysisLane } from "../../lib/channel";
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

/** A buffer to analyse without a session-source payload lane. Used by the
 * general processed-spectrogram comparison: the buffer is copied per chunk
 * because the worker transfer neuters the payload. */
export type SpectrogramSource = {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
};

/** Chunk cache keyed weakly by the analysed buffer, then by analysis params.
 * Weak keys mean a replaced processed buffer drops its cached rows with no
 * manual eviction. */
const standaloneChunkCache = new WeakMap<
  Float32Array,
  Map<string, Map<number, SpectrogramChunk>>
>();

function standaloneCacheFor(
  source: SpectrogramSource,
  analysisKey: string,
): Map<number, SpectrogramChunk> {
  let byAnalysis = standaloneChunkCache.get(source.samples);
  if (byAnalysis === undefined) {
    byAnalysis = new Map();
    standaloneChunkCache.set(source.samples, byAnalysis);
  }
  let chunks = byAnalysis.get(analysisKey);
  if (chunks === undefined) {
    chunks = new Map();
    byAnalysis.set(analysisKey, chunks);
  }
  return chunks;
}

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
  lane: AnalysisLane,
  override: SpectrogramSource | null = null,
): SpectrogramJob {
  const analysisKey = `${params.windowFamily}|${params.windowLengthSamples}|${params.hopFraction}`;
  const samples =
    override?.samples ??
    (original === null ? null : lane === "mono" ? original.samples : original.channels[lane]) ??
    null;
  const sampleRateHz = override?.sampleRateHz ?? original?.sampleRateHz ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `analysisKey` is the canonical identity of `params` (all primitives).
  const geometry = useMemo(() => {
    if (samples === null || sampleRateHz <= 0) {
      return null;
    }
    return spectrogramGeometry(samples.length, sampleRateHz, params);
    // `analysisKey` is the canonical identity of `params` (all primitives).
  }, [samples, sampleRateHz, analysisKey]);
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
    if (samples === null || geometry === null || geometry.chunkCount === 0) {
      return;
    }
    let cancelled = false;
    let nextChunkIndex = 0;
    const keys: string[] = [];
    const store = useSessionStore.getState();
    const cache = override === null ? null : standaloneCacheFor(override, analysisKey);
    if (cache !== null) {
      for (const [index, chunk] of cache) {
        if (index < geometry.chunkCount) {
          chunksRef.current.set(index, chunk);
        }
      }
      if (chunksRef.current.size > 0) {
        setCompletedChunks(chunksRef.current.size);
        setPaintVersion((version) => version + 1);
      }
    }
    // One chunk in flight at a time. The worker is a single synchronous
    // event loop: posting every chunk up front queues minutes of STFT work
    // that a later tool's request (or a tool switch) must wait behind. The
    // sequential fan-out keeps at most one stale chunk running after unmount
    // while the first chunk still paints as soon as it settles.
    const requestNextChunk = (): void => {
      if (cancelled) {
        return;
      }
      while (cache?.has(nextChunkIndex)) {
        nextChunkIndex += 1;
      }
      if (nextChunkIndex >= geometry.chunkCount) {
        return;
      }
      const chunkIndex = nextChunkIndex;
      nextChunkIndex += 1;
      const request = spectrogramChunkRequest(geometry, params, chunkIndex);
      const ticket =
        override === null
          ? lane === "mono"
            ? store.deriveWithSourceSlice(
                "spectrogramTiles",
                request.params,
                request.startSample,
                request.endSample,
              )
            : store.deriveWithSourceSliceLane(
                "spectrogramTiles",
                request.params,
                request.startSample,
                request.endSample,
                lane,
              )
          : store.deriveStandalone(
              "spectrogramTiles",
              request.params,
              (() => {
                const copy = override.samples.slice(request.startSample, request.endSample);
                return { buffer: copy.buffer, byteOffset: 0, byteLength: copy.byteLength };
              })(),
            );
      keys.push(ticket.key);
      ticket.outcome
        .then(
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
            const rows = new Float32Array(
              payload.buffer,
              payload.byteOffset,
              payload.byteLength / 4,
            );
            const chunk = {
              rowStart: outcome.meta.rowStart,
              frameCount: outcome.meta.rowCount,
              rows,
            };
            chunksRef.current.set(chunkIndex, chunk);
            cache?.set(chunkIndex, chunk);
            setCompletedChunks(chunksRef.current.size);
            setPaintVersion((version) => version + 1);
          },
          () => {
            if (!cancelled) {
              setError(true);
            }
          },
        )
        .finally(() => {
          requestNextChunk();
        });
    };
    requestNextChunk();
    return () => {
      cancelled = true;
      const live = useSessionStore.getState();
      for (const key of keys) {
        live.cancel(key);
      }
    };
    // `analysisKey` covers every primitive of `params`.
  }, [original, samples, sampleRateHz, geometry, analysisKey, lane, override]);

  return { geometry, chunks: chunksRef.current, paintVersion, completedChunks, error };
}
