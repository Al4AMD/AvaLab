/**
 * F10 reverse + reverb lab (Wave-3 Plan 04 Task 3).
 *
 * Two separate teaching cards on purpose (AGENTS F10): “reverse” is time
 * reversal x[N−1−n] with no wet/dry controls; “reverb” is convolution with an
 * impulse response. All convolution and FFT work runs in the worker through
 * `deriveStandalone`; the view only maps params, paints returned buffers and
 * installs the settled result into the processed-playback lane.
 *
 * Uploaded IRs reuse the F01 browser decode seam (`browserDecodeWav` +
 * `monoDownmix`), are capped at 10 s, and are resampled to the source rate by
 * the worker op. Synthetic IRs are deterministic for a seed.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { Button } from "../../components/ui/button";
import { formatHz, formatS } from "../../lib/format";
import { writeLastUsed } from "../../lib/lastUsed";
import {
  type ConvolutionStepsResult,
  FFT_MAX_LENGTH,
  type FftSelectionParams,
  type ReverbIrParams,
  type ReverbProcessParams,
  type ReverbProcessResult,
} from "../../session/ops";
import { DspRpcError } from "../../session/rpc";
import { useSessionStore } from "../../session/store";
import { browserDecodeWav, monoDownmix } from "../input/ingest";
import { UploadEmptyState } from "../input/upload";
import { paintSpectrogramChunk } from "../spectrogram/paintSpectrogram";
import { paintWaveform } from "../waveform/paintWaveform";
import {
  defaultReverbRange,
  loadReverbSettings,
  REVERB_MAX_IR_SECONDS,
  REVERB_MAX_PRE_DELAY_MS,
  REVERB_MAX_RT60_SECONDS,
  REVERB_MAX_SEED,
  REVERB_MAX_UPLOADED_IR_SECONDS,
  REVERB_MIN_IR_SECONDS,
  REVERB_MIN_RT60_SECONDS,
  REVERB_STORAGE_KEY,
  type ReverbIrPreset,
  type ReverbSettings,
  reverbPresetDefaults,
  reverbSettingsFromSearch,
  reverbSettingsToSearch,
} from "./reverbState";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;
const WAVEFORM_HEIGHT_PX = 72;
const SPECTROGRAM_HEIGHT_PX = 160;
const CHART_HEIGHT_PX = 120;
const MAX_DEVICE_PIXEL_RATIO = 2;
const SPECTROGRAM_WINDOW_SAMPLES = 1024;
const SPECTROGRAM_HOP_SAMPLES = 256;
const SPECTROGRAM_DB_FLOOR = -100;
const SPECTROGRAM_ANALYSIS_SECONDS = 30;
const TIMING_EXCERPT_SAMPLES = 4096;
const TIMING_IR_SECONDS = 0.25;
const STEP_SIGNAL_SAMPLES = 24;
const STEP_IR = [1, 0.5, -0.25, 0.125, -0.0625, 0.03125] as const;

type SpectrumData = {
  readonly frequenciesHz: Float64Array;
  readonly magnitude: Float64Array;
  readonly phase: Float64Array;
  readonly fftLengthSamples: number;
};

type ReverbResult = {
  readonly meta: ReverbProcessResult["meta"];
  readonly samples: Float32Array;
};

type UploadedIr = {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
  readonly name: string;
};

type ReverbErrorCode =
  | "tooLong"
  | "directTooLong"
  | "failed"
  | "irMissing"
  | "irTooLong"
  | "irInvalid"
  | "irDecode";

function useCanvasWidth(): {
  readonly hostRef: React.RefObject<HTMLDivElement | null>;
  readonly widthPx: number;
} {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(640);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setWidthPx(Math.max(1, Math.round(entry.contentRect.width)));
      }
    });
    observer.observe(host);
    setWidthPx(Math.max(1, Math.round(host.getBoundingClientRect().width)));
    return () => {
      observer.disconnect();
    };
  }, []);
  return { hostRef, widthPx };
}

function WaveformPanel({
  samples,
  ariaLabel,
  testId,
}: {
  readonly samples: Float32Array;
  readonly ariaLabel: string;
  readonly testId: string;
}) {
  const { hostRef, widthPx } = useCanvasWidth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    let cancelled = false;
    const copy = samples.slice();
    const ticket = useSessionStore
      .getState()
      .deriveStandalone(
        "waveformEnvelope",
        { bucketCount: Math.max(1, Math.round(widthPx)) },
        { buffer: copy.buffer, byteOffset: 0, byteLength: copy.byteLength },
      );
    ticket.outcome.then(
      (outcome) => {
        if (cancelled || "cancelled" in outcome || outcome.payload === undefined) {
          return;
        }
        const payload = outcome.payload;
        const minMax = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO);
        paintWaveform(ctx, minMax, {
          widthPx,
          heightPx: WAVEFORM_HEIGHT_PX,
          dpr,
          background: "#0b1220",
          wave: "#8bd3c7",
          center: "#334155",
          playhead: "#f59e0b",
          selection: "rgba(56,189,248,0.18)",
        });
      },
      () => {
        // The envelope is display-only; a failed request leaves the canvas blank.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [samples, widthPx]);
  return (
    <div ref={hostRef} dir="ltr">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        data-testid={testId}
        style={{ height: `${WAVEFORM_HEIGHT_PX}px` }}
        className="block w-full rounded bg-bg ring-1 ring-surface"
      />
    </div>
  );
}

function LineChart({
  x,
  y,
  ariaLabel,
  testId,
  xLabel,
  yLabel,
  yFormat,
  xFormat = formatHz,
  color = "#38bdf8",
}: {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly ariaLabel: string;
  readonly testId: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly yFormat: (value: number) => string;
  readonly xFormat?: (value: number) => string;
  readonly color?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(640);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setWidthPx(Math.max(1, Math.round(entry.contentRect.width)));
      }
    });
    observer.observe(host);
    setWidthPx(Math.max(1, Math.round(host.getBoundingClientRect().width)));
    return () => {
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || x.length < 2) {
      return;
    }
    const options: uPlot.Options = {
      width: widthPx,
      height: CHART_HEIGHT_PX,
      legend: { show: false },
      cursor: { show: false },
      scales: { x: { time: false } },
      series: [{}, { stroke: color, width: 1, points: { show: false } }],
      axes: [
        {
          stroke: "#8b98a5",
          grid: { stroke: "#1f2933" },
          label: xLabel,
          labelSize: 14,
          size: 32,
          values: (_self, splits) => splits.map((value) => xFormat(value)),
        },
        {
          stroke: "#8b98a5",
          grid: { stroke: "#1f2933" },
          label: yLabel,
          labelSize: 14,
          size: 46,
          values: (_self, splits) => splits.map((value) => yFormat(value)),
        },
      ],
    };
    const plot = new uPlot(options, [x, y] as uPlot.AlignedData, host);
    return () => {
      plot.destroy();
    };
  }, [x, y, widthPx, xLabel, yLabel, yFormat, color, xFormat]);
  return <div ref={hostRef} dir="ltr" role="img" aria-label={ariaLabel} data-testid={testId} />;
}

function SpectrogramPanel({
  samples,
  sampleRateHz,
  ariaLabel,
  testId,
}: {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
  readonly ariaLabel: string;
  readonly testId: string;
}) {
  const { hostRef, widthPx } = useCanvasWidth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tile, setTile] = useState<{
    readonly rows: Float32Array;
    readonly rowCount: number;
    readonly columnCount: number;
  } | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const limit = Math.min(samples.length, Math.round(SPECTROGRAM_ANALYSIS_SECONDS * sampleRateHz));
    if (limit < SPECTROGRAM_WINDOW_SAMPLES) {
      setTile(null);
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const rowCount = Math.max(1, Math.ceil(limit / SPECTROGRAM_HOP_SAMPLES));
    const copy = samples.slice(0, limit);
    const ticket = useSessionStore.getState().deriveStandalone(
      "spectrogramTiles",
      {
        sampleRateHz,
        windowFamily: "hann",
        windowLengthSamples: SPECTROGRAM_WINDOW_SAMPLES,
        hopFraction: SPECTROGRAM_HOP_SAMPLES / SPECTROGRAM_WINDOW_SAMPLES,
        dbFloorDb: SPECTROGRAM_DB_FLOOR,
        rowStart: 0,
        rowCount,
        frameStride: 1,
        sourceStartSample: 0,
      },
      { buffer: copy.buffer, byteOffset: 0, byteLength: copy.byteLength },
    );
    ticket.outcome.then(
      (outcome) => {
        if (generationRef.current !== generation || "cancelled" in outcome) {
          return;
        }
        const payload = outcome.payload;
        if (payload === undefined) {
          setTile(null);
          return;
        }
        setTile({
          rows: new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
          rowCount: outcome.meta.rowCount,
          columnCount: outcome.meta.columnCount,
        });
      },
      () => {
        if (generationRef.current === generation) {
          setTile(null);
        }
      },
    );
  }, [samples, sampleRateHz]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || tile === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO);
    paintSpectrogramChunk(ctx, tile.rows, {
      widthPx,
      heightPx: SPECTROGRAM_HEIGHT_PX,
      dpr,
      binCount: tile.columnCount,
      frameStart: 0,
      frameCount: tile.rowCount,
      frameStride: 1,
      totalFrames: tile.rowCount,
      dbMinDb: SPECTROGRAM_DB_FLOOR,
      dbMaxDb: 0,
      axisMode: "linear",
      nyquistHz: sampleRateHz / 2,
      colormap: "viridis",
    });
  }, [tile, widthPx, sampleRateHz]);

  return (
    <div ref={hostRef} dir="ltr">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        data-testid={testId}
        style={{ height: `${SPECTROGRAM_HEIGHT_PX}px` }}
        className="block w-full rounded bg-bg ring-1 ring-surface"
      />
    </div>
  );
}

function spectrumParams(
  sampleRateHz: number,
  analysisLength: number,
  windowFamily: FftSelectionParams["windowFamily"] = "hann",
): FftSelectionParams {
  return {
    sampleRateHz,
    startSample: 0,
    endSample: analysisLength,
    windowFamily,
    windowLengthSamples: analysisLength,
    magnitudeMode: "db",
    phaseMode: "wrapped",
  };
}

function readSpectrum(outcome: {
  meta: { binCount: number; fftLengthSamples: number };
  payload?: { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
}): SpectrumData | null {
  const payload = outcome.payload;
  if (payload === undefined) {
    return null;
  }
  const values = new Float64Array(payload.buffer, payload.byteOffset, payload.byteLength / 8);
  const binCount = outcome.meta.binCount;
  return {
    frequenciesHz: values.slice(0, binCount),
    magnitude: values.slice(binCount, binCount * 2),
    phase: values.slice(binCount * 2, binCount * 3),
    fftLengthSamples: outcome.meta.fftLengthSamples,
  };
}

function irParams(settings: ReverbSettings): ReverbIrParams {
  return {
    kind: settings.irKind === "upload" ? "hall" : settings.irKind,
    durationSeconds: settings.irDurationSeconds,
    rt60Seconds: settings.rt60Seconds,
    seed: settings.seed,
  };
}

function mainParams(
  settings: ReverbSettings,
  sampleRateHz: number,
  startSample: number,
  endSample: number,
  uploadedIrSampleCount: number,
  uploadedIrSampleRateHz: number | undefined,
): ReverbProcessParams {
  const base: ReverbProcessParams = {
    sampleRateHz,
    startSample,
    endSample,
    ir: irParams(settings),
    uploadedIrSampleCount,
    preDelayMs: settings.preDelayMs,
    wetMix: settings.wetMix,
    method: settings.method,
  };
  return uploadedIrSampleRateHz === undefined ? base : { ...base, uploadedIrSampleRateHz };
}

function payloadOf(samples: Float32Array): {
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
} {
  return { buffer: samples.buffer as ArrayBuffer, byteOffset: 0, byteLength: samples.byteLength };
}

export function ReverbView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useMemo(() => {
    const source = {
      sampleCount: original?.samples.length ?? 0,
      sampleRateHz: original?.sampleRateHz ?? 1,
    };
    if (searchParams.toString() === "") {
      return loadReverbSettings(source, selection);
    }
    return reverbSettingsFromSearch(`?${searchParams.toString()}`, source, selection);
  }, [searchParams, original, selection]);

  useEffect(() => {
    writeLastUsed(REVERB_STORAGE_KEY, reverbSettingsToSearch(settings));
  }, [settings]);
  const [uploadedIr, setUploadedIr] = useState<UploadedIr | null>(null);
  const [decodingIr, setDecodingIr] = useState(false);
  const [result, setResult] = useState<ReverbResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<ReverbErrorCode | null>(null);
  const [irSamples, setIrSamples] = useState<Float32Array | null>(null);
  const [irSpectrum, setIrSpectrum] = useState<SpectrumData | null>(null);
  const [reverseSpectra, setReverseSpectra] = useState<{
    readonly before: SpectrumData;
    readonly after: SpectrumData;
  } | null>(null);
  const [timing, setTiming] = useState<{ readonly fft: number; readonly direct: number } | null>(
    null,
  );
  const [timingBusy, setTimingBusy] = useState(false);
  const [steps, setSteps] = useState<ConvolutionStepsResult["meta"] | null>(null);
  const [stepPartials, setStepPartials] = useState<Float32Array | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const generationRef = useRef(0);
  const irGenerationRef = useRef(0);
  const reverseGenerationRef = useRef(0);
  const stepGenerationRef = useRef(0);

  function updateSettings(patch: Partial<ReverbSettings>): void {
    const next = { ...settings, ...patch };
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of new URLSearchParams(reverbSettingsToSearch(next))) {
      params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  }

  const previewRange = original
    ? defaultReverbRange(selection, original.samples.length, original.sampleRateHz)
    : { startSample: 0, endSample: 0 };

  useEffect(() => {
    if (original === null) {
      return;
    }
    if (settings.irKind === "upload" && uploadedIr === null) {
      setResult(null);
      setBusy(false);
      setErrorCode("irMissing");
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setErrorCode(null);
    setBusy(true);
    const timer = window.setTimeout(() => {
      const startSample = Math.max(0, Math.min(settings.startSample, original.samples.length));
      const endSample = Math.max(
        startSample,
        Math.min(settings.endSample, original.samples.length),
      );
      const source = original.samples.slice(startSample, endSample);
      if (source.length === 0) {
        setBusy(false);
        setErrorCode("failed");
        return;
      }
      if (settings.method === "direct" && source.length / original.sampleRateHz > 2) {
        setResult(null);
        setBusy(false);
        setErrorCode("directTooLong");
        return;
      }
      const uploaded = settings.irKind === "upload" ? uploadedIr : null;
      const combined = new Float32Array(source.length + (uploaded?.samples.length ?? 0));
      combined.set(source, 0);
      if (uploaded !== null) {
        combined.set(uploaded.samples, source.length);
      }
      const transfer = combined.slice();
      const ticket = useSessionStore
        .getState()
        .deriveStandalone(
          "reverbProcess",
          mainParams(
            settings,
            original.sampleRateHz,
            startSample,
            endSample,
            uploaded?.samples.length ?? 0,
            uploaded?.sampleRateHz,
          ),
          payloadOf(transfer),
        );
      ticket.outcome.then(
        (outcome) => {
          if (generationRef.current !== generation || "cancelled" in outcome) {
            return;
          }
          const payload = outcome.payload;
          if (payload === undefined) {
            setBusy(false);
            setErrorCode("failed");
            return;
          }
          setResult({
            meta: outcome.meta,
            samples: new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
          });
          setBusy(false);
        },
        (error: unknown) => {
          if (generationRef.current !== generation) {
            return;
          }
          setBusy(false);
          const code = error instanceof DspRpcError ? error.code : "failed";
          setErrorCode(
            code === "tooLong" ? "tooLong" : code === "badParams" ? "directTooLong" : "failed",
          );
        },
      );
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [original, settings, uploadedIr]);

  useEffect(() => {
    if (original === null) {
      setIrSamples(null);
      setIrSpectrum(null);
      return;
    }
    const generation = irGenerationRef.current + 1;
    irGenerationRef.current = generation;
    if (settings.irKind === "upload") {
      if (uploadedIr === null) {
        setIrSamples(null);
        setIrSpectrum(null);
        return;
      }
      setIrSamples(uploadedIr.samples);
      const analysisLength = Math.min(uploadedIr.samples.length, FFT_MAX_LENGTH);
      if (analysisLength < 2) {
        setIrSpectrum(null);
        return;
      }
      const copy = uploadedIr.samples.slice(0, analysisLength);
      const ticket = useSessionStore
        .getState()
        .deriveStandalone(
          "fftSelection",
          spectrumParams(uploadedIr.sampleRateHz, analysisLength, "hamming"),
          payloadOf(copy),
        );
      ticket.outcome.then(
        (outcome) => {
          if (irGenerationRef.current === generation && !("cancelled" in outcome)) {
            setIrSpectrum(readSpectrum(outcome));
          }
        },
        () => {
          if (irGenerationRef.current === generation) {
            setIrSpectrum(null);
          }
        },
      );
      return;
    }
    const impulse = new Float32Array([1]);
    // The panel shows the IR itself, not the wet/dry mix of a delta input.
    const irOnlyParams: ReverbProcessParams = {
      ...mainParams(settings, original.sampleRateHz, 0, 1, 0, undefined),
      preDelayMs: 0,
      wetMix: 1,
    };
    const ticket = useSessionStore
      .getState()
      .deriveStandalone("reverbProcess", irOnlyParams, payloadOf(impulse));
    ticket.outcome.then(
      (outcome) => {
        if (irGenerationRef.current !== generation || "cancelled" in outcome) {
          return;
        }
        const payload = outcome.payload;
        if (payload === undefined) {
          setIrSamples(null);
          setIrSpectrum(null);
          return;
        }
        const samples = new Float32Array(
          payload.buffer,
          payload.byteOffset,
          payload.byteLength / 4,
        );
        setIrSamples(samples);
        const analysisLength = Math.min(samples.length, FFT_MAX_LENGTH);
        if (analysisLength < 2) {
          setIrSpectrum(null);
          return;
        }
        const spectrumTicket = useSessionStore
          .getState()
          .deriveStandalone(
            "fftSelection",
            spectrumParams(original.sampleRateHz, analysisLength, "hamming"),
            payloadOf(samples.slice(0, analysisLength)),
          );
        spectrumTicket.outcome.then(
          (spectrumOutcome) => {
            if (irGenerationRef.current === generation && !("cancelled" in spectrumOutcome)) {
              setIrSpectrum(readSpectrum(spectrumOutcome));
            }
          },
          () => {
            if (irGenerationRef.current === generation) {
              setIrSpectrum(null);
            }
          },
        );
      },
      () => {
        if (irGenerationRef.current === generation) {
          setIrSamples(null);
          setIrSpectrum(null);
        }
      },
    );
  }, [original, settings, uploadedIr]);

  useEffect(() => {
    if (original === null) {
      setReverseSpectra(null);
      return;
    }
    const startSample = Math.max(0, Math.min(settings.startSample, original.samples.length));
    const endSample = Math.max(startSample, Math.min(settings.endSample, original.samples.length));
    const slice = original.samples.slice(startSample, endSample);
    if (slice.length < 2) {
      setReverseSpectra(null);
      return;
    }
    const generation = reverseGenerationRef.current + 1;
    reverseGenerationRef.current = generation;
    const analysisLength = Math.min(slice.length, FFT_MAX_LENGTH);
    // Compare the SAME window before and after reversal; reversing the whole
    // slice then taking its head would analyse the tail instead.
    const analysisSlice = slice.slice(0, analysisLength);
    void (async () => {
      const reverseTicket = useSessionStore
        .getState()
        .deriveStandalone(
          "extentProcess",
          { sampleRateHz: original.sampleRateHz, operation: "reverse" },
          payloadOf(analysisSlice.slice()),
        );
      const reverseOutcome = await reverseTicket.outcome;
      if (reverseGenerationRef.current !== generation || "cancelled" in reverseOutcome) {
        return;
      }
      const payload = reverseOutcome.payload;
      if (payload === undefined) {
        setReverseSpectra(null);
        return;
      }
      const reversed = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
      const beforeTicket = useSessionStore
        .getState()
        .deriveStandalone(
          "fftSelection",
          spectrumParams(original.sampleRateHz, analysisLength),
          payloadOf(slice.slice(0, analysisLength)),
        );
      const beforeOutcome = await beforeTicket.outcome;
      if (reverseGenerationRef.current !== generation || "cancelled" in beforeOutcome) {
        return;
      }
      const afterTicket = useSessionStore
        .getState()
        .deriveStandalone(
          "fftSelection",
          spectrumParams(original.sampleRateHz, analysisLength),
          payloadOf(reversed.slice(0, analysisLength)),
        );
      const afterOutcome = await afterTicket.outcome;
      if (reverseGenerationRef.current !== generation || "cancelled" in afterOutcome) {
        return;
      }
      const before = readSpectrum(beforeOutcome);
      const after = readSpectrum(afterOutcome);
      setReverseSpectra(before !== null && after !== null ? { before, after } : null);
    })().catch(() => {
      if (reverseGenerationRef.current === generation) {
        setReverseSpectra(null);
      }
    });
  }, [original, settings.startSample, settings.endSample]);

  useEffect(() => {
    if (original === null) {
      setSteps(null);
      setStepPartials(null);
      return;
    }
    const startSample = Math.max(0, Math.min(settings.startSample, original.samples.length));
    const signal = Array.from(
      original.samples.slice(startSample, startSample + STEP_SIGNAL_SAMPLES),
    );
    if (signal.length === 0) {
      setSteps(null);
      setStepPartials(null);
      return;
    }
    const generation = stepGenerationRef.current + 1;
    stepGenerationRef.current = generation;
    const ticket = useSessionStore.getState().deriveStandalone("convolutionSteps", {
      signal,
      ir: STEP_IR,
    });
    ticket.outcome.then(
      (outcome) => {
        if (stepGenerationRef.current !== generation || "cancelled" in outcome) {
          return;
        }
        const payload = outcome.payload;
        if (payload === undefined) {
          setSteps(null);
          setStepPartials(null);
          return;
        }
        setSteps(outcome.meta);
        setStepPartials(
          new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
        );
        setStepIndex((current) => Math.min(current, STEP_IR.length - 1));
      },
      () => {
        if (stepGenerationRef.current === generation) {
          setSteps(null);
          setStepPartials(null);
        }
      },
    );
  }, [original, settings.startSample]);

  async function handleIrFile(file: File): Promise<void> {
    setDecodingIr(true);
    setErrorCode(null);
    try {
      const bytes = await file.arrayBuffer();
      const decoded = await browserDecodeWav(bytes);
      const samples = monoDownmix(decoded);
      const durationSeconds = samples.length / decoded.sampleRate;
      if (samples.length === 0 || durationSeconds > REVERB_MAX_UPLOADED_IR_SECONDS + 1e-6) {
        setErrorCode("irTooLong");
        return;
      }
      for (const sample of samples) {
        if (!Number.isFinite(sample)) {
          setErrorCode("irInvalid");
          return;
        }
      }
      setUploadedIr({ samples, sampleRateHz: decoded.sampleRate, name: file.name });
      updateSettings({ irKind: "upload" });
    } catch {
      setErrorCode("irDecode");
    } finally {
      setDecodingIr(false);
    }
  }

  async function measureTiming(): Promise<void> {
    if (original === null || timingBusy) {
      return;
    }
    setTimingBusy(true);
    setTiming(null);
    try {
      const source = original.samples.slice(
        0,
        Math.min(TIMING_EXCERPT_SAMPLES, original.samples.length),
      );
      if (source.length < 2) {
        return;
      }
      const uploaded = settings.irKind === "upload" ? uploadedIr : null;
      const builtInIr = {
        ...irParams(settings),
        durationSeconds: Math.min(settings.irDurationSeconds, TIMING_IR_SECONDS),
      };
      const timingParams = {
        sampleRateHz: original.sampleRateHz,
        startSample: 0,
        endSample: source.length,
        ir: builtInIr,
        uploadedIrSampleCount: uploaded === null ? 0 : Math.min(uploaded.samples.length, 2048),
        preDelayMs: settings.preDelayMs,
        wetMix: settings.wetMix,
        method: "fft" as const,
      };
      const combined = new Float32Array(
        source.length + (uploaded === null ? 0 : Math.min(uploaded.samples.length, 2048)),
      );
      combined.set(source, 0);
      if (uploaded !== null) {
        combined.set(uploaded.samples.slice(0, 2048), source.length);
      }
      const timingParamsWithRate =
        uploaded === null
          ? timingParams
          : { ...timingParams, uploadedIrSampleRateHz: uploaded.sampleRateHz };
      const fftTicket = useSessionStore
        .getState()
        .deriveStandalone("reverbProcess", timingParamsWithRate, payloadOf(combined.slice()));
      const fftOutcome = await fftTicket.outcome;
      if ("cancelled" in fftOutcome) {
        return;
      }
      const directTicket = useSessionStore
        .getState()
        .deriveStandalone(
          "reverbProcess",
          { ...timingParamsWithRate, method: "direct" },
          payloadOf(combined.slice()),
        );
      const directOutcome = await directTicket.outcome;
      if ("cancelled" in directOutcome) {
        return;
      }
      setTiming({ fft: fftOutcome.meta.elapsedMs, direct: directOutcome.meta.elapsedMs });
    } catch {
      setTiming(null);
    } finally {
      setTimingBusy(false);
    }
  }

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{t("tool.reverb.title")}</h2>
        <UploadEmptyState />
      </section>
    );
  }

  const stepOutputLength = steps === null ? 0 : steps.signalSampleCount + steps.irSampleCount - 1;
  const stepValues =
    stepPartials === null || stepOutputLength === 0
      ? null
      : stepPartials.slice(stepIndex * stepOutputLength, (stepIndex + 1) * stepOutputLength);
  const stepX =
    stepValues === null ? null : Float64Array.from({ length: stepValues.length }, (_, i) => i);
  const phaseFormat = (value: number): string => `${value.toFixed(2)} rad`;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">{t("tool.reverb.title")}</h2>

      <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("reverb.controls.irPreset")}</span>
          <select
            value={settings.irKind}
            data-testid="reverb.control.ir"
            onChange={(event) => {
              const kind = event.currentTarget.value as ReverbIrPreset;
              updateSettings(
                kind === "upload"
                  ? { irKind: kind }
                  : { irKind: kind, ...reverbPresetDefaults(kind) },
              );
            }}
            className={INPUT_CLASSES}
          >
            <option value="room">{t("reverb.irPreset.room")}</option>
            <option value="hall">{t("reverb.irPreset.hall")}</option>
            <option value="plate">{t("reverb.irPreset.plate")}</option>
            <option value="telephone">{t("reverb.irPreset.telephone")}</option>
            <option value="upload">{t("reverb.irPreset.upload")}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("reverb.controls.rt60")}</span>
          <input
            type="number"
            min={REVERB_MIN_RT60_SECONDS}
            max={REVERB_MAX_RT60_SECONDS}
            step={0.1}
            value={settings.rt60Seconds}
            data-testid="reverb.control.rt60"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value) && value > 0) {
                updateSettings({ rt60Seconds: value });
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("reverb.controls.duration")}</span>
          <input
            type="number"
            min={REVERB_MIN_IR_SECONDS}
            max={REVERB_MAX_IR_SECONDS}
            step={0.1}
            value={settings.irDurationSeconds}
            data-testid="reverb.control.duration"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value) && value > 0) {
                updateSettings({ irDurationSeconds: value });
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("reverb.controls.seed")}</span>
          <input
            type="number"
            min={0}
            max={REVERB_MAX_SEED}
            step={1}
            value={settings.seed}
            data-testid="reverb.control.seed"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isSafeInteger(value) && value >= 0) {
                updateSettings({ seed: value });
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("reverb.controls.preDelay")}</span>
          <input
            type="number"
            min={0}
            max={REVERB_MAX_PRE_DELAY_MS}
            step={1}
            value={settings.preDelayMs}
            data-testid="reverb.control.preDelay"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value) && value >= 0) {
                updateSettings({ preDelayMs: value });
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("reverb.controls.wetMix")}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.wetMix}
            data-testid="reverb.control.wetMix"
            onChange={(event) => {
              updateSettings({ wetMix: Number(event.currentTarget.value) });
            }}
            className={CONTROL_FOCUS_CLASSES}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("reverb.controls.method")}</span>
          <select
            value={settings.method}
            data-testid="reverb.control.method"
            onChange={(event) => {
              updateSettings({ method: event.currentTarget.value as "fft" | "direct" });
            }}
            className={INPUT_CLASSES}
          >
            <option value="fft">{t("reverb.method.fft")}</option>
            <option value="direct">{t("reverb.method.direct")}</option>
          </select>
        </label>

        <div className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("reverb.controls.upload")}</span>
          <input
            type="file"
            accept="audio/*"
            data-testid="reverb.upload"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file !== undefined) {
                void handleIrFile(file);
              }
            }}
            className="text-xs"
          />
          <span className="text-muted">{t("reverb.controls.uploadHint")}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span dir="ltr">
          {t("reverb.range.pattern", {
            start: formatS(settings.startSample / original.sampleRateHz),
            end: formatS(settings.endSample / original.sampleRateHz),
          })}
        </span>
        <Button
          size="sm"
          variant="outline"
          data-testid="reverb.apply.preview"
          onClick={() => {
            updateSettings(previewRange);
          }}
        >
          {t("reverb.apply.preview")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="reverb.apply.whole"
          onClick={() => {
            updateSettings({ startSample: 0, endSample: original.samples.length });
          }}
        >
          {t("reverb.apply.whole")}
        </Button>
        {decodingIr && (
          <span data-testid="reverb.ir.decoding">{t("reverb.status.decodingIr")}</span>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded border border-surface p-3">
        <h3 className="text-sm font-semibold">{t("reverb.ir.title")}</h3>
        {uploadedIr !== null && settings.irKind === "upload" ? (
          <p className="text-xs text-muted" dir="ltr" data-testid="reverb.ir.name">
            {t("reverb.ir.uploadedName", { name: uploadedIr.name })}
          </p>
        ) : null}
        {irSamples === null ? (
          <p className="text-xs text-muted">{t("reverb.ir.empty")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <figure className="flex flex-col gap-1">
              <figcaption className="text-xs font-medium text-muted">
                {t("reverb.ir.waveform")}
              </figcaption>
              <WaveformPanel
                samples={irSamples}
                ariaLabel={t("reverb.ir.waveformAria")}
                testId="reverb.ir.waveform"
              />
            </figure>
            <figure className="flex min-w-0 flex-col gap-1">
              <figcaption className="text-xs font-medium text-muted">
                {t("reverb.ir.spectrum")}
              </figcaption>
              {irSpectrum === null ? (
                <p className="text-xs text-muted">{t("reverb.ir.empty")}</p>
              ) : (
                <LineChart
                  x={irSpectrum.frequenciesHz}
                  y={irSpectrum.magnitude}
                  ariaLabel={t("reverb.ir.spectrumAria")}
                  testId="reverb.ir.spectrum"
                  xLabel={t("reverb.frequencyAxis")}
                  yLabel={t("reverb.magnitudeAxis")}
                  yFormat={(value) => `${value.toFixed(0)} dB`}
                />
              )}
            </figure>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded border border-surface p-3">
        <h3 className="text-sm font-semibold">{t("reverb.result.title")}</h3>
        {errorCode !== null ? (
          <p data-testid="reverb.error" role="alert" className="text-sm text-danger">
            {errorCode === "tooLong"
              ? t("reverb.error.tooLong")
              : errorCode === "directTooLong"
                ? t("reverb.error.directTooLong")
                : errorCode === "irMissing"
                  ? t("reverb.error.irMissing")
                  : errorCode === "irTooLong"
                    ? t("reverb.error.irTooLong")
                    : errorCode === "irInvalid"
                      ? t("reverb.error.irInvalid")
                      : errorCode === "irDecode"
                        ? t("reverb.error.irDecode")
                        : t("reverb.error.failed")}
          </p>
        ) : busy ? (
          <p data-testid="reverb.status" className="text-sm text-muted">
            {t("reverb.status.computing")}
          </p>
        ) : result !== null ? (
          <>
            <dl className="flex flex-wrap gap-4 text-xs text-muted">
              <div className="flex items-center gap-1">
                <dt>{t("reverb.result.duration")}</dt>
                <dd dir="ltr" data-testid="reverb.metric.duration" className="tabular-nums">
                  {formatS(result.meta.outputSampleCount / original.sampleRateHz)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("reverb.result.irSamples")}</dt>
                <dd dir="ltr" data-testid="reverb.metric.irSamples" className="tabular-nums">
                  {result.meta.irSampleCount}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("reverb.result.preDelay")}</dt>
                <dd dir="ltr" data-testid="reverb.metric.preDelay" className="tabular-nums">
                  {formatS(result.meta.preDelaySamples / original.sampleRateHz)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("reverb.result.elapsed")}</dt>
                <dd dir="ltr" data-testid="reverb.metric.elapsed" className="tabular-nums">
                  {result.meta.elapsedMs.toFixed(1)} ms
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("reverb.result.method")}</dt>
                <dd data-testid="reverb.metric.method">
                  {result.meta.method === "fft"
                    ? t("reverb.method.fft")
                    : t("reverb.method.direct")}
                </dd>
              </div>
            </dl>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <figure className="flex flex-col gap-1">
                <figcaption className="text-xs font-medium text-muted">
                  {t("reverb.result.waveform")}
                </figcaption>
                <WaveformPanel
                  samples={result.samples}
                  ariaLabel={t("reverb.result.waveformAria")}
                  testId="reverb.result.waveform"
                />
              </figure>
              <figure className="flex min-w-0 flex-col gap-1">
                <figcaption className="text-xs font-medium text-muted">
                  {t("reverb.result.spectrogram")}
                </figcaption>
                <SpectrogramPanel
                  samples={result.samples}
                  sampleRateHz={original.sampleRateHz}
                  ariaLabel={t("reverb.result.spectrogramAria")}
                  testId="reverb.result.spectrogram"
                />
                <span className="text-xs text-muted">{t("reverb.result.spectrogramNote")}</span>
              </figure>
            </div>
            <div>
              <Button
                size="sm"
                variant="outline"
                data-testid="reverb.play"
                onClick={() => {
                  useSessionStore
                    .getState()
                    .setProcessed(result.samples.slice(), original.sampleRateHz, "reverb");
                }}
              >
                {t("reverb.play")}
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded border border-surface p-3">
        <h3 className="text-sm font-semibold">{t("reverb.timing.title")}</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Button
            size="sm"
            variant="outline"
            data-testid="reverb.timing.measure"
            disabled={timingBusy}
            onClick={() => {
              void measureTiming();
            }}
          >
            {timingBusy ? t("reverb.status.computing") : t("reverb.timing.measure")}
          </Button>
          {timing !== null && (
            <span dir="ltr" data-testid="reverb.timing.values" className="tabular-nums">
              {t("reverb.timing.values", {
                fft: timing.fft.toFixed(1),
                direct: timing.direct.toFixed(1),
              })}
            </span>
          )}
        </div>
        <p className="text-xs text-muted">{t("reverb.timing.note")}</p>
      </div>

      <div className="flex flex-col gap-2 rounded border border-surface p-3">
        <h3 className="text-sm font-semibold">{t("reverb.steps.title")}</h3>
        {steps === null || stepValues === null || stepX === null ? (
          <p className="text-xs text-muted">{t("reverb.steps.empty")}</p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">
                {t("reverb.steps.step", { step: stepIndex + 1, total: STEP_IR.length })}
              </span>
              <input
                type="range"
                min={0}
                max={STEP_IR.length - 1}
                step={1}
                value={stepIndex}
                data-testid="reverb.steps.slider"
                onChange={(event) => {
                  setStepIndex(Number(event.currentTarget.value));
                }}
                className={CONTROL_FOCUS_CLASSES}
              />
            </label>
            <LineChart
              x={stepX}
              y={Float64Array.from(stepValues)}
              ariaLabel={t("reverb.steps.chartAria")}
              testId="reverb.steps.chart"
              xLabel={t("reverb.steps.sampleAxis")}
              yLabel={t("reverb.steps.amplitudeAxis")}
              yFormat={(value) => value.toFixed(2)}
              xFormat={(value) => value.toFixed(0)}
              color="#f59e0b"
            />
            <p className="text-xs text-muted">{t("reverb.steps.note")}</p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded border border-surface p-3">
        <h3 className="text-sm font-semibold">{t("reverb.reverse.title")}</h3>
        <p data-testid="reverb.reverse.note" className="text-xs text-muted">
          {t("reverb.reverse.note")}
        </p>
        {reverseSpectra === null ? (
          <p className="text-xs text-muted">{t("reverb.reverse.empty")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <figure className="flex min-w-0 flex-col gap-1">
              <figcaption className="text-xs font-medium text-muted">
                {t("reverb.reverse.beforeMagnitude")}
              </figcaption>
              <LineChart
                x={reverseSpectra.before.frequenciesHz}
                y={reverseSpectra.before.magnitude}
                ariaLabel={t("reverb.reverse.beforeMagnitudeAria")}
                testId="reverb.reverse.beforeMagnitude"
                xLabel={t("reverb.frequencyAxis")}
                yLabel={t("reverb.magnitudeAxis")}
                yFormat={(value) => `${value.toFixed(0)} dB`}
              />
            </figure>
            <figure className="flex min-w-0 flex-col gap-1">
              <figcaption className="text-xs font-medium text-muted">
                {t("reverb.reverse.afterMagnitude")}
              </figcaption>
              <LineChart
                x={reverseSpectra.after.frequenciesHz}
                y={reverseSpectra.after.magnitude}
                ariaLabel={t("reverb.reverse.afterMagnitudeAria")}
                testId="reverb.reverse.afterMagnitude"
                xLabel={t("reverb.frequencyAxis")}
                yLabel={t("reverb.magnitudeAxis")}
                yFormat={(value) => `${value.toFixed(0)} dB`}
              />
            </figure>
            <figure className="flex min-w-0 flex-col gap-1">
              <figcaption className="text-xs font-medium text-muted">
                {t("reverb.reverse.beforePhase")}
              </figcaption>
              <LineChart
                x={reverseSpectra.before.frequenciesHz}
                y={reverseSpectra.before.phase}
                ariaLabel={t("reverb.reverse.beforePhaseAria")}
                testId="reverb.reverse.beforePhase"
                xLabel={t("reverb.frequencyAxis")}
                yLabel={t("reverb.phaseAxis")}
                yFormat={phaseFormat}
                color="#8bd3c7"
              />
            </figure>
            <figure className="flex min-w-0 flex-col gap-1">
              <figcaption className="text-xs font-medium text-muted">
                {t("reverb.reverse.afterPhase")}
              </figcaption>
              <LineChart
                x={reverseSpectra.after.frequenciesHz}
                y={reverseSpectra.after.phase}
                ariaLabel={t("reverb.reverse.afterPhaseAria")}
                testId="reverb.reverse.afterPhase"
                xLabel={t("reverb.frequencyAxis")}
                yLabel={t("reverb.phaseAxis")}
                yFormat={phaseFormat}
                color="#f59e0b"
              />
            </figure>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded border border-surface p-3 text-sm">
        <h3 className="text-sm font-semibold">{t("reverb.observe.title")}</h3>
        <ul className="list-disc ps-5 text-xs text-muted">
          <li>{t("reverb.observe.reverse")}</li>
          <li>{t("reverb.observe.reverb")}</li>
          <li>{t("reverb.observe.tail")}</li>
          <li>{t("reverb.observe.direct")}</li>
          <li>{t("reverb.observe.ir")}</li>
        </ul>
      </div>
    </section>
  );
}
