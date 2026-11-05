/**
 * DSP op table — the extension point for every worker op (spec §2.3, D-018).
 *
 * **Adding an op (the one-entry rule):** add exactly ONE entry here — params
 * type, result type, handler — and the typed wire unions in `protocol.ts`
 * (`DspOpRequest` / `DspOpResponse`) and the typed `rpc.call(op, params…)`
 * surface extend automatically. The worker's dispatch switch must then gain
 * one `case` for the new op (enforced: the handler record
 * `dspHandlers satisfies DspOpHandlers` in `dsp.worker.ts` — a table entry
 * without a handler entry fails typecheck with TS1360). No other wire type
 * is hand-written per op.
 *
 * Handlers are pure over `@avalab/dsp` inputs only; they receive validated
 * shapes (frame validation happens in `protocol.ts` boundary consumers) and
 * throw `DspOpError({"badParams", …})` on bad params — the worker converts
 * every throw to a typed error frame, never a crash. The op table imports
 * `@avalab/dsp` helpers for its handlers, but only the WORKER imports this
 * module at runtime (rpc/store import types only), so the DSP still runs off
 * the main thread (AGENTS §9).
 *
 * Error codes on the wire (frontend translates by code, wave-0 model):
 * `badParams` — malformed/missing params; `unknownOp` — op not in the table;
 * `opFailed` — unexpected handler crash (logged, never swallowed).
 */

import {
  alawDecode,
  alawEncode,
  aliasFrequencyHz,
  applyFilter,
  averagePower,
  bandAthDb,
  bandLevelsDb,
  barkBandEdgesHz,
  biquadHighpass,
  biquadLowpass,
  biquadNotch,
  biquadPeaking,
  buildHistogram,
  bytesToInt16Pcm,
  type CodecLabCodec,
  classifySignalType,
  computePeakBuckets,
  spectrogramTiles as computeSpectrogramTiles,
  convolveDirect,
  convolveFft,
  decodeLosslessDeltaHuffman,
  decodeMdct,
  decodeMdctPsycho,
  designButterworth,
  designChebyshev1,
  designFirWindow,
  editSpectrum,
  encodeLosslessDeltaHuffman,
  encodeMdct,
  encodeMdctPsycho,
  entropyBitsPerSymbol,
  type FilterApplyParams,
  fft,
  floatToInt16Pcm,
  freqz,
  generateChirp,
  generateImpulse,
  generatePinkNoise,
  generateSawtooth,
  generateSine,
  generateSquare,
  generateStep,
  generateSyntheticIr,
  generateTriangle,
  generateTwoTone,
  generateWhiteNoise,
  groupDelaySamples,
  huffmanDecode,
  huffmanEncode,
  hzToBark,
  impulseResponse,
  int16PcmToBytes,
  int16PcmToFloat,
  isStable,
  kaiser,
  magnitudeDb,
  maskingThresholdDb,
  mdct,
  measureReferencePower,
  mse,
  mulawDecode,
  mulawEncode,
  type PipelineGraph,
  type PipelineOutput,
  PipelineRunError,
  type PipelineStageSummary,
  PSYCHO_REFERENCE_SPL_DB,
  periodicExtend,
  pitchShift,
  polesZeros,
  psnrDb,
  quantizationError,
  quantizeUniform,
  quantizeWithTpdfDither,
  type ReverbIrParams,
  type ReverbProcessParams,
  resampleRational,
  reverse,
  rleDecode,
  rleEncode,
  runPipeline,
  type SpectrogramTilesParams,
  type SpectrumEdit,
  type SyntheticIrKind,
  segmentalSnrDb,
  signalEnergy,
  signalToMaskRatioDb,
  snrDb,
  spreadingDb,
  stepResponse,
  support,
  timeScale,
  timeShift,
  timeStretch,
  truncate,
  unwrapPhase,
  window,
  zeroPad,
} from "@avalab/dsp";
import type { TransferablePayload } from "./protocol";

/**
 * Every op's result rides `response.result` and may carry a transferred
 * payload buffer; `meta` is small structured data (readout, stats).
 */
export type DspOpResultBase = {
  meta?: Record<string, unknown>;
  payload?: TransferablePayload;
};

/**
 * One op: the params/result types (the table entry is the source of truth
 * for the typed RPC surface; the lens values in `dspOps` are type carriers
 * only, never read at runtime) plus the handler the worker dispatches to.
 * `handler` is typed `never`-param so `satisfies DspOpTable` stays sound
 * under `--strictFunctionTypes` contravariance while entries are correlated.
 */
export type DspOp<TParams, TResult extends DspOpResultBase> = {
  params: TParams;
  result: TResult;
  handler: (params: never, payload?: TransferablePayload) => TResult;
};

export type DspOpTable = {
  readonly [name: string]: DspOp<unknown, DspOpResultBase>;
};

export type DspOpName = keyof typeof dspOps & string;
export type DspOpParams<K extends DspOpName> = (typeof dspOps)[K]["params"];
export type DspOpResult<K extends DspOpName> = (typeof dspOps)[K]["result"];

/** Typed handler failure; code is the frontend's i18n key alongside the message. */
export class DspOpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DspOpError";
  }
}

export type SessionPingParams = { count: number };
export type SessionPingResult = {
  meta: { received: true };
  payload?: TransferablePayload;
};

/**
 * Round-trips a payload untouched, exercising the transfer semantics of the
 * protocol (payload moves out of the sender, worker sees the same bytes,
 * result carries the descriptor back out of the worker). Pure byte plumbing:
 * no dsp math, no copying beyond the boundary normalization `rpc.ts` does.
 */
export function sessionPing(
  params: SessionPingParams,
  payload?: TransferablePayload,
): SessionPingResult {
  if (
    params === undefined ||
    params === null ||
    typeof params.count !== "number" ||
    !Number.isInteger(params.count) ||
    params.count < 0
  ) {
    throw new DspOpError(
      "badParams",
      `sessionPing: count must be a non-negative integer, got ${String(params?.count ?? params)}`,
    );
  }
  return { meta: { received: true }, payload };
}

export type WaveformOverviewParams = { bucketCount: number; sampleRateHz: number };
export type WaveformOverviewResult = {
  meta: { sampleCount: number; sampleRateHz: number; bucketCount: number };
  /** Interleaved min/max peak buckets (2·bucketCount Float32 values) as a
   * transferred payload descriptor; see `computePeakBuckets` in @avalab/dsp. */
  payload?: TransferablePayload;
};

/**
 * Waveform overview (F02 groundwork): bucket the request payload's Float32
 * source samples into exact per-bucket min/max envelope pairs. The payload IS
 * the session source (the store's `deriveWithSource` copies `original.samples`
 * and transfers the copy); the result is self-describing — `sampleCount` is
 * read off the payload, `bucketCount` is derived from the returned payload's
 * length (byteLength/8; equals the params' value for a valid call), and
 * `sampleRateHz` echoes the params so the UI never has to re-derive rate
 * metadata.
 */
export function waveformOverview(
  params: WaveformOverviewParams,
  payload?: TransferablePayload,
): WaveformOverviewResult {
  if (
    params === undefined ||
    params === null ||
    typeof params.bucketCount !== "number" ||
    !Number.isInteger(params.bucketCount) ||
    params.bucketCount < 1 ||
    typeof params.sampleRateHz !== "number" ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0
  ) {
    throw new DspOpError(
      "badParams",
      `waveformOverview: bucketCount must be a positive integer and sampleRateHz a positive finite number, got ${String(params)}`,
    );
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "waveformOverview: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError(
      "badPayload",
      `waveformOverview: payload must be Float32-aligned, got byteOffset ${String(payload.byteOffset)}/byteLength ${String(payload.byteLength)}`,
    );
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  const minMax = computePeakBuckets(samples, params.bucketCount);
  return {
    meta: {
      sampleCount: samples.length,
      sampleRateHz: params.sampleRateHz,
      // Self-description from the actual result: 2 interleaved Float32 = 8
      // bytes per bucket, so an empty source (length-0 minMax) reports 0
      // buckets instead of echoing an inapplicable params.bucketCount.
      bucketCount: minMax.byteLength / 8,
    },
    payload: { buffer: minMax.buffer, byteOffset: 0, byteLength: minMax.byteLength },
  };
}

export type WaveformRangeParams = {
  bucketCount: number;
  sampleRateHz: number;
  startSample: number;
  endSample: number;
};
export type WaveformRangeResult = {
  meta: {
    sampleCount: number;
    sampleRateHz: number;
    bucketCount: number;
    startSample: number;
    endSample: number;
  };
  payload?: TransferablePayload;
};

/**
 * Zoomed waveform envelope: the request payload is already the source slice
 * `[startSample, endSample)`, so the handler only buckets those samples. The
 * start/end params are echoed for the view's time axis and pin the range in
 * the store cache key.
 */
