/**
 * Purpose: progressive STFT magnitude tiles for the spectrogram (F02). One
 * call computes a chunk of consecutive time frames from a bounded source
 * slice, so the UI can paint row chunks as they arrive. The function keeps no
 * state between calls: frames, spectra and windows are locals only (the
 * Wave-1 phase-vocoder retention lesson).
 *
 * Formula (N = payload length, L = windowLengthSamples, H = hopLengthSamples,
 * F = L, C = floor(F/2) + 1):
 *   frame m (global) starts at m*H; local start = m*H - sourceStartSample
 *   sampled frames are m = rowStart + r*frameStride (r = 0..rowCount-1)
 *   y_m[n] = x[localStart + n] * w[n], zero outside the payload
 *   X_m = rfft(y_m), bin k = 0..C-1, FFT length F (unnormalized)
 *   A_m[k] = |X_m[k]| * s_k / sum(w), s_k = 1 at DC/Nyquist, 2 otherwise
 *   dB_m[k] = max(20*log10(max(A_m[k], 1e-12)), dbFloorDb)
 * Rows are frame-major: rows[m*C + k]. The window's coherent gain is removed
 * and the one-sided amplitude is restored, so 0 dB is a full-scale sinusoid
 * at any window family/length (documented in the UI).
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * sections 10.3-10.4; Harris, "On the use of windows for harmonic analysis
 * with the discrete Fourier transform", Proc. IEEE 66(1), 1978.
 *
 * Complexity: O(rowCount * F * log F) time, O(rowCount * C) output space.
 * Per-frame temporaries are O(F). No module-level cache.
 *
 * Edge cases: windowLengthSamples must be an integer >= 2; rowStart >= 0,
 * rowCount >= 0; frameStride an integer >= 1; hopFraction in (0, 1];
 * sampleRateHz, dbFloorDb finite;
 * sourceStartSample must equal rowStart*H (otherwise the slice and frame
 * indexes disagree -> RangeError). A negative local start -> RangeError.
 * Frames that run past the payload are zero-padded. Silent spectra clamp to
 * dbFloorDb. Non-finite samples -> TypeError. Inputs are never mutated.
 */

import { rfft } from "./rfft.js";
import { kaiser, type WindowKind, window } from "./windows.js";

export type SpectrogramWindowFamily = WindowKind | "kaiser";

export interface SpectrogramTilesParams {
  sampleRateHz: number;
  windowFamily: SpectrogramWindowFamily;
  windowLengthSamples: number;
  /** H = max(1, round(windowLengthSamples * hopFraction)). */
  hopFraction: number;
  dbFloorDb: number;
  /** First global frame index in this chunk. */
  rowStart: number;
  rowCount: number;
  /** Analyse every `frameStride`-th frame (column decimation, default 1). */
  frameStride?: number;
  /** Global source index of the payload's first sample. */
  sourceStartSample: number;
}

export interface SpectrogramTilesResult {
  /** Frame-major dB magnitudes, rowCount * columnCount. */
  rows: Float32Array;
  rowStart: number;
  rowCount: number;
  frameStride: number;
  columnCount: number;
  frameLengthSamples: number;
  hopLengthSamples: number;
  fftLengthSamples: number;
  sampleRateHz: number;
  dbFloorDb: number;
  sourceStartSample: number;
}

const WINDOW_FAMILIES: readonly SpectrogramWindowFamily[] = [
  "rect",
  "hann",
  "hamming",
  "blackman",
  "kaiser",
];

