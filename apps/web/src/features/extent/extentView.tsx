/**
 * F07 signal-extent lab (Wave-3 Plan 03 Task 3).
 *
 * The view is parameter plumbing: every extent operation runs in the worker
 * through `deriveStandalone("extentProcess", …)` over the selected slice (or
 * the first 30 s), and the settled buffer is installed into the processed
 * playback lane on demand. Before/after spectra use `fftSelection` on copies,
 * so the window length shows the main-lobe and leakage consequences.
 *
 * `timeScale` intentionally has no anti-alias filter: this is the tape-style
 * demonstration, and the note points students to the sampling lab (F03) for
 * the filtered version.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import uPlot from "uplot";
import { ToolHeader } from "../../components/ToolHeader";
import "uplot/dist/uPlot.min.css";

import { Button } from "../../components/ui/button";
import { formatHz, formatS } from "../../lib/format";
import { writeLastUsed } from "../../lib/lastUsed";
import {
  type ExtentProcessParams,
  type ExtentProcessResult,
  FFT_MAX_LENGTH,
  type FftSelectionParams,
} from "../../session/ops";
import { DspRpcError } from "../../session/rpc";
import { useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import { TheoryPanel } from "../theory/TheoryPanel";
import { TOOL_THEORY } from "../theory/theoryContent";
import { paintWaveform } from "../waveform/paintWaveform";
import {
  defaultExtentRange,
  EXTENT_MAX_FACTOR,
  EXTENT_MAX_REPETITIONS,
  EXTENT_MIN_FACTOR,
  EXTENT_MIN_REPETITIONS,
  EXTENT_STORAGE_KEY,
  type ExtentOperationName,
  type ExtentSettings,
  extentSettingsFromSearch,
  extentSettingsToSearch,
  loadExtentSettings,
} from "./extentState";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;
const WAVEFORM_HEIGHT_PX = 72;
const SPECTRUM_HEIGHT_PX = 180;
const MAX_DEVICE_PIXEL_RATIO = 2;
const SPECTRUM_WINDOW_FAMILY = "hann" as const;

type ExtentResult = {
  readonly meta: ExtentProcessResult["meta"];
  readonly samples: Float32Array;
};

type Spectrum = {
  readonly frequenciesHz: Float64Array;
  readonly magnitude: Float64Array;
  readonly fftLengthSamples: number;
};

type ExtentErrorCode = "tooLong" | "failed";

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

function ExtentWaveform({
  samples,
  supportStartSample,
  supportEndSample,
  ariaLabel,
  testId,
}: {
  readonly samples: Float32Array;
  readonly supportStartSample: number;
  readonly supportEndSample: number;
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
        const sampleRange =
          samples.length === 0 ? undefined : { startSample: 0, endSample: samples.length - 1 };
        const selectionRange =
          sampleRange !== undefined && supportEndSample >= supportStartSample
            ? { startSample: supportStartSample, endSample: supportEndSample }
            : undefined;
        paintWaveform(ctx, minMax, {
          widthPx,
          heightPx: WAVEFORM_HEIGHT_PX,
          dpr,
          background: "#0b1220",
          wave: "#8bd3c7",
          center: "#334155",
          playhead: "#f59e0b",
          selection: "rgba(56,189,248,0.18)",
          sampleRange,
          selectionRange,
        });
      },
      () => {
        // The envelope is display-only; a failed request leaves the canvas blank.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [samples, widthPx, supportStartSample, supportEndSample]);
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

function SpectrumChart({
  spectrum,
  ariaLabel,
  testId,
  xLabel,
  yLabel,
}: {
  readonly spectrum: Spectrum | null;
  readonly ariaLabel: string;
  readonly testId: string;
  readonly xLabel: string;
  readonly yLabel: string;
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
    if (host === null || spectrum === null) {
      return;
    }
    const options: uPlot.Options = {
      width: widthPx,
      height: SPECTRUM_HEIGHT_PX,
      legend: { show: false },
      cursor: { show: false },
      scales: { x: { time: false } },
      series: [{}, { stroke: "#38bdf8", width: 1, points: { show: false } }],
      axes: [
        {
          stroke: "#8b98a5",
          grid: { stroke: "#1f2933" },
          label: xLabel,
          labelSize: 14,
          size: 32,
          values: (_self, splits) => splits.map((value) => formatHz(value)),
        },
        {
          stroke: "#8b98a5",
          grid: { stroke: "#1f2933" },
          label: yLabel,
          labelSize: 14,
          size: 44,
          values: (_self, splits) => splits.map((value) => `${value.toFixed(0)} dB`),
        },
      ],
    };
    const plot = new uPlot(
      options,
      [spectrum.frequenciesHz, spectrum.magnitude] as uPlot.AlignedData,
      host,
    );
    return () => {
      plot.destroy();
    };
  }, [spectrum, widthPx, xLabel, yLabel]);

  return <div ref={hostRef} dir="ltr" role="img" aria-label={ariaLabel} data-testid={testId} />;
}

function operationParams(settings: ExtentSettings, sampleRateHz: number): ExtentProcessParams {
  const base = { sampleRateHz };
  switch (settings.operation) {
    case "shift":
      return { ...base, operation: "shift", shiftSamples: settings.shiftSamples };
    case "scale":
      return { ...base, operation: "scale", factor: settings.scaleFactor };
    case "reverse":
      return { ...base, operation: "reverse" };
    case "truncate":
      return {
        ...base,
        operation: "truncate",
        startSampleIndex: settings.truncateStartSample,
        lengthSamples: settings.truncateLengthSamples,
      };
    case "zeroPad":
      return {
        ...base,
        operation: "zeroPad",
        padStartSamples: settings.padStartSamples,
        padEndSamples: settings.padEndSamples,
      };
    case "periodic":
      return { ...base, operation: "periodicExtend", repetitions: settings.repetitions };
    default:
      return { ...base, operation: "identity" };
  }
}

function spectrumParams(sampleRateHz: number, analysisLength: number): FftSelectionParams {
  return {
    sampleRateHz,
    startSample: 0,
    endSample: analysisLength,
    windowFamily: SPECTRUM_WINDOW_FAMILY,
    windowLengthSamples: analysisLength,
    magnitudeMode: "db",
    phaseMode: "wrapped",
  };
}

function readSpectrum(outcome: {
  meta: { binCount: number; fftLengthSamples: number };
  payload?: { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
}): Spectrum | null {
  const payload = outcome.payload;
  if (payload === undefined) {
    return null;
  }
  const values = new Float64Array(payload.buffer, payload.byteOffset, payload.byteLength / 8);
  const binCount = outcome.meta.binCount;
  return {
    frequenciesHz: values.slice(0, binCount),
    magnitude: values.slice(binCount, binCount * 2),
    fftLengthSamples: outcome.meta.fftLengthSamples,
  };
}

export function ExtentView(): React.ReactElement {
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
      return loadExtentSettings(source, selection);
    }
    return extentSettingsFromSearch(`?${searchParams.toString()}`, source, selection);
  }, [searchParams, original, selection]);

  useEffect(() => {
    writeLastUsed(EXTENT_STORAGE_KEY, extentSettingsToSearch(settings));
  }, [settings]);
  const [beforeSamples, setBeforeSamples] = useState<Float32Array | null>(null);
  const [result, setResult] = useState<ExtentResult | null>(null);
  const [beforeSpectrum, setBeforeSpectrum] = useState<Spectrum | null>(null);
  const [afterSpectrum, setAfterSpectrum] = useState<Spectrum | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<ExtentErrorCode | null>(null);
  const generationRef = useRef(0);
  const spectrumGenerationRef = useRef(0);

  function updateSettings(patch: Partial<ExtentSettings>): void {
    const next = { ...settings, ...patch };
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of new URLSearchParams(extentSettingsToSearch(next))) {
      params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    if (original === null) {
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
      const slice = original.samples.slice(startSample, endSample);
      if (slice.length === 0) {
        setBusy(false);
        setErrorCode("failed");
        return;
      }
      const transfer = slice.slice();
      const ticket = useSessionStore
        .getState()
        .deriveStandalone("extentProcess", operationParams(settings, original.sampleRateHz), {
          buffer: transfer.buffer,
          byteOffset: 0,
          byteLength: transfer.byteLength,
        });
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
          setBeforeSamples(slice);
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
          setErrorCode(
            error instanceof DspRpcError && error.code === "tooLong" ? "tooLong" : "failed",
          );
        },
      );
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [original, settings]);

  useEffect(() => {
    if (original === null || result === null || beforeSamples === null) {
      setBeforeSpectrum(null);
      setAfterSpectrum(null);
      return;
    }
    const beforeAnalysisLength = Math.min(beforeSamples.length, FFT_MAX_LENGTH);
    const afterAnalysisLength = Math.min(result.samples.length, FFT_MAX_LENGTH);
    if (beforeAnalysisLength < 2 || afterAnalysisLength < 2) {
      setBeforeSpectrum(null);
      setAfterSpectrum(null);
      return;
    }
    const generation = spectrumGenerationRef.current + 1;
    spectrumGenerationRef.current = generation;
    const afterWindowLength =
      settings.operation === "zeroPad" ? beforeAnalysisLength : afterAnalysisLength;
    // Sequential calls: the rpc layer supersedes identical op+params, and the
    // two spectra share params when the lengths match. Running them one after
    // the other keeps the before frame from being cancelled by the after call.
    void (async () => {
      const beforeFrame = beforeSamples.slice(0, beforeAnalysisLength);
      const beforeTicket = useSessionStore
        .getState()
        .deriveStandalone(
          "fftSelection",
          spectrumParams(original.sampleRateHz, beforeAnalysisLength),
          {
            buffer: beforeFrame.buffer,
            byteOffset: 0,
            byteLength: beforeFrame.byteLength,
          },
        );
      const beforeOutcome = await beforeTicket.outcome;
      if (spectrumGenerationRef.current !== generation || "cancelled" in beforeOutcome) {
        return;
      }
      const afterFrame = result.samples.slice(0, afterAnalysisLength);
      const afterTicket = useSessionStore
        .getState()
        .deriveStandalone(
          "fftSelection",
          spectrumParams(original.sampleRateHz, afterWindowLength),
          {
            buffer: afterFrame.buffer,
            byteOffset: 0,
            byteLength: afterFrame.byteLength,
          },
        );
      const afterOutcome = await afterTicket.outcome;
      if (spectrumGenerationRef.current !== generation || "cancelled" in afterOutcome) {
        return;
      }
      setBeforeSpectrum(readSpectrum(beforeOutcome));
      setAfterSpectrum(readSpectrum(afterOutcome));
    })().catch(() => {
      if (spectrumGenerationRef.current === generation) {
        setBeforeSpectrum(null);
        setAfterSpectrum(null);
      }
    });
  }, [original, result, beforeSamples, settings.operation]);

  const previewRange = original
    ? defaultExtentRange(selection, original.samples.length, original.sampleRateHz)
    : { startSample: 0, endSample: 0 };

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <ToolHeader titleKey="tool.extent.title" descriptionKey="tool.extent.description" />
        <UploadEmptyState />
      </section>
    );
  }

  const supportWidth =
    result !== null && result.meta.supportEndSample >= result.meta.supportStartSample
      ? result.meta.supportEndSample - result.meta.supportStartSample + 1
      : 0;
  const deltaFrequencyHz =
    afterSpectrum === null ? null : original.sampleRateHz / afterSpectrum.fftLengthSamples;

  return (
    <section className="flex flex-col gap-4">
      <ToolHeader titleKey="tool.extent.title" descriptionKey="tool.extent.description" />

      <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("extent.controls.operation")}</span>
          <select
            value={settings.operation}
            data-testid="extent.control.operation"
            onChange={(event) => {
              updateSettings({ operation: event.currentTarget.value as ExtentOperationName });
            }}
            className={INPUT_CLASSES}
          >
            <option value="identity">{t("extent.operation.identity")}</option>
            <option value="shift">{t("extent.operation.shift")}</option>
            <option value="scale">{t("extent.operation.scale")}</option>
            <option value="reverse">{t("extent.operation.reverse")}</option>
            <option value="truncate">{t("extent.operation.truncate")}</option>
            <option value="zeroPad">{t("extent.operation.zeroPad")}</option>
            <option value="periodic">{t("extent.operation.periodic")}</option>
          </select>
        </label>

        {settings.operation === "shift" && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("extent.controls.shiftSamples")}</span>
            <input
              type="number"
              step={1}
              value={settings.shiftSamples}
              data-testid="extent.control.shift"
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isSafeInteger(value)) {
                  updateSettings({ shiftSamples: value });
                }
              }}
              className={INPUT_CLASSES}
            />
          </label>
        )}

        {settings.operation === "scale" && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("extent.controls.scaleFactor")}</span>
            <input
              type="number"
              min={EXTENT_MIN_FACTOR}
              max={EXTENT_MAX_FACTOR}
              step={0.25}
              value={settings.scaleFactor}
              data-testid="extent.control.scale"
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (
                  Number.isFinite(value) &&
                  value >= EXTENT_MIN_FACTOR &&
                  value <= EXTENT_MAX_FACTOR
                ) {
                  updateSettings({ scaleFactor: value });
                }
              }}
              className={INPUT_CLASSES}
            />
          </label>
        )}

        {settings.operation === "truncate" && (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("extent.controls.truncateStart")}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={settings.truncateStartSample}
                data-testid="extent.control.truncateStart"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isSafeInteger(value) && value >= 0) {
                    updateSettings({ truncateStartSample: value });
                  }
                }}
                className={INPUT_CLASSES}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("extent.controls.truncateLength")}</span>
              <input
                type="number"
                min={1}
                step={1}
                value={settings.truncateLengthSamples}
                data-testid="extent.control.truncateLength"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isSafeInteger(value) && value > 0) {
                    updateSettings({ truncateLengthSamples: value });
                  }
                }}
                className={INPUT_CLASSES}
              />
            </label>
          </>
        )}

        {settings.operation === "zeroPad" && (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("extent.controls.padStart")}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={settings.padStartSamples}
                data-testid="extent.control.padStart"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isSafeInteger(value) && value >= 0) {
                    updateSettings({ padStartSamples: value });
                  }
                }}
                className={INPUT_CLASSES}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("extent.controls.padEnd")}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={settings.padEndSamples}
                data-testid="extent.control.padEnd"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isSafeInteger(value) && value >= 0) {
                    updateSettings({ padEndSamples: value });
                  }
                }}
                className={INPUT_CLASSES}
              />
            </label>
          </>
        )}

        {settings.operation === "periodic" && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("extent.controls.repetitions")}</span>
            <input
              type="number"
              min={EXTENT_MIN_REPETITIONS}
              max={EXTENT_MAX_REPETITIONS}
              step={1}
              value={settings.repetitions}
              data-testid="extent.control.repetitions"
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (
                  Number.isInteger(value) &&
                  value >= EXTENT_MIN_REPETITIONS &&
                  value <= EXTENT_MAX_REPETITIONS
                ) {
                  updateSettings({ repetitions: value });
                }
              }}
              className={INPUT_CLASSES}
            />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span dir="ltr">
          {t("extent.range.pattern", {
            start: formatS(settings.startSample / original.sampleRateHz),
            end: formatS(settings.endSample / original.sampleRateHz),
          })}
        </span>
        <Button
          size="sm"
          variant="outline"
          data-testid="extent.apply.preview"
          onClick={() => {
            updateSettings(previewRange);
          }}
        >
          {t("extent.apply.preview")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="extent.apply.whole"
          onClick={() => {
            updateSettings({ startSample: 0, endSample: original.samples.length });
          }}
        >
          {t("extent.apply.whole")}
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded border border-surface p-3">
        <h3 className="text-sm font-semibold">{t("extent.result.title")}</h3>
        {errorCode !== null ? (
          <p data-testid="extent.error" role="alert" className="text-sm text-danger">
            {errorCode === "tooLong" ? t("extent.error.tooLong") : t("extent.error.failed")}
          </p>
        ) : busy ? (
          <p data-testid="extent.status" className="text-sm text-muted">
            {t("extent.status.computing")}
          </p>
        ) : result !== null ? (
          <>
            <dl className="flex flex-wrap gap-4 text-xs text-muted">
              <div className="flex items-center gap-1">
                <dt>{t("extent.metrics.duration")}</dt>
                <dd dir="ltr" data-testid="extent.metric.duration" className="tabular-nums">
                  {formatS(result.meta.durationSeconds)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("extent.metrics.samples")}</dt>
                <dd dir="ltr" data-testid="extent.metric.samples" className="tabular-nums">
                  {result.meta.outputSampleCount}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("extent.metrics.support")}</dt>
                <dd dir="ltr" data-testid="extent.metric.support" className="tabular-nums">
                  {supportWidth === 0
                    ? t("extent.metrics.emptySupport")
                    : t("extent.metrics.supportPattern", {
                        start: result.meta.supportStartSample,
                        end: result.meta.supportEndSample,
                      })}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("extent.metrics.energy")}</dt>
                <dd dir="ltr" data-testid="extent.metric.energy" className="tabular-nums">
                  {result.meta.energy.toExponential(3)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("extent.metrics.averagePower")}</dt>
                <dd dir="ltr" data-testid="extent.metric.averagePower" className="tabular-nums">
                  {result.meta.averagePower.toExponential(3)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("extent.metrics.type")}</dt>
                <dd data-testid="extent.metric.type" className="font-medium text-text">
                  {result.meta.signalType === "energy"
                    ? t("extent.signalType.energy")
                    : t("extent.signalType.power")}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("extent.metrics.deltaF")}</dt>
                <dd dir="ltr" data-testid="extent.metric.deltaF" className="tabular-nums">
                  {deltaFrequencyHz === null ? "—" : formatHz(deltaFrequencyHz)}
                </dd>
              </div>
            </dl>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <figure className="flex flex-col gap-1">
                <figcaption className="text-xs font-medium text-muted">
                  {t("extent.waveform.before")}
                </figcaption>
                <ExtentWaveform
                  samples={beforeSamples ?? new Float32Array(0)}
                  supportStartSample={result.meta.beforeSupportStartSample}
                  supportEndSample={result.meta.beforeSupportEndSample}
                  ariaLabel={t("extent.waveform.beforeAria")}
                  testId="extent.waveform.before"
                />
              </figure>
              <figure className="flex flex-col gap-1">
                <figcaption className="text-xs font-medium text-muted">
                  {t("extent.waveform.after")}
                </figcaption>
                <ExtentWaveform
                  samples={result.samples}
                  supportStartSample={result.meta.supportStartSample}
                  supportEndSample={result.meta.supportEndSample}
                  ariaLabel={t("extent.waveform.afterAria")}
                  testId="extent.waveform.after"
                />
              </figure>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <figure className="flex min-w-0 flex-col gap-1">
                <figcaption className="text-xs font-medium text-muted">
                  {t("extent.spectrum.before")}
                </figcaption>
                <SpectrumChart
                  spectrum={beforeSpectrum}
                  ariaLabel={t("extent.spectrum.beforeAria")}
                  testId="extent.spectrum.before"
                  xLabel={t("extent.spectrum.frequencyAxis")}
                  yLabel={t("extent.spectrum.magnitudeAxis")}
                />
              </figure>
              <figure className="flex min-w-0 flex-col gap-1">
                <figcaption className="text-xs font-medium text-muted">
                  {t("extent.spectrum.after")}
                </figcaption>
                <SpectrumChart
                  spectrum={afterSpectrum}
                  ariaLabel={t("extent.spectrum.afterAria")}
                  testId="extent.spectrum.after"
                  xLabel={t("extent.spectrum.frequencyAxis")}
                  yLabel={t("extent.spectrum.magnitudeAxis")}
                />
              </figure>
            </div>

            <div>
              <Button
                size="sm"
                variant="outline"
                data-testid="extent.play"
                onClick={() => {
                  useSessionStore
                    .getState()
                    .setProcessed(result.samples.slice(), original.sampleRateHz, "extent");
                }}
              >
                {t("extent.play")}
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded border border-surface p-3 text-sm">
        <h3 className="text-sm font-semibold">{t("extent.observe.title")}</h3>
        <ul className="list-disc ps-5 text-xs text-muted">
          <li>{t("extent.observe.truncate")}</li>
          <li>{t("extent.observe.zeroPad")}</li>
          <li>{t("extent.observe.tradeoff")}</li>
          <li>{t("extent.observe.scale")}</li>
          <li>{t("extent.observe.periodic")}</li>
        </ul>
        <p className="text-xs text-muted">{t("extent.observe.scaleNote")}</p>
        <p className="text-xs text-muted">{t("extent.observe.units")}</p>
      </div>

      <TheoryPanel titleKey={TOOL_THEORY.extent.titleKey} sections={TOOL_THEORY.extent.sections} />
    </section>
  );
}