export function waveformRange(
  params: WaveformRangeParams,
  payload?: TransferablePayload,
): WaveformRangeResult {
  if (
    params === undefined ||
    params === null ||
    !Number.isInteger(params.bucketCount) ||
    params.bucketCount < 1 ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    !Number.isInteger(params.startSample) ||
    !Number.isInteger(params.endSample) ||
    params.startSample < 0 ||
    params.endSample < params.startSample
  ) {
    throw new DspOpError("badParams", `waveformRange: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "waveformRange: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError(
      "badPayload",
      `waveformRange: payload must be Float32-aligned, got byteOffset ${String(payload.byteOffset)}/byteLength ${String(payload.byteLength)}`,
    );
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  const minMax =
    samples.length === 0
      ? new Float32Array(0)
      : computePeakBuckets(samples, Math.min(params.bucketCount, Math.max(1, samples.length)));
  return {
    meta: {
      sampleCount: samples.length,
      sampleRateHz: params.sampleRateHz,
      bucketCount: minMax.byteLength / 8,
      startSample: params.startSample,
      endSample: params.endSample,
    },
    payload: { buffer: minMax.buffer, byteOffset: 0, byteLength: minMax.byteLength },
  };
}

export type WaveformEnvelopeParams = { bucketCount: number };
export type WaveformEnvelopeResult = {
  meta: { bucketCount: number };
  payload?: TransferablePayload;
};

/** Display-only min/max envelope for canvases that are not tied to a source
 * range. Empty input keeps one zero pair so painters never divide by zero. */
export function waveformEnvelope(
  params: WaveformEnvelopeParams,
  payload?: TransferablePayload,
): WaveformEnvelopeResult {
  if (
    params === undefined ||
    params === null ||
    !Number.isInteger(params.bucketCount) ||
    params.bucketCount < 1
  ) {
    throw new DspOpError("badParams", `waveformEnvelope: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "waveformEnvelope: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError(
      "badPayload",
      `waveformEnvelope: payload must be Float32-aligned, got byteOffset ${String(payload.byteOffset)}/byteLength ${String(payload.byteLength)}`,
    );
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  if (samples.length === 0) {
    const empty = new Float32Array(2);
    return {
      meta: { bucketCount: 1 },
      payload: { buffer: empty.buffer, byteOffset: 0, byteLength: empty.byteLength },
    };
  }
  const minMax = computePeakBuckets(samples, params.bucketCount);
  return {
    meta: { bucketCount: minMax.byteLength / 8 },
    payload: { buffer: minMax.buffer, byteOffset: 0, byteLength: minMax.byteLength },
  };
}

export type QualityMetricsParams = { sampleRateHz: number; sampleCount: number };
export type QualityMetricsResult = {
  meta: { sampleCount: number; sampleRateHz: number };
  mse: number;
  snrDb: number;
  segmentalSnrDb: number;
  psnrDb: number;
};

/** F05 metrics over a combined `reference ++ test` Float32 payload. Keeping
 * both lanes in one transfer avoids a second protocol shape. */
export function qualityMetrics(
  params: QualityMetricsParams,
  payload?: TransferablePayload,
): QualityMetricsResult {
  if (
    params === undefined ||
    params === null ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    !Number.isInteger(params.sampleCount) ||
    params.sampleCount < 1
  ) {
    throw new DspOpError("badParams", `qualityMetrics: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "qualityMetrics: a Float32 payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError(
      "badPayload",
      `qualityMetrics: payload must be Float32-aligned, got byteOffset ${String(payload.byteOffset)}/byteLength ${String(payload.byteLength)}`,
    );
  }
  const combined = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  if (combined.length !== params.sampleCount * 2) {
    throw new DspOpError(
      "badPayload",
      `qualityMetrics: expected ${String(params.sampleCount * 2)} samples, got ${String(combined.length)}`,
    );
  }
  const reference = combined.subarray(0, params.sampleCount);
  const test = combined.subarray(params.sampleCount);
  for (let index = 0; index < combined.length; index += 1) {
    if (!Number.isFinite(combined[index])) {
      throw new DspOpError("badPayload", `qualityMetrics: sample ${String(index)} is not finite`);
    }
  }
  const frameLengthSamples = Math.max(1, Math.round(0.02 * params.sampleRateHz));
  return {
    meta: { sampleCount: params.sampleCount, sampleRateHz: params.sampleRateHz },
    mse: mse(reference, test),
    snrDb: snrDb(reference, test),
    segmentalSnrDb: segmentalSnrDb(reference, test, { frameLengthSamples }),
    psnrDb: psnrDb(reference, test, { peak: 1 }),
  };
}

export type { SpectrogramTilesParams };
export type SpectrogramTilesResult = {
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
};

/**
 * One progressive spectrogram row chunk. The request payload is the bounded
 * source slice for these frames; the handler derives one frame chunk and
 * transfers a Float32 dB map back. No frames or spectra survive the call.
 */
export function spectrogramTiles(
  params: SpectrogramTilesParams,
  payload?: TransferablePayload,
): SpectrogramTilesResult {
  if (payload === undefined) {
    throw new DspOpError("badPayload", "spectrogramTiles: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError(
      "badPayload",
      `spectrogramTiles: payload must be Float32-aligned, got byteOffset ${String(payload.byteOffset)}/byteLength ${String(payload.byteLength)}`,
    );
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  let result: ReturnType<typeof computeSpectrogramTiles>;
  try {
    result = computeSpectrogramTiles(samples, params);
  } catch (error) {
    if (error instanceof Error && error.name === "RangeError") {
      throw new DspOpError("badParams", error.message);
    }
    if (error instanceof Error && error.name === "TypeError") {
      throw new DspOpError("badPayload", error.message);
    }
    throw error;
  }
  const rows = new Float32Array(result.rows);
  return {
    meta: {
      rowStart: result.rowStart,
      rowCount: result.rowCount,
      frameStride: result.frameStride,
      columnCount: result.columnCount,
      hopLengthSamples: result.hopLengthSamples,
      fftLengthSamples: result.fftLengthSamples,
      sampleRateHz: result.sampleRateHz,
      dbFloorDb: result.dbFloorDb,
      sourceStartSample: result.sourceStartSample,
    },
    payload: { buffer: rows.buffer, byteOffset: 0, byteLength: rows.byteLength },
  };
}

/** FFT length cap for the Fourier view (AGENTS §9 budgets): the whole-file
 * case would otherwise transform millions of samples for a chart nobody can
 * read. Longer selections analyse their first `FFT_MAX_LENGTH` samples and
 * the view prints the cap (D-021). */
export const FFT_MAX_LENGTH = 65_536;

/** Periodic analysis window; kaiser uses the pinned beta 8.6 (spectrogram). */
function windowForFamily(
  family: SpectrogramTilesParams["windowFamily"],
  length: number,
): Float64Array {
  return family === "kaiser" ? kaiser(length, 8.6) : window(family, length);
}

function nextPowerOfTwo(value: number): number {
  let size = 2;
  while (size < value) {
    size *= 2;
  }
  return size;
}

export type FftSelectionParams = {
  sampleRateHz: number;
  startSample: number;
  endSample: number;
  windowFamily: SpectrogramTilesParams["windowFamily"];
  windowLengthSamples: number;
  magnitudeMode: "db" | "linear";
  phaseMode: "wrapped" | "unwrapped";
};
export type FftSelectionResult = {
  meta: {
    sampleRateHz: number;
    startSample: number;
    endSample: number;
    binCount: number;
    fftLengthSamples: number;
    analysisLengthSamples: number;
    zeroPadSamples: number;
    capped: boolean;
    magnitudeMode: "db" | "linear";
    phaseMode: "wrapped" | "unwrapped";
  };
  /** `[frequencyBinsHz | magnitude | phase]`, each `binCount` Float64. */
  payload?: TransferablePayload;
};

/**
 * Single-frame spectrum of the selection slice (F08): window → zero-pad to
 * the next power of two → rfft. Magnitude is amplitude-referenced
 * (`|X[k]| / Σw`, so 0 dB = full-scale sinusoid bin, matching D-020) and the
 * phase is wrapped atan2 or dsp-unwrapped. No new math: the dsp `fft`,
 * `window`, `magnitudeDb` and `unwrapPhase` do the work.
 */
export function fftSelection(
  params: FftSelectionParams,
  payload?: TransferablePayload,
): FftSelectionResult {
  if (
    params === undefined ||
    params === null ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    !Number.isInteger(params.startSample) ||
    !Number.isInteger(params.endSample) ||
    params.startSample < 0 ||
    params.endSample < params.startSample ||
    !Number.isInteger(params.windowLengthSamples) ||
    params.windowLengthSamples < 2 ||
    (params.magnitudeMode !== "db" && params.magnitudeMode !== "linear") ||
    (params.phaseMode !== "wrapped" && params.phaseMode !== "unwrapped")
  ) {
    throw new DspOpError("badParams", `fftSelection: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "fftSelection: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badPayload", "fftSelection: payload must be Float32-aligned");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  const analysisLength = Math.min(samples.length, FFT_MAX_LENGTH);
  if (analysisLength < 1) {
    throw new DspOpError("badParams", "fftSelection: the selection is empty");
  }
  const fftLengthSamples = nextPowerOfTwo(analysisLength);
  const windowLengthSamples = Math.min(params.windowLengthSamples, fftLengthSamples);
  const windowValues = windowForFamily(params.windowFamily, windowLengthSamples);
  let windowSum = 0;
  for (const value of windowValues) {
    windowSum += value;
  }
  const frame = new Float64Array(fftLengthSamples);
  for (let index = 0; index < windowLengthSamples; index += 1) {
    frame[index] = (samples[index] ?? 0) * (windowValues[index] ?? 0);
  }
  const spectrum = fft(frame);
  const binCount = spectrum.re.length;
  const frequencies = new Float64Array(binCount);
  const magnitudes = new Float64Array(binCount);
  const phases = new Float64Array(binCount);
  // 2/Σw: 0 dB = full-scale sinusoid bin (D-020 amplitude reference).
  const scale = windowSum > 0 ? 2 / windowSum : 0;
  for (let bin = 0; bin < binCount; bin += 1) {
    frequencies[bin] = (bin * params.sampleRateHz) / fftLengthSamples;
    magnitudes[bin] = Math.hypot(spectrum.re[bin] ?? 0, spectrum.im[bin] ?? 0) * scale;
    phases[bin] = Math.atan2(spectrum.im[bin] ?? 0, spectrum.re[bin] ?? 0);
  }
  const magnitudeValues = params.magnitudeMode === "db" ? magnitudeDb(magnitudes) : magnitudes;
  const phaseValues = params.phaseMode === "unwrapped" ? unwrapPhase(phases) : phases;
  const packed = new Float64Array(binCount * 3);
  packed.set(frequencies, 0);
  packed.set(magnitudeValues, binCount);
  packed.set(phaseValues, binCount * 2);
  return {
    meta: {
      sampleRateHz: params.sampleRateHz,
      startSample: params.startSample,
      endSample: params.endSample,
      binCount,
      fftLengthSamples,
      analysisLengthSamples: analysisLength,
      zeroPadSamples: fftLengthSamples - analysisLength,
      capped: params.endSample - params.startSample > FFT_MAX_LENGTH,
      magnitudeMode: params.magnitudeMode,
      phaseMode: params.phaseMode,
    },
    payload: { buffer: packed.buffer, byteOffset: 0, byteLength: packed.byteLength },
  };
}

export type SpectrumEditParams = {
  sampleRateHz: number;
  startSample: number;
  endSample: number;
  edits: readonly SpectrumEdit[];
  hermitian: boolean;
};
export type SpectrumEditResult = {
  meta: {
    sampleRateHz: number;
    startSample: number;
    endSample: number;
    sampleCount: number;
    fftLengthSamples: number;
    binCount: number;
    frequencyResolutionHz: number;
    imaginaryEnergyRatio: number;
    capped: boolean;
    editsApplied: number;
  };
  /** `[samples | re | im | magnitude | phase]`; samples are Float32 values
   * widened to Float64, each spectrum section is `binCount` long. */
  payload?: TransferablePayload;
};

/**
 * F09 worker wrapper: copies the selected source prefix into Float64, runs
 * the dsp `editSpectrum` (rectangular window, zero-pad, optional Hermitian
 * mirroring) and packs the edited audio plus the post-edit one-sided spectra
 * for the charts. Selection beyond `FFT_MAX_LENGTH` analyses the prefix and
 * reports `capped` (D-021).
 */
export function spectrumEdit(
  params: SpectrumEditParams,
  payload?: TransferablePayload,
): SpectrumEditResult {
  if (
    params === undefined ||
    params === null ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    params.sampleRateHz > 96_000 ||
    !Number.isInteger(params.startSample) ||
    !Number.isInteger(params.endSample) ||
    params.startSample < 0 ||
    params.endSample < params.startSample ||
    !Array.isArray(params.edits) ||
    typeof params.hermitian !== "boolean"
  ) {
    throw new DspOpError("badParams", `spectrumEdit: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "spectrumEdit: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badPayload", "spectrumEdit: payload must be Float32-aligned");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  const analysisLength = Math.min(samples.length, FFT_MAX_LENGTH);
  if (analysisLength < 1) {
    throw new DspOpError("badParams", "spectrumEdit: the selection is empty");
  }
  const input = new Float64Array(analysisLength);
  for (let index = 0; index < analysisLength; index += 1) {
    input[index] = samples[index] ?? 0;
  }
  const fftLengthSamples = analysisLength <= 1 ? 1 : nextPowerOfTwo(analysisLength);
  let edited: ReturnType<typeof editSpectrum>;
  try {
    edited = editSpectrum(input, {
      fftLengthSamples,
      edits: params.edits,
      hermitian: params.hermitian,
    });
  } catch (error) {
    throw new DspOpError("badParams", `spectrumEdit: ${String(error)}`);
  }
  const sampleCount = edited.samples.length;
  const binCount = edited.re.length;
  const packed = new Float64Array(sampleCount + binCount * 4);
  for (let index = 0; index < sampleCount; index += 1) {
    packed[index] = Math.fround(edited.samples[index] ?? 0);
  }
  packed.set(edited.re, sampleCount);
  packed.set(edited.im, sampleCount + binCount);
  packed.set(edited.magnitude, sampleCount + binCount * 2);
  packed.set(edited.phase, sampleCount + binCount * 3);
  return {
    meta: {
      sampleRateHz: params.sampleRateHz,
      startSample: params.startSample,
      endSample: params.endSample,
      sampleCount,
      fftLengthSamples,
      binCount,
      frequencyResolutionHz: params.sampleRateHz / fftLengthSamples,
      imaginaryEnergyRatio: edited.imaginaryEnergyRatio,
      capped: params.endSample - params.startSample > FFT_MAX_LENGTH,
      editsApplied: params.edits.length,
    },
    payload: { buffer: packed.buffer, byteOffset: 0, byteLength: packed.byteLength },
  };
}

export type WindowProfilesParams = {
  sampleRateHz: number;
  windowLengthSamples: number;
};
export type WindowProfileFamily = "rect" | "hann" | "hamming" | "blackman" | "kaiser";
export const WINDOW_PROFILE_FAMILIES: readonly WindowProfileFamily[] = [
  "rect",
  "hann",
  "hamming",
  "blackman",
  "kaiser",
];
export type WindowProfilesResult = {
  meta: {
    families: WindowProfileFamily[];
    binCount: number;
    fftLengthSamples: number;
    sampleRateHz: number;
    windowLengthSamples: number;
    mainLobeWidthsHz: number[];
    sideLobeLevelsDb: number[];
  };
  /** `families.length * binCount` dB rows, family-major. */
  payload?: TransferablePayload;
};

/**
 * Window comparison profiles (F08): the same periodic windows used for
 * analysis, zero-padded to `nextPow2(4L)` and transformed to a coherent-gain
 * normalized dB response. Main-lobe width = twice the first response null
 * (first local minimum away from DC); side-lobe level = the maximum dB
 * outside that null. The dsp `windows` exports stay untouched.
 */
export function windowProfiles(
  params: WindowProfilesParams,
  _payload?: TransferablePayload,
): WindowProfilesResult {
  if (
    params === undefined ||
    params === null ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    !Number.isInteger(params.windowLengthSamples) ||
    params.windowLengthSamples < 8
  ) {
    throw new DspOpError("badParams", `windowProfiles: invalid params ${String(params)}`);
  }
  const fftLengthSamples = nextPowerOfTwo(Math.max(4096, params.windowLengthSamples * 4));
  const binCount = fftLengthSamples / 2 + 1;
  const packed = new Float64Array(WINDOW_PROFILE_FAMILIES.length * binCount);
  const mainLobeWidthsHz: number[] = [];
  const sideLobeLevelsDb: number[] = [];
  for (let familyIndex = 0; familyIndex < WINDOW_PROFILE_FAMILIES.length; familyIndex += 1) {
    const family = WINDOW_PROFILE_FAMILIES[familyIndex] ?? "rect";
    const values = windowForFamily(family, params.windowLengthSamples);
    let windowSum = 0;
    for (const value of values) {
      windowSum += value;
    }
    const frame = new Float64Array(fftLengthSamples);
    frame.set(values, 0);
    const spectrum = fft(frame);
    const magnitudes = new Float64Array(binCount);
    for (let bin = 0; bin < binCount; bin += 1) {
      magnitudes[bin] = Math.hypot(spectrum.re[bin] ?? 0, spectrum.im[bin] ?? 0) / windowSum;
    }
    const decibels = magnitudeDb(magnitudes);
    packed.set(decibels, familyIndex * binCount);
    let firstNull = binCount - 1;
    for (let bin = 1; bin < binCount - 1; bin += 1) {
      const previous = decibels[bin - 1] ?? 0;
      const current = decibels[bin] ?? 0;
      const next = decibels[bin + 1] ?? 0;
      if (current <= previous && current <= next) {
        firstNull = bin;
        break;
      }
    }
    let sideLobe = Number.NEGATIVE_INFINITY;
    for (let bin = firstNull + 1; bin < binCount; bin += 1) {
      sideLobe = Math.max(sideLobe, decibels[bin] ?? sideLobe);
    }
    mainLobeWidthsHz.push((2 * firstNull * params.sampleRateHz) / fftLengthSamples);
    sideLobeLevelsDb.push(Number.isFinite(sideLobe) ? sideLobe : -120);
  }
  return {
    meta: {
      families: [...WINDOW_PROFILE_FAMILIES],
      binCount,
      fftLengthSamples,
      sampleRateHz: params.sampleRateHz,
      windowLengthSamples: params.windowLengthSamples,
      mainLobeWidthsHz,
      sideLobeLevelsDb,
    },
    payload: { buffer: packed.buffer, byteOffset: 0, byteLength: packed.byteLength },
  };
}

export type SynthWaveform =
  | "sine"
  | "square"
  | "sawtooth"
  | "triangle"
  | "impulse"
  | "step"
  | "whiteNoise"
  | "pinkNoise"
  | "chirp"
  | "twoTone";
export type SpeedTransformParams = {
  sampleRateHz: number;
  startSample: number;
  endSample: number;
  mode: "resample" | "timeStretch";
  speedFactor: number;
  semitones: number;
  reverse: boolean;
};
export type SpeedTransformResult = {
  meta: {
    outputSampleCount: number;
    sampleRateHz: number;
    actualSpeedFactor: number;
    elapsedMs: number;
    capped: boolean;
  };
  payload?: TransferablePayload;
};

export type FilterDesignKind = "fir" | "butterworth" | "chebyshev1" | "biquad";
export type FilterBand = "lowpass" | "highpass" | "bandpass" | "bandstop" | "notch" | "peaking";
export type FilterWindowKind = "hamming" | "blackman" | "kaiser";

export type FilterDesignParams = {
  kind: FilterDesignKind;
  band: FilterBand;
  cutoffHz: number;
  cutoff2Hz?: number;
  order: number;
  taps: number;
  window: FilterWindowKind;
  rippleDb: number;
  q: number;
  gainDb: number;
  sampleRateHz: number;
};

export type FilterDesignResult = {
  meta?: { stable: boolean; delaySamples: number };
  payload?: TransferablePayload;
  b: number[];
  a: number[];
  frequenciesHz: number[];
  magnitudeDb: number[];
  phaseRad: number[];
  groupDelaySamples: number[];
  impulse: number[];
  step: number[];
  poles: { re: number; im: number }[];
  zeros: { re: number; im: number }[];
  stable: boolean;
  delaySamples: number;
};

const FILTER_DESIGN_POINTS = 512;
const FILTER_RESPONSE_SAMPLES = 256;
const FILTER_DB_FLOOR = -160;
const FILTER_ROOT_MAX_TAPS = 33;

function filterDesignBandValid(kind: FilterDesignKind, band: FilterBand): boolean {
  if (kind === "biquad") {
    return band === "lowpass" || band === "highpass" || band === "notch" || band === "peaking";
  }
  return band === "lowpass" || band === "highpass" || band === "bandpass" || band === "bandstop";
}

function filterDesignError(params: FilterDesignParams): string | null {
  if (!Number.isFinite(params.sampleRateHz) || params.sampleRateHz <= 0) {
    return "sampleRateHz must be finite and > 0";
  }
  if (!filterDesignBandValid(params.kind, params.band)) {
    return `${params.kind} does not support ${params.band}`;
  }
  const nyquistHz = params.sampleRateHz / 2;
  if (!Number.isFinite(params.cutoffHz) || params.cutoffHz <= 0 || params.cutoffHz >= nyquistHz) {
    return "cutoffHz must be inside (0, Nyquist)";
  }
  const needsSecondCutoff = params.band === "bandpass" || params.band === "bandstop";
  if (needsSecondCutoff) {
    if (
      !Number.isFinite(params.cutoff2Hz) ||
      (params.cutoff2Hz ?? 0) <= params.cutoffHz ||
      (params.cutoff2Hz ?? 0) >= nyquistHz
    ) {
      return "cutoff2Hz must be finite and greater than cutoffHz inside Nyquist";
    }
  }
  if (params.kind === "fir") {
    if (!Number.isInteger(params.taps) || params.taps < 3 || params.taps > 257) {
      return "taps must be an odd integer in [3, 257]";
    }
    if (params.taps % 2 === 0) {
      return "taps must be odd for a linear-phase FIR";
    }
    if (params.window !== "hamming" && params.window !== "blackman" && params.window !== "kaiser") {
      return "unknown FIR window";
    }
  } else if (params.kind === "biquad") {
    if (!Number.isFinite(params.q) || params.q <= 0) {
      return "q must be finite and > 0";
    }
    if (!Number.isFinite(params.gainDb)) {
      return "gainDb must be finite";
    }
  } else {
    if (!Number.isInteger(params.order) || params.order < 1 || params.order > 8) {
      return "order must be an integer in [1, 8]";
    }
    if (
      params.kind === "chebyshev1" &&
      (!Number.isFinite(params.rippleDb) || params.rippleDb <= 0)
    ) {
      return "rippleDb must be finite and > 0";
    }
  }
  return null;
}

/** F11 filter design: one `{b,a}` pair plus the analysis the view plots. */
export function filterDesign(
  params: FilterDesignParams,
  _payload?: TransferablePayload,
): FilterDesignResult {
  const error =
    params === null || params === undefined ? "missing params" : filterDesignError(params);
  if (error !== null) {
    throw new DspOpError("badParams", `filterDesign: ${error}`);
  }

  try {
    const cutoffHz =
      params.band === "bandpass" || params.band === "bandstop"
        ? [params.cutoffHz, params.cutoff2Hz ?? 0]
        : [params.cutoffHz];
    let b: Float64Array;
    let a: Float64Array;
    if (params.kind === "fir") {
      b = designFirWindow({
        band: params.band as "lowpass" | "highpass" | "bandpass" | "bandstop",
        cutoffHz,
        taps: params.taps,
        sampleRateHz: params.sampleRateHz,
        windowFilter: { kind: params.window },
      });
      a = new Float64Array([1]);
    } else if (params.kind === "butterworth" || params.kind === "chebyshev1") {
      const options = {
        band: params.band as "lowpass" | "highpass" | "bandpass" | "bandstop",
        cutoffHz,
        order: params.order,
        sampleRateHz: params.sampleRateHz,
      };
      const coefficients =
        params.kind === "butterworth"
          ? designButterworth(options)
          : designChebyshev1({ ...options, rippleDb: params.rippleDb });
      b = coefficients.b;
      a = coefficients.a;
    } else {
      const options = {
        frequencyHz: params.cutoffHz,
        q: params.q,
        sampleRateHz: params.sampleRateHz,
      };
      const coefficients =
        params.band === "lowpass"
          ? biquadLowpass(options)
          : params.band === "highpass"
            ? biquadHighpass(options)
            : params.band === "notch"
              ? biquadNotch(options)
              : biquadPeaking({ ...options, gainDb: params.gainDb });
      b = coefficients.b;
      a = coefficients.a;
    }

    const response = freqz(b, a, {
      numPoints: FILTER_DESIGN_POINTS,
      sampleRateHz: params.sampleRateHz,
    });
    const groupDelay = groupDelaySamples(b, a, {
      numPoints: FILTER_DESIGN_POINTS,
      sampleRateHz: params.sampleRateHz,
    });
    const roots =
      params.kind === "fir" && params.taps > FILTER_ROOT_MAX_TAPS ? null : polesZeros(b, a);
    const poles =
      roots === null
        ? []
        : Array.from(roots.poles.re, (re, index) => ({
            re,
            im: roots.poles.im[index] ?? 0,
          }));
    const zeros =
      roots === null
        ? []
        : Array.from(roots.zeros.re, (re, index) => ({
            re,
            im: roots.zeros.im[index] ?? 0,
          }));
    const impulse = impulseResponse(b, a, FILTER_RESPONSE_SAMPLES);
    const step = stepResponse(b, a, FILTER_RESPONSE_SAMPLES);
    const delaySamples =
      params.kind === "fir"
        ? Math.floor(params.taps / 2)
        : Math.max(0, Math.round(groupDelay[0] ?? 0));

    return {
      b: Array.from(b),
      a: Array.from(a),
      frequenciesHz: Array.from(response.frequencyHz),
      magnitudeDb: Array.from(magnitudeDb(response.magnitude), (value) =>
        Number.isFinite(value) ? Math.max(FILTER_DB_FLOOR, value) : FILTER_DB_FLOOR,
      ),
      phaseRad: Array.from(unwrapPhase(response.phaseRad)),
      groupDelaySamples: Array.from(groupDelay),
      impulse: Array.from(impulse),
      step: Array.from(step),
      poles,
      zeros,
      stable: roots === null ? true : isStable(roots.poles),
      delaySamples,
    };
  } catch (cause) {
    if (cause instanceof DspOpError) {
      throw cause;
    }
    throw new DspOpError(
      "badParams",
      `filterDesign: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export type FilterApplyResult = {
  samples: Float32Array;
  sampleRateHz: number;
  delaySamples: number;
  meta: {
    sampleCount: number;
    delaySamples: number;
    compensated: boolean;
    elapsedMs: number;
  };
  payload: TransferablePayload;
};

function filterApplyValid(params: FilterApplyParams | null | undefined): boolean {
  if (params === null || params === undefined) {
    return false;
  }
  return (
    Number.isFinite(params.sampleRateHz) &&
    params.sampleRateHz > 0 &&
    params.sampleRateHz <= 96_000 &&
    typeof params.fir === "boolean" &&
    typeof params.compensateDelay === "boolean" &&
    Array.isArray(params.b) &&
    Array.isArray(params.a) &&
    params.b.length > 0 &&
    params.b.length <= 4096 &&
    params.a.length > 0 &&
    params.a.length <= 64 &&
    params.b.every((value) => Number.isFinite(value)) &&
    params.a.every((value) => Number.isFinite(value)) &&
    (params.a[0] ?? 0) !== 0
  );
}

/** F11 filter apply: FIR through FFT convolution or IIR through direct form.
 * FIR reports its group delay and optionally trims it for preview alignment. */
export function filterApply(
  params: FilterApplyParams,
  payload?: TransferablePayload,
): FilterApplyResult {
  if (!filterApplyValid(params)) {
    throw new DspOpError("badParams", `filterApply: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "filterApply: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badPayload", "filterApply: payload must be Float32-aligned");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  if (samples.length === 0) {
    throw new DspOpError("badParams", "filterApply: the selection is empty");
  }
  for (let index = 0; index < samples.length; index += 1) {
    if (!Number.isFinite(samples[index])) {
      throw new DspOpError("badParams", `filterApply: samples[${index}] is not finite`);
    }
  }

  const startedMs = performance.now();
  const input = Float64Array.from(samples);
  let output: Float64Array;
  let delaySamples: number;
  try {
    if (params.fir) {
      const b = Float64Array.from(params.b);
      const full = convolveFft(input, b);
      delaySamples = Math.floor((params.b.length - 1) / 2);
      output = params.compensateDelay
        ? full.subarray(delaySamples, delaySamples + input.length)
        : full;
    } else {
      const b = Float64Array.from(params.b);
      const a = Float64Array.from(params.a);
      output = applyFilter(input, { b, a });
      const delay = groupDelaySamples(b, a, { numPoints: 8, sampleRateHz: params.sampleRateHz });
      const firstDelay = delay[0] ?? 0;
      delaySamples = Number.isFinite(firstDelay) ? Math.max(0, Math.round(firstDelay)) : 0;
    }
  } catch (cause) {
    if (cause instanceof DspOpError) {
      throw cause;
    }
    throw new DspOpError(
      "badParams",
      `filterApply: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const out = Float32Array.from(output);
  return {
    samples: out,
    sampleRateHz: params.sampleRateHz,
    delaySamples,
    meta: {
      sampleCount: out.length,
      delaySamples,
      compensated: params.fir && params.compensateDelay,
      elapsedMs: performance.now() - startedMs,
    },
    payload: { buffer: out.buffer, byteOffset: 0, byteLength: out.byteLength },
  };
}

/** F14 sinc super-resolution baseline: band-limited input -> target rate via
 * the same kaiser-sinc path the sampling lab uses. No model, fully offline. */
export type SuperresBaselineParams = {
  sampleRateHz: number;
  targetRateHz: number;
};
export type SuperresBaselineResult = {
  meta: {
    sampleCount: number;
    sampleRateHz: number;
    inputSampleRateHz: number;
    delaySamples: number;
    elapsedMs: number;
  };
  payload?: TransferablePayload;
};

export type ExtentOperation =
  | { operation: "identity" }
  | { operation: "shift"; shiftSamples: number }
  | { operation: "scale"; factor: number }
  | { operation: "reverse" }
  | { operation: "truncate"; startSampleIndex: number; lengthSamples: number }
  | { operation: "zeroPad"; padStartSamples: number; padEndSamples: number }
  | { operation: "periodicExtend"; repetitions: number };

export type ExtentProcessParams = { sampleRateHz: number } & ExtentOperation;

export type ExtentProcessResult = {
  meta: {
    outputSampleCount: number;
    durationSeconds: number;
    supportStartSample: number;
    supportEndSample: number;
    beforeSupportStartSample: number;
    beforeSupportEndSample: number;
    energy: number;
    averagePower: number;
    signalType: "energy" | "power";
    elapsedMs: number;
  };
  payload?: TransferablePayload;
};

/** Processed-playback cap in seconds (same limit as `speedTransform`). */
const MAX_EXTENT_OUTPUT_SECONDS = 300;

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function extentOperationError(operation: ExtentOperation): string | null {
  switch (operation.operation) {
    case "identity":
    case "reverse":
      return null;
    case "shift":
      return Number.isInteger(operation.shiftSamples) ? null : "shiftSamples must be an integer";
    case "scale":
      return Number.isFinite(operation.factor) && operation.factor > 0
        ? null
        : "factor must be positive and finite";
    case "truncate":
      return isNonNegativeInteger(operation.startSampleIndex) &&
        isNonNegativeInteger(operation.lengthSamples)
        ? null
        : "truncate indices must be non-negative integers";
    case "zeroPad":
      return isNonNegativeInteger(operation.padStartSamples) &&
        isNonNegativeInteger(operation.padEndSamples)
        ? null
        : "pad counts must be non-negative integers";
    case "periodicExtend":
      return Number.isInteger(operation.repetitions) && operation.repetitions >= 1
        ? null
        : "repetitions must be an integer >= 1";
    default:
      return "unknown operation";
  }
}

function expectedExtentLength(operation: ExtentOperation, inputLength: number): number {
  switch (operation.operation) {
    case "identity":
    case "shift":
    case "reverse":
      return inputLength;
    case "scale":
      return Math.round(inputLength / operation.factor);
    case "truncate":
      return Math.max(
        0,
        Math.min(inputLength, operation.startSampleIndex + operation.lengthSamples) -
          operation.startSampleIndex,
      );
    case "zeroPad":
      return inputLength + operation.padStartSamples + operation.padEndSamples;
    case "periodicExtend":
      return inputLength * operation.repetitions;
    default:
      return inputLength;
  }
}

/**
 * F07 signal-extent operation over the request payload (already the selected
 * source slice). Applies exactly one dsp extent function (identity copies),
 * then reports duration, support, energy, average power and the energy/power
 * classification. Output above the 300 s processed cap is rejected before
 * allocation; the view can play the result through the processed lane.
 */
export function extentProcess(
  params: ExtentProcessParams,
  payload?: TransferablePayload,
): ExtentProcessResult {
  if (
    params === undefined ||
    params === null ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    params.sampleRateHz > 96_000
  ) {
    throw new DspOpError("badParams", `extentProcess: invalid params ${String(params)}`);
  }
  const operationError = extentOperationError(params);
  if (operationError !== null) {
    throw new DspOpError("badParams", `extentProcess: ${operationError}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "extentProcess: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badPayload", "extentProcess: payload must be Float32-aligned");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  if (samples.length === 0) {
    throw new DspOpError("badParams", "extentProcess: the selection is empty");
  }

  const expectedLength = expectedExtentLength(params, samples.length);
  if (
    Number.isSafeInteger(expectedLength) &&
    expectedLength / params.sampleRateHz > MAX_EXTENT_OUTPUT_SECONDS
  ) {
    throw new DspOpError(
      "tooLong",
      `extentProcess: output is ${(expectedLength / params.sampleRateHz).toFixed(1)} s, ` +
        `above the ${MAX_EXTENT_OUTPUT_SECONDS} s processed cap`,
    );
  }

  const startedMs = performance.now();
  const input = Float64Array.from(samples);
  const beforeSupport = support(input, { threshold: 0 });
  let output: Float64Array;
  switch (params.operation) {
    case "identity":
      output = input.slice();
      break;
    case "shift":
      output = timeShift(input, params.shiftSamples);
      break;
    case "scale":
      output = timeScale(input, params.factor);
      break;
    case "reverse":
      output = reverse(input);
      break;
    case "truncate":
      output = truncate(input, params.startSampleIndex, params.lengthSamples);
      break;
    case "zeroPad":
      output = zeroPad(input, params.padStartSamples, params.padEndSamples);
      break;
    case "periodicExtend":
      output = periodicExtend(input, params.repetitions);
      break;
    default:
      throw new DspOpError("badParams", "extentProcess: unknown operation");
  }
  if (output.length / params.sampleRateHz > MAX_EXTENT_OUTPUT_SECONDS) {
    throw new DspOpError(
      "tooLong",
      `extentProcess: output is ${(output.length / params.sampleRateHz).toFixed(1)} s, ` +
        `above the ${MAX_EXTENT_OUTPUT_SECONDS} s processed cap`,
    );
  }
  const elapsedMs = performance.now() - startedMs;
  const supportRange = support(output, { threshold: 0 });
  const out = Float32Array.from(output);
  return {
    meta: {
      outputSampleCount: out.length,
      durationSeconds: out.length / params.sampleRateHz,
      supportStartSample: supportRange.startSampleIndex,
      supportEndSample: supportRange.endSampleIndex,
      beforeSupportStartSample: beforeSupport.startSampleIndex,
      beforeSupportEndSample: beforeSupport.endSampleIndex,
      energy: signalEnergy(output),
      averagePower: averagePower(output),
      signalType: classifySignalType(output),
      elapsedMs,
    },
    payload: { buffer: out.buffer, byteOffset: 0, byteLength: out.byteLength },
  };
}

export type ReverbProcessResult = {
  meta: {
    outputSampleCount: number;
    irSampleCount: number;
    elapsedMs: number;
    method: "fft" | "direct";
    preDelaySamples: number;
  };
  payload?: TransferablePayload;
};

const MAX_REVERB_OUTPUT_SECONDS = 300;
const MAX_DIRECT_INPUT_SECONDS = 2;
const SYNTHETIC_IR_KINDS: readonly SyntheticIrKind[] = ["room", "hall", "plate", "telephone"];

/**
 * F10 reverb: convolve the source slice with a synthetic or uploaded impulse
 * response, after an optional pre-delay, and mix the wet result with the dry
 * signal zero-padded to the full convolution length. The output keeps the
 * whole tail: `preDelay + N + M - 1` samples.
 */
export function reverbProcess(
  params: ReverbProcessParams,
  payload?: TransferablePayload,
): ReverbProcessResult {
  const ir = params?.ir;
  if (
    params === undefined ||
    params === null ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    params.sampleRateHz > 96_000 ||
    !Number.isInteger(params.startSample) ||
    !Number.isInteger(params.endSample) ||
    params.startSample < 0 ||
    params.endSample < params.startSample ||
    ir === undefined ||
    ir === null ||
    !SYNTHETIC_IR_KINDS.includes(ir.kind) ||
    !Number.isFinite(ir.durationSeconds) ||
    ir.durationSeconds <= 0 ||
    !Number.isFinite(ir.rt60Seconds) ||
    ir.rt60Seconds <= 0 ||
    !Number.isFinite(ir.seed) ||
    !Number.isInteger(params.uploadedIrSampleCount) ||
    params.uploadedIrSampleCount < 0 ||
    (params.uploadedIrSampleCount > 0 &&
      params.uploadedIrSampleRateHz !== undefined &&
      (!Number.isFinite(params.uploadedIrSampleRateHz) ||
        params.uploadedIrSampleRateHz <= 0 ||
        params.uploadedIrSampleRateHz > 96_000)) ||
    !Number.isFinite(params.preDelayMs) ||
    params.preDelayMs < 0 ||
    !Number.isFinite(params.wetMix) ||
    params.wetMix < 0 ||
    params.wetMix > 1 ||
    (params.method !== "fft" && params.method !== "direct")
  ) {
    throw new DspOpError("badParams", `reverbProcess: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "reverbProcess: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badPayload", "reverbProcess: payload must be Float32-aligned");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  const sourceLength = samples.length - params.uploadedIrSampleCount;
  if (sourceLength <= 0) {
    throw new DspOpError("badParams", "reverbProcess: the source or uploaded IR is empty");
  }
  if (params.method === "direct" && sourceLength / params.sampleRateHz > MAX_DIRECT_INPUT_SECONDS) {
    throw new DspOpError(
      "badParams",
      `reverbProcess: direct convolution is limited to ${MAX_DIRECT_INPUT_SECONDS} s excerpts`,
    );
  }

  const preDelaySamples = Math.round((params.preDelayMs * params.sampleRateHz) / 1000);
  const uploadedIrRateHz = params.uploadedIrSampleRateHz ?? params.sampleRateHz;
  const expectedIrLength =
    params.uploadedIrSampleCount > 0
      ? Math.round((params.uploadedIrSampleCount * params.sampleRateHz) / uploadedIrRateHz)
      : Math.round(ir.durationSeconds * params.sampleRateHz);
  if (!Number.isSafeInteger(expectedIrLength) || expectedIrLength <= 0) {
    throw new DspOpError("badParams", "reverbProcess: the impulse response is empty");
  }
  const outputLength = preDelaySamples + sourceLength + expectedIrLength - 1;
  if (
    !Number.isSafeInteger(outputLength) ||
    outputLength / params.sampleRateHz > MAX_REVERB_OUTPUT_SECONDS
  ) {
    throw new DspOpError(
      "tooLong",
      `reverbProcess: output is ${(outputLength / params.sampleRateHz).toFixed(1)} s, ` +
        `above the ${MAX_REVERB_OUTPUT_SECONDS} s processed cap`,
    );
  }

  const startedMs = performance.now();
  const source = Float64Array.from(samples.subarray(0, sourceLength));
  let impulseResponse: Float64Array;
  if (params.uploadedIrSampleCount > 0) {
    impulseResponse = Float64Array.from(samples.subarray(sourceLength));
    if (uploadedIrRateHz !== params.sampleRateHz) {
      impulseResponse = resampleRational(impulseResponse, {
        inputRateHz: uploadedIrRateHz,
        outputRateHz: params.sampleRateHz,
        filter: "kaiserSinc",
      });
    }
  } else {
    impulseResponse = generateSyntheticIr({
      kind: ir.kind,
      sampleRateHz: params.sampleRateHz,
      durationSeconds: ir.durationSeconds,
      rt60Seconds: ir.rt60Seconds,
      seed: ir.seed,
    });
  }

  const delayed = new Float64Array(preDelaySamples + source.length);
  delayed.set(source, preDelaySamples);
  const wet =
    params.method === "direct"
      ? convolveDirect(delayed, impulseResponse)
      : convolveFft(delayed, impulseResponse);
  if (wet.length / params.sampleRateHz > MAX_REVERB_OUTPUT_SECONDS) {
    throw new DspOpError(
      "tooLong",
      `reverbProcess: output is ${(wet.length / params.sampleRateHz).toFixed(1)} s, ` +
        `above the ${MAX_REVERB_OUTPUT_SECONDS} s processed cap`,
    );
  }
  const dry = new Float64Array(wet.length);
  dry.set(source);
  const output = new Float64Array(wet.length);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (1 - params.wetMix) * (dry[index] ?? 0) + params.wetMix * (wet[index] ?? 0);
  }
  const elapsedMs = performance.now() - startedMs;
  const out = Float32Array.from(output);
  return {
    meta: {
      outputSampleCount: out.length,
      irSampleCount: impulseResponse.length,
      elapsedMs,
      method: params.method,
      preDelaySamples,
    },
    payload: { buffer: out.buffer, byteOffset: 0, byteLength: out.byteLength },
  };
}

export type ConvolutionStepsParams = {
  signal: readonly number[];
  ir: readonly number[];
};

export type ConvolutionStepsResult = {
  meta: {
    signalSampleCount: number;
    irSampleCount: number;
    stepCount: number;
    outputSampleCount: number;
  };
  payload?: TransferablePayload;
};

function finiteNumberArray(values: readonly number[] | undefined): values is readonly number[] {
  if (!Array.isArray(values) || values.length === 0) {
    return false;
  }
  for (const value of values) {
    if (!Number.isFinite(value)) {
      return false;
    }
  }
  return true;
}

/**
 * F10 teaching visualization: one partial convolution array per IR tap.
 * `partial_m[m + i] = signal[i] * ir[m]`; summing the partials reproduces
 * `convolveDirect(signal, ir)`. Runs in the worker because the visualization
 * must not put DSP on the main thread.
 */
export function convolutionSteps(
  params: ConvolutionStepsParams,
  _payload?: TransferablePayload,
): ConvolutionStepsResult {
  if (
    params === undefined ||
    params === null ||
    !finiteNumberArray(params.signal) ||
    !finiteNumberArray(params.ir)
  ) {
    throw new DspOpError("badParams", `convolutionSteps: invalid params ${String(params)}`);
  }
  const signal = params.signal;
  const ir = params.ir;
  const outputLength = signal.length + ir.length - 1;
  if (!Number.isSafeInteger(outputLength * ir.length)) {
    throw new DspOpError("badParams", "convolutionSteps: step arrays are too large");
  }
  const partials = new Float32Array(outputLength * ir.length);
  for (let step = 0; step < ir.length; step += 1) {
    const offset = step * outputLength;
    const tap = ir[step] ?? 0;
    for (let index = 0; index < signal.length; index += 1) {
      partials[offset + step + index] = (signal[index] ?? 0) * tap;
    }
  }
  return {
    meta: {
      signalSampleCount: signal.length,
      irSampleCount: ir.length,
      stepCount: ir.length,
      outputSampleCount: outputLength,
    },
    payload: { buffer: partials.buffer, byteOffset: 0, byteLength: partials.byteLength },
  };
}

/** Processed-playback cap in seconds (mirrors the store's MAX_PROCESSED_SECONDS;
 * kept local so the worker op table never imports store state). */
const MAX_SPEED_OUTPUT_SECONDS = 300;

/**
 * F06 speed/direction transform over the request payload (already the
 * selected source slice):
 * - `resample`: tape-style speed, pitch follows. `outputRateHz =
 *   round(sampleRateHz / speedFactor)`, then the buffer is declared at the
 *   SOURCE rate so playback lasts `1 / speedFactor` of the input and the
 *   pitch scales by `speedFactor` (2x speed → 880 Hz from 440 Hz).
 * - `timeStretch`: phase-vocoder stretch with pitch preserved; an optional
 *   `pitchShift` runs after the stretch.
 * - `reverse` applies last, so the waveform plays backwards at the chosen
 *   speed.
 */
export function speedTransform(
  params: SpeedTransformParams,
  payload?: TransferablePayload,
): SpeedTransformResult {
  if (
    params === undefined ||
    params === null ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    params.sampleRateHz > 96_000 ||
    !Number.isInteger(params.startSample) ||
    !Number.isInteger(params.endSample) ||
    params.startSample < 0 ||
    params.endSample < params.startSample ||
    (params.mode !== "resample" && params.mode !== "timeStretch") ||
    !Number.isFinite(params.speedFactor) ||
    params.speedFactor < 0.25 ||
    params.speedFactor > 4 ||
    !Number.isFinite(params.semitones) ||
    params.semitones < -12 ||
    params.semitones > 12 ||
    typeof params.reverse !== "boolean"
  ) {
    throw new DspOpError("badParams", `speedTransform: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "speedTransform: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badPayload", "speedTransform: payload must be Float32-aligned");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  if (samples.length === 0) {
    throw new DspOpError("badParams", "speedTransform: the selection is empty");
  }

  const startedMs = performance.now();
  const input = Float64Array.from(samples);
  let output: Float64Array;
  let actualSpeedFactor: number;
  if (params.mode === "resample") {
    const outputRateHz = Math.round(params.sampleRateHz / params.speedFactor);
    if (outputRateHz < 1) {
      throw new DspOpError(
        "badParams",
        `speedTransform: output rate would be ${outputRateHz} Hz (speedFactor ${params.speedFactor})`,
      );
    }
    output = resampleRational(input, {
      inputRateHz: params.sampleRateHz,
      outputRateHz,
      filter: "kaiserSinc",
    });
    actualSpeedFactor = params.sampleRateHz / outputRateHz;
  } else {
    output = timeStretch(input, {
      stretchFactor: 1 / params.speedFactor,
      windowLengthSamples: 2048,
    });
    if (params.semitones !== 0) {
      output = pitchShift(output, {
        semitones: params.semitones,
        windowLengthSamples: 2048,
        sampleRateHz: params.sampleRateHz,
      });
    }
    actualSpeedFactor = params.speedFactor;
  }
  if (params.reverse) {
    output = reverse(output);
  }
  if (output.length / params.sampleRateHz > MAX_SPEED_OUTPUT_SECONDS) {
    throw new DspOpError(
      "tooLong",
      `speedTransform: output is ${(output.length / params.sampleRateHz).toFixed(1)} s, ` +
        `above the ${MAX_SPEED_OUTPUT_SECONDS} s processed cap`,
    );
  }
  const elapsedMs = performance.now() - startedMs;
  const out = Float32Array.from(output);
  return {
    meta: {
      outputSampleCount: out.length,
      sampleRateHz: params.sampleRateHz,
      actualSpeedFactor,
      elapsedMs,
      capped: false,
    },
    payload: { buffer: out.buffer, byteOffset: 0, byteLength: out.byteLength },
  };
}

/** Upsample `payload` from `sampleRateHz` to `targetRateHz` with the pinned
 * kaiser-sinc low-pass (`resampleRational`, filter "kaiserSinc"). This is the
 * non-AI baseline for F14 super-resolution: it restores the sample rate but
 * NOT the bandwidth a downsample already destroyed. */
export function superresBaseline(
  params: SuperresBaselineParams,
  payload?: TransferablePayload,
): SuperresBaselineResult {
  if (
    params === undefined ||
    params === null ||
    !Number.isFinite(params.sampleRateHz) ||
    !Number.isInteger(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    params.sampleRateHz > 96_000 ||
    !Number.isFinite(params.targetRateHz) ||
    !Number.isInteger(params.targetRateHz) ||
    params.targetRateHz <= 0 ||
    params.targetRateHz > 96_000
  ) {
    throw new DspOpError("badParams", `superresBaseline: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "superresBaseline: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badPayload", "superresBaseline: payload must be Float32-aligned");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  for (let index = 0; index < samples.length; index += 1) {
    if (!Number.isFinite(samples[index])) {
      throw new DspOpError("badParams", `superresBaseline: samples[${index}] is not finite`);
    }
  }

  const startedMs = performance.now();
  let output: Float64Array;
  try {
    output = resampleRational(Float64Array.from(samples), {
      inputRateHz: params.sampleRateHz,
      outputRateHz: params.targetRateHz,
      filter: "kaiserSinc",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DspOpError("badParams", `superresBaseline: ${detail}`);
  }
  const elapsedMs = performance.now() - startedMs;
  const out = Float32Array.from(output);
  return {
    meta: {
      sampleCount: out.length,
      sampleRateHz: params.targetRateHz,
      inputSampleRateHz: params.sampleRateHz,
      delaySamples: 0,
      elapsedMs,
    },
    payload: { buffer: out.buffer, byteOffset: 0, byteLength: out.byteLength },
  };
}

export type SamplingProcessParams = {
  sampleRateHz: number;
  startSample: number;
  endSample: number;
  targetRateHz: number;
  antiAlias: boolean;
  bits: number;
  dither: boolean;
  seed: number;
};

export type SamplingProcessResult = {
  meta: {
    outputSampleCount: number;
    sampleRateHz: number;
    mse: number;
    snrDb: number;
    segmentalSnrDb: number;
    psnrDb: number;
    theorySnrDb: number;
    capped: boolean;
  };
  payload?: TransferablePayload;
};

/**
 * F03 sampling + quantization over the request payload (already the selected
 * source slice). Resamples first, then quantizes the RESAMPLED reference, so
 * the metrics describe the quantization step alone; the payload is
 * `[quantized N | error N]` and the view can play either half.
 *
 * Metrics: `snrDb`/`segmentalSnrDb`/`psnrDb(peak = 1)` compare the resampled
 * reference with the quantized output; `theorySnrDb = 6.02·bits + 1.76`
 * assumes a full-scale sine and is shown only as a labelled reference.
 */
export function samplingProcess(
  params: SamplingProcessParams,
  payload?: TransferablePayload,
): SamplingProcessResult {
  const targetRateHz = params?.targetRateHz;
  if (
    params === undefined ||
    params === null ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    params.sampleRateHz > 96_000 ||
    !Number.isFinite(targetRateHz) ||
    targetRateHz <= 0 ||
    targetRateHz > 96_000 ||
    (targetRateHz !== params.sampleRateHz && !Number.isInteger(targetRateHz)) ||
    !Number.isInteger(params.startSample) ||
    !Number.isInteger(params.endSample) ||
    params.startSample < 0 ||
    params.endSample < params.startSample ||
    !Number.isInteger(params.bits) ||
    params.bits < 1 ||
    params.bits > 24 ||
    typeof params.antiAlias !== "boolean" ||
    typeof params.dither !== "boolean" ||
    !Number.isInteger(params.seed)
  ) {
    throw new DspOpError("badParams", `samplingProcess: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError("badPayload", "samplingProcess: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badPayload", "samplingProcess: payload must be Float32-aligned");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  if (samples.length === 0) {
    throw new DspOpError("badParams", "samplingProcess: the selection is empty");
  }

  const input = Float64Array.from(samples);
  const reference = resampleRational(input, {
    inputRateHz: params.sampleRateHz,
    outputRateHz: targetRateHz,
    filter: params.antiAlias ? "kaiserSinc" : "none",
  });
  const quantized = params.dither
    ? quantizeWithTpdfDither(reference, { bits: params.bits, seed: params.seed })
    : quantizeUniform(reference, { bits: params.bits });
  const error = quantizationError(reference, quantized);
  const sampleCount = quantized.length;
  const combined = new Float32Array(sampleCount * 2);
  combined.set(Float32Array.from(quantized), 0);
  combined.set(Float32Array.from(error), sampleCount);
  return {
    meta: {
      outputSampleCount: sampleCount,
      sampleRateHz: targetRateHz,
      mse: mse(reference, quantized),
      snrDb: snrDb(reference, quantized),
      segmentalSnrDb: segmentalSnrDb(reference, quantized, { frameLengthSamples: 1024 }),
      psnrDb: psnrDb(reference, quantized, { peak: 1 }),
      theorySnrDb: 6.02 * params.bits + 1.76,
      capped: false,
    },
    payload: { buffer: combined.buffer, byteOffset: 0, byteLength: combined.byteLength },
  };
}

export type {
  CodecLabCodec,
  FilterApplyParams,
  PipelineGraph,
  PipelineOutput,
  PipelineStageSummary,
  ReverbIrParams,
  ReverbProcessParams,
};

export type CodecLabParams = {
  codec: CodecLabCodec;
  sampleRateHz: number;
  startSample: number;
  endSample: number;
  mdctBitsPerSecond: number;
  /** Omitted means legacy uniform quantization (Wave-4 behavior). */
  mdctPsychoacoustic?: boolean;
  /** Reference level for a full-scale sine in dB SPL; defaults to 94. */
  mdctReferenceSplDb?: number;
};

export type CodecLabMdctBand = {
  lowHz: number;
  highHz: number;
  thresholdDb: number;
  smrDb: number;
  step: number;
};

export type CodecLabMeta = {
  codec: CodecLabCodec;
  sampleCount: number;
  sampleRateHz: number;
  startSample: number;
  endSample: number;
  originalBytes: number;
  compressedSizeBytes: number;
  bitsPerSample: number;
  bitrateKbps: number;
  compressionRatio: number;
  entropyBitsPerSymbol: number;
  encodeMs: number;
  decodeMs: number;
  bitExact: boolean;
  mse: number;
  snrDb: number;
  segmentalSnrDb: number;
  psnrDb: number;
  histogram: number[];
  codeLengths: number[];
  coefficientSparsity: number | null;
  frameCount: number | null;
  bitsTotal: number | null;
  psychoacoustic: boolean;
  mdctEntropyBits: number | null;
  mdctSideInfoBits: number | null;
  mdctMaskedFraction: number | null;
  mdctBands: CodecLabMdctBand[] | null;
};

export type CodecLabResult = {
  meta: CodecLabMeta;
  payload?: TransferablePayload;
};

export type PsychoacousticCurvesParams = {
  sampleRateHz: number;
  referenceSplDb: number;
};

export type PsychoacousticCurvesResult = {
  meta: {
    bandEdgesHz: Float64Array;
    bandCentersHz: Float64Array;
    bandCentersBark: Float64Array;
    athDb: Float64Array;
    /** Row-major 25 x 25: row = threshold band, column = masker band. */
    spreadingDb: Float64Array;
  };
};

export type PsychoacousticBand = {
  lowHz: number;
  highHz: number;
  levelDb: number;
  thresholdDb: number;
  smrDb: number;
};

export type PsychoacousticAnalysisParams = {
  sampleRateHz: number;
  startSample: number;
  endSample: number;
  referenceSplDb: number;
};

export type PsychoacousticAnalysisResult = {
  meta: {
    frameCount: number;
    bands: PsychoacousticBand[];
  };
};

const PSYCHO_MIN_SPL_DB = 80;
const PSYCHO_MAX_SPL_DB = 100;
const PSYCHO_MAX_SELECTION_SECONDS = 30;

function isPsychoRate(sampleRateHz: number): boolean {
  return Number.isFinite(sampleRateHz) && sampleRateHz > 0 && sampleRateHz <= 96_000;
}

function isPsychoReferenceSpl(referenceSplDb: number): boolean {
  return (
    Number.isFinite(referenceSplDb) &&
    referenceSplDb >= PSYCHO_MIN_SPL_DB &&
    referenceSplDb <= PSYCHO_MAX_SPL_DB
  );
}

function psychoBandCenters(edgesHz: Float64Array): {
  centersHz: Float64Array;
  centersBark: Float64Array;
} {
  const bandCount = Math.max(0, edgesHz.length - 1);
  const centersHz = new Float64Array(bandCount);
  const centersBark = new Float64Array(bandCount);
  for (let band = 0; band < bandCount; band += 1) {
    const low = edgesHz[band] ?? 0;
    const high = edgesHz[band + 1] ?? low;
    const center = Math.sqrt(low * high);
    centersHz[band] = center;
    centersBark[band] = hzToBark(center);
  }
  return { centersHz, centersBark };
}

/** F13 static curves: Bark edges/centers, ATH, and the spreading matrix. */
export function psychoacousticCurves(
  params: PsychoacousticCurvesParams,
  _payload?: TransferablePayload,
): PsychoacousticCurvesResult {
  if (
    params === undefined ||
    params === null ||
    !isPsychoRate(params.sampleRateHz) ||
    !isPsychoReferenceSpl(params.referenceSplDb)
  ) {
    throw new DspOpError("badParams", `psychoacousticCurves: invalid params ${String(params)}`);
  }
  const bandEdgesHz = barkBandEdgesHz(params.sampleRateHz);
  const { centersHz, centersBark } = psychoBandCenters(bandEdgesHz);
  const bandCount = centersBark.length;
  const spreading = new Float64Array(bandCount * bandCount);
  for (let row = 0; row < bandCount; row += 1) {
    const thresholdBark = centersBark[row] ?? 0;
    for (let column = 0; column < bandCount; column += 1) {
      spreading[row * bandCount + column] = spreadingDb(thresholdBark - (centersBark[column] ?? 0));
    }
  }
  return {
    meta: {
      bandEdgesHz,
      bandCentersHz: centersHz,
      bandCentersBark: centersBark,
      athDb: bandAthDb(bandEdgesHz),
      spreadingDb: spreading,
    },
  };
}

/**
 * F13 audio analysis: per-band level, threshold and SMR for the frame with
 * the largest band-energy sum. The reference SPL is the level assigned to a
 * full-scale 1 kHz sine measured through the same MDCT.
 */
export function psychoacousticAnalysis(
  params: PsychoacousticAnalysisParams,
  payload?: TransferablePayload,
): PsychoacousticAnalysisResult {
  if (
    params === undefined ||
    params === null ||
    !isPsychoRate(params.sampleRateHz) ||
    !isPsychoReferenceSpl(params.referenceSplDb) ||
    !Number.isInteger(params.startSample) ||
    !Number.isInteger(params.endSample) ||
    params.startSample < 0 ||
    params.endSample < params.startSample
  ) {
    throw new DspOpError("badParams", `psychoacousticAnalysis: invalid params ${String(params)}`);
  }
  if (payload === undefined) {
    throw new DspOpError(
      "badPayload",
      "psychoacousticAnalysis: a Float32 source payload is required",
    );
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badParams", "psychoacousticAnalysis: payload must be Float32-aligned");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  if (samples.length === 0) {
    throw new DspOpError("badParams", "psychoacousticAnalysis: the selection is empty");
  }
  const maxSamples = PSYCHO_MAX_SELECTION_SECONDS * params.sampleRateHz;
  if (samples.length > maxSamples || params.endSample - params.startSample > maxSamples) {
    throw new DspOpError("badParams", "psychoacousticAnalysis: the selection exceeds the 30 s cap");
  }

  const transform = mdct(Float64Array.from(samples), {
    frameLengthSamples: CODEC_LAB_MDCT_FRAME_LENGTH,
  });
  const bandEdgesHz = barkBandEdgesHz(params.sampleRateHz);
  const { centersBark } = psychoBandCenters(bandEdgesHz);
  const athDb = bandAthDb(bandEdgesHz);
  const referencePower = measureReferencePower(params.sampleRateHz, CODEC_LAB_MDCT_FRAME_LENGTH);
  let loudestIndex = 0;
  let loudestEnergy = Number.NEGATIVE_INFINITY;
  for (let frame = 0; frame < transform.coefficients.length; frame += 1) {
    const coefficients = transform.coefficients[frame];
    if (coefficients === undefined) {
      continue;
    }
    let energy = 0;
    for (const coefficient of coefficients) {
      energy += coefficient * coefficient;
    }
    if (energy > loudestEnergy) {
      loudestEnergy = energy;
      loudestIndex = frame;
    }
  }
  const loudest = transform.coefficients[loudestIndex] ?? new Float64Array(0);
  const { levelsDb } = bandLevelsDb(
    loudest,
    bandEdgesHz,
    params.referenceSplDb,
    referencePower,
    params.sampleRateHz,
  );
  const thresholdsDb = maskingThresholdDb(levelsDb, centersBark, athDb);
  const smrDb = signalToMaskRatioDb(levelsDb, thresholdsDb);
  const bands: PsychoacousticBand[] = [];
  for (let band = 0; band < centersBark.length; band += 1) {
    bands.push({
      lowHz: bandEdgesHz[band] ?? 0,
      highHz: bandEdgesHz[band + 1] ?? 0,
      levelDb: levelsDb[band] ?? Number.NEGATIVE_INFINITY,
      thresholdDb: thresholdsDb[band] ?? Number.NEGATIVE_INFINITY,
      smrDb: smrDb[band] ?? Number.NEGATIVE_INFINITY,
    });
  }
  return { meta: { frameCount: transform.coefficients.length, bands } };
}

const CODEC_LAB_CODECS: readonly CodecLabCodec[] = [
  "rle",
  "huffman",
  "deltaHuffman",
  "mulaw",
  "alaw",
  "mdct",
];

const CODEC_LAB_MAX_SECONDS = 30;
const CODEC_LAB_MDCT_FRAME_LENGTH = 512;

function int16ArraysEqual(first: Int16Array, second: Int16Array): boolean {
  if (first.length !== second.length) {
    return false;
  }
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) {
      return false;
    }
  }
  return true;
}

/**
 * F04 browser compression lab: encode the selected excerpt with one of the
 * hand-written codecs, decode it, and return the decoded audio plus the
 * teaching statistics (size, rate, entropy, timing, bit-exactness, metrics,
 * histogram, Huffman lengths, MDCT sparsity). The payload is the source
 * excerpt; the handler re-checks the 30 s cap even though the view slices.
 */
export function codecLabProcess(
  params: CodecLabParams,
  payload?: TransferablePayload,
): CodecLabResult {
  const usePsychoacoustic = params?.mdctPsychoacoustic ?? false;
  const referenceSplDb = params?.mdctReferenceSplDb ?? PSYCHO_REFERENCE_SPL_DB;
  if (
    params === undefined ||
    params === null ||
    !CODEC_LAB_CODECS.includes(params.codec) ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    params.sampleRateHz > 96_000 ||
    !Number.isInteger(params.startSample) ||
    !Number.isInteger(params.endSample) ||
    params.startSample < 0 ||
    params.endSample < params.startSample ||
    !Number.isFinite(params.mdctBitsPerSecond) ||
    params.mdctBitsPerSecond < 8_000 ||
    params.mdctBitsPerSecond > 512_000 ||
    (params.mdctPsychoacoustic !== undefined && typeof params.mdctPsychoacoustic !== "boolean") ||
    !isPsychoReferenceSpl(referenceSplDb)
  ) {
    throw new DspOpError("badParams", `codecLabProcess: invalid params ${String(params)}`);
  }
  const psychoacoustic = usePsychoacoustic && params.codec === "mdct";
  if (payload === undefined) {
    throw new DspOpError("badPayload", "codecLabProcess: a Float32 source payload is required");
  }
  if (payload.byteOffset % 4 !== 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badParams", "codecLabProcess: payload must be Float32-aligned");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  if (samples.length === 0) {
    throw new DspOpError("badParams", "codecLabProcess: the selection is empty");
  }
  const maxSamples = CODEC_LAB_MAX_SECONDS * params.sampleRateHz;
  if (samples.length > maxSamples || params.endSample - params.startSample > maxSamples) {
    throw new DspOpError("badParams", "codecLabProcess: the selection exceeds the 30 s cap");
  }

  const pcm16 = floatToInt16Pcm(samples);
  const reference = int16PcmToFloat(pcm16);
  const sourceBytes = int16PcmToBytes(pcm16);
  const histogram = Array.from(buildHistogram(sourceBytes));
  const sampleCount = pcm16.length;
  const originalBytes = sampleCount * 2;

  let decoded: Float32Array;
  let decodedInt16: Int16Array | null = null;
  let compressedSizeBytes: number;
  let bitsTotal: number;
  let entropy = 0;
  let codeLengths: number[] = [];
  let coefficientSparsity: number | null = null;
  let frameCount: number | null = null;
  let encodeMs = 0;
  let decodeMs = 0;
  let mdctEntropyBits: number | null = null;
  let mdctSideInfoBits: number | null = null;
  let mdctMaskedFraction: number | null = null;
  let mdctBands: CodecLabMdctBand[] | null = null;
  let bitrateKbpsOverride: number | null = null;

  if (params.codec === "rle") {
    const encodeStart = performance.now();
    const encoded = rleEncode(sourceBytes);
    encodeMs = performance.now() - encodeStart;
    const decodeStart = performance.now();
    decodedInt16 = bytesToInt16Pcm(rleDecode(encoded));
    decodeMs = performance.now() - decodeStart;
    decoded = int16PcmToFloat(decodedInt16);
    compressedSizeBytes = encoded.length;
    bitsTotal = encoded.length * 8;
    entropy = entropyBitsPerSymbol(sourceBytes);
  } else if (params.codec === "huffman") {
    const encodeStart = performance.now();
    const encoded = huffmanEncode(sourceBytes);
    encodeMs = performance.now() - encodeStart;
    const decodeStart = performance.now();
    decodedInt16 = bytesToInt16Pcm(
      huffmanDecode(encoded.bits, encoded.bitLength, encoded.codebook),
    );
    decodeMs = performance.now() - decodeStart;
    decoded = int16PcmToFloat(decodedInt16);
    compressedSizeBytes = Math.ceil(encoded.bitLength / 8) + 256;
    bitsTotal = encoded.bitLength;
    entropy = entropyBitsPerSymbol(sourceBytes);
    codeLengths = Array.from(encoded.codebook.codeLengths);
  } else if (params.codec === "deltaHuffman") {
    const encodeStart = performance.now();
    const encoded = encodeLosslessDeltaHuffman(pcm16);
    encodeMs = performance.now() - encodeStart;
    const decodeStart = performance.now();
    decodedInt16 = decodeLosslessDeltaHuffman(encoded.payload).samples;
    decodeMs = performance.now() - decodeStart;
    decoded = int16PcmToFloat(decodedInt16);
    compressedSizeBytes = encoded.payload.length;
    bitsTotal = encoded.bitLength;
    entropy = encoded.stats.entropyBitsPerSymbol;
    codeLengths = Array.from(encoded.codebook.codeLengths);
  } else if (params.codec === "mulaw" || params.codec === "alaw") {
    const encode = params.codec === "mulaw" ? mulawEncode : alawEncode;
    const decode = params.codec === "mulaw" ? mulawDecode : alawDecode;
    const encodeStart = performance.now();
    const encoded = encode(Float64Array.from(reference), { bits: 8 });
    encodeMs = performance.now() - encodeStart;
    const decodeStart = performance.now();
    decoded = Float32Array.from(decode(encoded));
    decodeMs = performance.now() - decodeStart;
    compressedSizeBytes = encoded.length;
    bitsTotal = encoded.length * 8;
    entropy = entropyBitsPerSymbol(encoded);
  } else {
    let encodedFrames: readonly Float64Array[];
    if (psychoacoustic) {
      const encodeStart = performance.now();
      const encoded = encodeMdctPsycho(Float32Array.from(reference), {
        sampleRateHz: params.sampleRateHz,
        frameLengthSamples: CODEC_LAB_MDCT_FRAME_LENGTH,
        bitsPerSecond: params.mdctBitsPerSecond,
        referenceSplDb,
      });
      encodeMs = performance.now() - encodeStart;
      const decodeStart = performance.now();
      decoded = decodeMdctPsycho(encoded, {
        sampleRateHz: params.sampleRateHz,
        frameLengthSamples: CODEC_LAB_MDCT_FRAME_LENGTH,
      }).slice(0, sampleCount);
      decodeMs = performance.now() - decodeStart;
      compressedSizeBytes = encoded.stats.compressedSizeBytes;
      bitsTotal = encoded.bitsTotal;
      frameCount = encoded.coefficients.length;
      mdctEntropyBits = encoded.stats.entropyBits;
      mdctSideInfoBits = encoded.stats.sideInfoBits;
      mdctMaskedFraction = encoded.stats.maskedFraction;
      bitrateKbpsOverride = (encoded.stats.totalBits * params.sampleRateHz) / sampleCount / 1000;
      let loudest = encoded.frameStats[0];
      let loudestScore = Number.NEGATIVE_INFINITY;
      for (const frame of encoded.frameStats) {
        let score = 0;
        for (const band of frame.bands) {
          if (Number.isFinite(band.levelDb)) {
            score += 10 ** (band.levelDb / 10);
          }
        }
        if (score > loudestScore) {
          loudestScore = score;
          loudest = frame;
        }
      }
      mdctBands =
        loudest === undefined
          ? null
          : loudest.bands.map((band) => ({
              lowHz: band.lowHz,
              highHz: band.highHz,
              thresholdDb: band.thresholdDb,
              smrDb: band.smrDb,
              step: band.step,
            }));
      encodedFrames = encoded.coefficients;
      codeLengths = Array.from(encoded.codebook.codeLengths);
    } else {
      const encodeStart = performance.now();
      const encoded = encodeMdct(Float32Array.from(reference), {
        sampleRateHz: params.sampleRateHz,
        frameLengthSamples: CODEC_LAB_MDCT_FRAME_LENGTH,
        bitsPerSecond: params.mdctBitsPerSecond,
      });
      encodeMs = performance.now() - encodeStart;
      const decodeStart = performance.now();
      decoded = decodeMdct(encoded, {
        sampleRateHz: params.sampleRateHz,
        frameLengthSamples: CODEC_LAB_MDCT_FRAME_LENGTH,
      }).slice(0, sampleCount);
      decodeMs = performance.now() - decodeStart;
      compressedSizeBytes = encoded.stats.compressedSizeBytes + 256 + encoded.steps.length * 8;
      bitsTotal = encoded.bitsTotal;
      frameCount = encoded.coefficients.length;
      encodedFrames = encoded.coefficients;
      codeLengths = Array.from(encoded.codebook.codeLengths);
    }
    const hop = CODEC_LAB_MDCT_FRAME_LENGTH / 2;
    const coefficientCount = (frameCount ?? 0) * hop;
    const flatCoefficients = new Int32Array(coefficientCount);
    let zeroCount = 0;
    let cursor = 0;
    for (const frame of encodedFrames) {
      for (let index = 0; index < hop; index += 1) {
        const coefficient = frame[index] ?? 0;
        flatCoefficients[cursor] = coefficient;
        if (coefficient === 0) {
          zeroCount += 1;
        }
        cursor += 1;
      }
    }
    coefficientSparsity = coefficientCount === 0 ? 0 : zeroCount / coefficientCount;
    entropy = entropyBitsPerSymbol(flatCoefficients);
  }

  const bitExact = decodedInt16 === null ? false : int16ArraysEqual(decodedInt16, pcm16);
  const frameLengthSamples = Math.max(1, Math.round(0.02 * params.sampleRateHz));
  const durationSeconds = sampleCount / params.sampleRateHz;
  return {
    meta: {
      codec: params.codec,
      sampleCount,
      sampleRateHz: params.sampleRateHz,
      startSample: params.startSample,
      endSample: params.endSample,
      originalBytes,
      compressedSizeBytes,
      bitsPerSample: (8 * compressedSizeBytes) / sampleCount,
      bitrateKbps: bitrateKbpsOverride ?? (8 * compressedSizeBytes) / (durationSeconds * 1000),
      compressionRatio: originalBytes / compressedSizeBytes,
      entropyBitsPerSymbol: entropy,
      encodeMs,
      decodeMs,
      bitExact,
      mse: mse(reference, decoded),
      snrDb: snrDb(reference, decoded),
      segmentalSnrDb: segmentalSnrDb(reference, decoded, { frameLengthSamples }),
      psnrDb: psnrDb(reference, decoded, { peak: 1 }),
      histogram,
      codeLengths,
      coefficientSparsity,
      frameCount,
      bitsTotal,
      psychoacoustic,
      mdctEntropyBits,
      mdctSideInfoBits,
      mdctMaskedFraction,
      mdctBands,
    },
    payload: {
      buffer: decoded.buffer as ArrayBuffer,
      byteOffset: decoded.byteOffset,
      byteLength: decoded.byteLength,
    },
  };
}

export type AliasDemoParams = {
  sourceRateHz: number;
  targetRateHz: number;
  frequencyHz: number;
  durationSeconds: number;
  antiAlias: boolean;
};

export type AliasDemoResult = {
  meta: {
    aliasFrequencyHz: number;
    measuredPeakHz: number;
    outputSampleCount: number;
  };
  payload?: TransferablePayload;
};

/** Dominant one-sided FFT bin of a real signal, in Hz. */
function dominantFrequencyHz(values: Float64Array, sampleRateHz: number): number {
  if (values.length === 0) {
    return 0;
  }
  const spectrum = fft(values);
  const lastBin = Math.floor(values.length / 2);
  let bestBin = 0;
  let bestMagnitude = -1;
  for (let bin = 0; bin <= lastBin; bin += 1) {
    const re = spectrum.re[bin] ?? 0;
    const im = spectrum.im[bin] ?? 0;
    const magnitude = Math.hypot(re, im);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestBin = bin;
    }
  }
  return (bestBin * sampleRateHz) / values.length;
}

/**
 * Source-free F03 aliasing demo: generate a sine at `sourceRateHz`, resample
 * it to `targetRateHz` with or without the anti-alias filter, then measure
 * the dominant output bin. The predicted fold-back comes from
 * `aliasFrequencyHz`; the measured value shows what actually came out.
 */
export function aliasDemo(
  params: AliasDemoParams,
  _payload?: TransferablePayload,
): AliasDemoResult {
  if (
    params === undefined ||
    params === null ||
    !Number.isFinite(params.sourceRateHz) ||
    params.sourceRateHz <= 0 ||
    params.sourceRateHz > 96_000 ||
    !Number.isInteger(params.sourceRateHz) ||
    !Number.isFinite(params.targetRateHz) ||
    params.targetRateHz <= 0 ||
    params.targetRateHz > 96_000 ||
    !Number.isInteger(params.targetRateHz) ||
    !Number.isFinite(params.frequencyHz) ||
    !Number.isFinite(params.durationSeconds) ||
    params.durationSeconds <= 0 ||
    params.durationSeconds > 300 ||
    typeof params.antiAlias !== "boolean"
  ) {
    throw new DspOpError("badParams", `aliasDemo: invalid params ${String(params)}`);
  }
  const source = generateSine({
    sampleRateHz: params.sourceRateHz,
    durationSeconds: params.durationSeconds,
    amplitude: 1,
    frequencyHz: params.frequencyHz,
  });
  const output = resampleRational(source, {
    inputRateHz: params.sourceRateHz,
    outputRateHz: params.targetRateHz,
    filter: params.antiAlias ? "kaiserSinc" : "none",
  });
  const samples = Float32Array.from(output);
  return {
    meta: {
      aliasFrequencyHz: aliasFrequencyHz(params.frequencyHz, params.targetRateHz),
      measuredPeakHz: dominantFrequencyHz(output, params.targetRateHz),
      outputSampleCount: samples.length,
    },
    payload: { buffer: samples.buffer, byteOffset: 0, byteLength: samples.byteLength },
  };
}

export type GenerateSynthParams = {
  waveform: SynthWaveform;
  sampleRateHz: number;
  durationSeconds: number;
  amplitude: number;
  frequencyHz?: number;
  dutyCycle?: number;
  impulseIndex?: number;
  stepIndex?: number;
  chirpFromHz?: number;
  chirpToHz?: number;
  chirpLog?: boolean;
  tone2Hz?: number;
  seed?: number;
  /** 0 = return the samples (load-as-source); > 0 = return that many
   * min/max buckets for the preview canvas. */
  previewBucketCount: number;
};
export type GenerateSynthResult = {
  meta: {
    waveform: SynthWaveform;
    sampleCount: number;
    sampleRateHz: number;
    mode: "source" | "preview";
    bucketCount: number;
  };
  payload?: TransferablePayload;
};

const SYNTH_WAVEFORMS: readonly SynthWaveform[] = [
  "sine",
  "square",
  "sawtooth",
  "triangle",
  "impulse",
  "step",
  "whiteNoise",
  "pinkNoise",
  "chirp",
  "twoTone",
];

/** F12 generator plumbing: map the UI params onto the wave-1 dsp generators
 * unchanged, then either bucket for the preview or return the samples for
 * `loadSource`. Validation beyond the dsp guards: the 300 s / 96 kHz source
 * caps so a preview cannot allocate past the session contract. */
export function generateSynth(
  params: GenerateSynthParams,
  _payload?: TransferablePayload,
): GenerateSynthResult {
  if (
    params === undefined ||
    params === null ||
    !SYNTH_WAVEFORMS.includes(params.waveform) ||
    !Number.isFinite(params.sampleRateHz) ||
    params.sampleRateHz <= 0 ||
    params.sampleRateHz > 96_000 ||
    !Number.isFinite(params.durationSeconds) ||
    params.durationSeconds < 0 ||
    params.durationSeconds > 300 ||
    !Number.isFinite(params.amplitude) ||
    !Number.isInteger(params.previewBucketCount) ||
    params.previewBucketCount < 0
  ) {
    throw new DspOpError("badParams", `generateSynth: invalid params ${String(params)}`);
  }
  const spec = {
    sampleRateHz: params.sampleRateHz,
    durationSeconds: params.durationSeconds,
    amplitude: params.amplitude,
  };
  const sampleCount = Math.round(params.sampleRateHz * params.durationSeconds);
  const clampIndex = (value: number): number =>
    sampleCount === 0 ? 0 : Math.min(sampleCount - 1, Math.max(0, Math.round(value)));
  let values: Float64Array;
  switch (params.waveform) {
    case "sine":
      values = generateSine({ ...spec, frequencyHz: params.frequencyHz ?? 440 });
      break;
    case "square":
      values = generateSquare({
        ...spec,
        frequencyHz: params.frequencyHz ?? 440,
        dutyCycle: params.dutyCycle ?? 0.5,
      });
      break;
    case "sawtooth":
      values = generateSawtooth({ ...spec, frequencyHz: params.frequencyHz ?? 440 });
      break;
    case "triangle":
      values = generateTriangle({ ...spec, frequencyHz: params.frequencyHz ?? 440 });
      break;
    case "impulse":
      values = generateImpulse({
        ...spec,
        impulseSampleIndex: clampIndex(params.impulseIndex ?? 0),
      });
      break;
    case "step":
      values = generateStep({
        ...spec,
        stepSampleIndex: clampIndex(params.stepIndex ?? 0),
        amplitudeBefore: 0,
        amplitudeAfter: params.amplitude,
      });
      break;
    case "whiteNoise":
      values = generateWhiteNoise({ ...spec, seed: params.seed ?? 1 });
      break;
    case "pinkNoise":
      values = generatePinkNoise({ ...spec, seed: params.seed ?? 1 });
      break;
    case "chirp":
      values = generateChirp({
        ...spec,
        startFrequencyHz: params.chirpFromHz ?? 100,
        endFrequencyHz: params.chirpToHz ?? 8000,
        sweep: params.chirpLog === false ? "linear" : "logarithmic",
      });
      break;
    case "twoTone":
      values = generateTwoTone({
        ...spec,
        frequenciesHz: [params.frequencyHz ?? 440, params.tone2Hz ?? 880],
      });
      break;
    default:
      throw new DspOpError("badParams", `generateSynth: unknown waveform ${params.waveform}`);
  }
  if (params.previewBucketCount > 0) {
    const minMax = computePeakBuckets(Float32Array.from(values), params.previewBucketCount);
    return {
      meta: {
        waveform: params.waveform,
        sampleCount: values.length,
        sampleRateHz: params.sampleRateHz,
        mode: "preview",
        bucketCount: minMax.byteLength / 8,
      },
      payload: { buffer: minMax.buffer, byteOffset: 0, byteLength: minMax.byteLength },
    };
  }
  const samples = Float32Array.from(values);
  return {
    meta: {
      waveform: params.waveform,
      sampleCount: samples.length,
      sampleRateHz: params.sampleRateHz,
      mode: "source",
      bucketCount: 0,
    },
    payload: { buffer: samples.buffer, byteOffset: 0, byteLength: samples.byteLength },
  };
}

const PIPELINE_MAX_EXCERPT_SECONDS = 30;

export type PipelineRunParams = {
  readonly graph: PipelineGraph;
  readonly sampleRateHz: number;
  readonly startSample: number;
  readonly endSample: number;
};

export type PipelineRunOpResult = {
  readonly meta: {
    readonly stages: readonly PipelineStageSummary[];
    readonly outputs: readonly PipelineOutput[];
    readonly totalElapsedMs: number;
  };
  readonly payload: TransferablePayload;
};

export function pipelineRun(
  params: PipelineRunParams,
  payload: TransferablePayload | undefined,
): PipelineRunOpResult {
  const { sampleRateHz, startSample, endSample } = params;
  if (
    !Number.isFinite(sampleRateHz) ||
    sampleRateHz <= 0 ||
    sampleRateHz > 96_000 ||
    !Number.isInteger(startSample) ||
    !Number.isInteger(endSample) ||
    startSample < 0 ||
    endSample <= startSample
  ) {
    throw new DspOpError("badParams", "pipelineRun: invalid sample rate or excerpt range");
  }
  const maxSamples = PIPELINE_MAX_EXCERPT_SECONDS * sampleRateHz;
  if (endSample - startSample > maxSamples) {
    throw new DspOpError(
      "badParams",
      `pipelineRun: excerpt must be ${PIPELINE_MAX_EXCERPT_SECONDS} s or shorter`,
    );
  }
  if (payload === undefined || payload.byteLength === 0 || payload.byteLength % 4 !== 0) {
    throw new DspOpError("badParams", "pipelineRun: payload must be aligned Float32 samples");
  }
  const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  if (samples.length !== endSample - startSample || samples.length > maxSamples) {
    throw new DspOpError("badParams", "pipelineRun: payload length must match the excerpt range");
  }

  let result: ReturnType<typeof runPipeline>;
  try {
    result = runPipeline(samples, sampleRateHz, params.graph);
  } catch (error) {
    if (error instanceof PipelineRunError) {
      throw new DspOpError(error.code, error.message);
    }
    throw new DspOpError(
      "badParams",
      error instanceof Error ? error.message : "pipelineRun: invalid graph",
    );
  }

  return {
    meta: {
      stages: result.stages,
      outputs: result.outputs,
      totalElapsedMs: result.totalElapsedMs,
    },
    payload: {
      buffer: result.samples.buffer as ArrayBuffer,
      byteOffset: result.samples.byteOffset,
      byteLength: result.samples.byteLength,
    },
  };
}

export const dspOps = {
  pipelineRun: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      graph: { version: 1, nodes: [], edges: [] },
      sampleRateHz: 0,
      startSample: 0,
      endSample: 0,
    } as PipelineRunParams,
    result: undefined as unknown as PipelineRunOpResult,
    handler: pipelineRun,
  },
  waveformOverview: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { bucketCount: 0, sampleRateHz: 0 },
    result: undefined as unknown as WaveformOverviewResult,
    handler: waveformOverview,
  },
  waveformRange: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { bucketCount: 0, sampleRateHz: 0, startSample: 0, endSample: 0 },
    result: undefined as unknown as WaveformRangeResult,
    handler: waveformRange,
  },
  waveformEnvelope: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { bucketCount: 0 },
    result: undefined as unknown as WaveformEnvelopeResult,
    handler: waveformEnvelope,
  },
  qualityMetrics: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { sampleRateHz: 0, sampleCount: 0 },
    result: undefined as unknown as QualityMetricsResult,
    handler: qualityMetrics,
  },
  fftSelection: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      sampleRateHz: 0,
      startSample: 0,
      endSample: 0,
      windowFamily: "hann" as FftSelectionParams["windowFamily"],
      windowLengthSamples: 0,
      magnitudeMode: "db" as FftSelectionParams["magnitudeMode"],
      phaseMode: "wrapped" as FftSelectionParams["phaseMode"],
    },
    result: undefined as unknown as FftSelectionResult,
    handler: fftSelection,
  },
  windowProfiles: {
    // Type lenses only �?" the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { sampleRateHz: 0, windowLengthSamples: 0 },
    result: undefined as unknown as WindowProfilesResult,
    handler: windowProfiles,
  },
  spectrumEdit: {
    // Type lenses only �?" the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      sampleRateHz: 0,
      startSample: 0,
      endSample: 0,
      edits: [] as readonly SpectrumEdit[],
      hermitian: true,
    },
    result: undefined as unknown as SpectrumEditResult,
    handler: spectrumEdit,
  },
  codecLabProcess: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      codec: "rle" as CodecLabCodec,
      sampleRateHz: 0,
      startSample: 0,
      endSample: 0,
      mdctBitsPerSecond: 128_000,
      mdctPsychoacoustic: false,
      mdctReferenceSplDb: PSYCHO_REFERENCE_SPL_DB,
    } as CodecLabParams,
    result: undefined as unknown as CodecLabResult,
    handler: codecLabProcess,
  },
  psychoacousticCurves: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      sampleRateHz: 0,
      referenceSplDb: PSYCHO_REFERENCE_SPL_DB,
    },
    result: undefined as unknown as PsychoacousticCurvesResult,
    handler: psychoacousticCurves,
  },
  psychoacousticAnalysis: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      sampleRateHz: 0,
      startSample: 0,
      endSample: 0,
      referenceSplDb: PSYCHO_REFERENCE_SPL_DB,
    },
    result: undefined as unknown as PsychoacousticAnalysisResult,
    handler: psychoacousticAnalysis,
  },
  generateSynth: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      waveform: "sine" as GenerateSynthParams["waveform"],
      sampleRateHz: 0,
      durationSeconds: 0,
      amplitude: 0,
      previewBucketCount: 0,
    },
    result: undefined as unknown as GenerateSynthResult,
    handler: generateSynth,
  },
  filterDesign: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      kind: "fir" as FilterDesignKind,
      band: "lowpass" as FilterBand,
      cutoffHz: 0,
      order: 0,
      taps: 0,
      window: "hamming" as FilterWindowKind,
      rippleDb: 0,
      q: 0,
      gainDb: 0,
      sampleRateHz: 0,
    } as FilterDesignParams,
    result: undefined as unknown as FilterDesignResult,
    handler: filterDesign,
  },
  filterApply: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      b: [1],
      a: [1],
      fir: true,
      sampleRateHz: 0,
      compensateDelay: false,
    } as FilterApplyParams,
    result: undefined as unknown as FilterApplyResult,
    handler: filterApply,
  },
  superresBaseline: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { sampleRateHz: 0, targetRateHz: 0 },
    result: undefined as unknown as SuperresBaselineResult,
    handler: superresBaseline,
  },
  speedTransform: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      sampleRateHz: 0,
      startSample: 0,
      endSample: 0,
      mode: "resample" as SpeedTransformParams["mode"],
      speedFactor: 1,
      semitones: 0,
      reverse: false,
    },
    result: undefined as unknown as SpeedTransformResult,
    handler: speedTransform,
  },
  extentProcess: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { sampleRateHz: 0, operation: "identity" } as ExtentProcessParams,
    result: undefined as unknown as ExtentProcessResult,
    handler: extentProcess,
  },
  reverbProcess: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      sampleRateHz: 0,
      startSample: 0,
      endSample: 0,
      ir: {
        kind: "hall" as ReverbIrParams["kind"],
        durationSeconds: 1,
        rt60Seconds: 0.5,
        seed: 1,
      },
      uploadedIrSampleCount: 0,
      preDelayMs: 0,
      wetMix: 1,
      method: "fft" as ReverbProcessParams["method"],
    },
    result: undefined as unknown as ReverbProcessResult,
    handler: reverbProcess,
  },
  convolutionSteps: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { signal: [], ir: [] } as ConvolutionStepsParams,
    result: undefined as unknown as ConvolutionStepsResult,
    handler: convolutionSteps,
  },
  samplingProcess: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      sampleRateHz: 0,
      startSample: 0,
      endSample: 0,
      targetRateHz: 0,
      antiAlias: true,
      bits: 16,
      dither: false,
      seed: 1,
    },
    result: undefined as unknown as SamplingProcessResult,
    handler: samplingProcess,
  },
  aliasDemo: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      sourceRateHz: 0,
      targetRateHz: 0,
      frequencyHz: 0,
      durationSeconds: 0,
      antiAlias: false,
    },
    result: undefined as unknown as AliasDemoResult,
    handler: aliasDemo,
  },
  spectrogramTiles: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: {
      sampleRateHz: 0,
      windowFamily: "hann",
      windowLengthSamples: 0,
      hopFraction: 0,
      dbFloorDb: 0,
      rowStart: 0,
      rowCount: 0,
      frameStride: 1,
      sourceStartSample: 0,
    } as SpectrogramTilesParams,
    result: undefined as unknown as SpectrogramTilesResult,
    handler: spectrogramTiles,
  },
  sessionPing: {
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { count: 0 },
    result: undefined as unknown as SessionPingResult,
    handler: sessionPing,
  },
} satisfies DspOpTable;
