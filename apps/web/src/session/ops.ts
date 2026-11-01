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
  computePeakBuckets,
  spectrogramTiles as computeSpectrogramTiles,
  fft,
  generateChirp,
  generateImpulse,
  generatePinkNoise,
  generateSawtooth,
  generateSine,
  generateSquare,
  generateStep,
  generateTriangle,
  generateTwoTone,
  generateWhiteNoise,
  kaiser,
  magnitudeDb,
  pitchShift,
  resampleRational,
  reverse,
  type SpectrogramTilesParams,
  timeStretch,
  unwrapPhase,
  window,
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

export const dspOps = {
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
    // Type lenses only — the table is read for types (DspOpParams/Result);
    // runtime code dispatches through the worker switch.
    params: { sampleRateHz: 0, windowLengthSamples: 0 },
    result: undefined as unknown as WindowProfilesResult,
    handler: windowProfiles,
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