function validate(params: SpectrogramTilesParams): void {
  if (!Number.isFinite(params.sampleRateHz) || params.sampleRateHz <= 0) {
    throw new RangeError(`spectrogramTiles: invalid sampleRateHz ${params.sampleRateHz}`);
  }
  if (!WINDOW_FAMILIES.includes(params.windowFamily)) {
    throw new RangeError(`spectrogramTiles: unknown windowFamily ${String(params.windowFamily)}`);
  }
  if (!Number.isInteger(params.windowLengthSamples) || params.windowLengthSamples < 2) {
    throw new RangeError(
      `spectrogramTiles: windowLengthSamples must be an integer >= 2 (got ${params.windowLengthSamples})`,
    );
  }
  if (!Number.isFinite(params.hopFraction) || params.hopFraction <= 0 || params.hopFraction > 1) {
    throw new RangeError(
      `spectrogramTiles: hopFraction must be in (0, 1] (got ${params.hopFraction})`,
    );
  }
  if (!Number.isFinite(params.dbFloorDb) || params.dbFloorDb > 0) {
    throw new RangeError(
      `spectrogramTiles: dbFloorDb must be finite and <= 0 (got ${params.dbFloorDb})`,
    );
  }
  if (!Number.isInteger(params.rowStart) || params.rowStart < 0) {
    throw new RangeError(
      `spectrogramTiles: rowStart must be an integer >= 0 (got ${params.rowStart})`,
    );
  }
  if (!Number.isInteger(params.rowCount) || params.rowCount < 0) {
    throw new RangeError(
      `spectrogramTiles: rowCount must be an integer >= 0 (got ${params.rowCount})`,
    );
  }
  if (params.frameStride !== undefined) {
    if (!Number.isInteger(params.frameStride) || params.frameStride < 1) {
      throw new RangeError(
        `spectrogramTiles: frameStride must be an integer >= 1 (got ${params.frameStride})`,
      );
    }
  }
  if (!Number.isInteger(params.sourceStartSample) || params.sourceStartSample < 0) {
    throw new RangeError(
      `spectrogramTiles: sourceStartSample must be an integer >= 0 (got ${params.sourceStartSample})`,
    );
  }
}

export function spectrogramTiles(
  samples: Float32Array | Float64Array,
  params: SpectrogramTilesParams,
): SpectrogramTilesResult {
  validate(params);
  const windowLengthSamples = params.windowLengthSamples;
  const hopLengthSamples = Math.max(1, Math.round(windowLengthSamples * params.hopFraction));
  const frameStride = params.frameStride ?? 1;
  const columnCount = Math.floor(windowLengthSamples / 2) + 1;
  if (params.sourceStartSample !== params.rowStart * hopLengthSamples) {
    throw new RangeError(
      `spectrogramTiles: sourceStartSample ${params.sourceStartSample} does not match rowStart*hop ${params.rowStart * hopLengthSamples}`,
    );
  }
  const analysisWindow =
    params.windowFamily === "kaiser"
      ? kaiser(windowLengthSamples, 8.6)
      : window(params.windowFamily, windowLengthSamples);
  let coherentGain = 0;
  for (const weight of analysisWindow) {
    coherentGain += weight;
  }
  if (!(coherentGain > 0) || !Number.isFinite(coherentGain)) {
    throw new RangeError("spectrogramTiles: analysis window has zero coherent gain");
  }
  const nyquistColumn = columnCount - 1;
  const rows = new Float32Array(params.rowCount * columnCount);
  const frame = new Float64Array(windowLengthSamples);

  for (let row = 0; row < params.rowCount; row += 1) {
    const localStart = row * frameStride * hopLengthSamples;
    if (localStart < 0) {
      throw new RangeError(`spectrogramTiles: negative frame start ${localStart}`);
    }
    frame.fill(0);
    const available = Math.min(windowLengthSamples, samples.length - localStart);
    for (let n = 0; n < available; n += 1) {
      const sample = samples[localStart + n];
      if (sample === undefined) {
        throw new TypeError(`spectrogramTiles: sample ${localStart + n} read out of bounds`);
      }
      if (!Number.isFinite(sample)) {
        throw new TypeError(`spectrogramTiles: sample ${localStart + n} is not finite`);
      }
      const weight = analysisWindow[n];
      if (weight === undefined) {
        throw new TypeError(`spectrogramTiles: window ${n} read out of bounds`);
      }
      frame[n] = sample * weight;
    }
    const spectrum = rfft(frame);
    const rowOffset = row * columnCount;
    for (let column = 0; column < columnCount; column += 1) {
      const re = spectrum.re[column];
      const im = spectrum.im[column];
      if (re === undefined || im === undefined) {
        throw new TypeError(`spectrogramTiles: bin ${column} read out of bounds`);
      }
      const oneSidedScale = column === 0 || column === nyquistColumn ? 1 : 2;
      const amplitude = (Math.sqrt(re * re + im * im) * oneSidedScale) / coherentGain;
      const db = 20 * Math.log10(Math.max(amplitude, 1e-12));
      rows[rowOffset + column] = Math.max(params.dbFloorDb, db);
    }
  }

  return {
    rows,
    rowStart: params.rowStart,
    rowCount: params.rowCount,
    frameStride,
    columnCount,
    frameLengthSamples: windowLengthSamples,
    hopLengthSamples,
    fftLengthSamples: windowLengthSamples,
    sampleRateHz: params.sampleRateHz,
    dbFloorDb: params.dbFloorDb,
    sourceStartSample: params.sourceStartSample,
  };
}
