/**
 * F06 speed and direction lab (Wave-3 Plan 01 Task 4).
 *
 * The view is a thin parameter panel: every transform runs in the worker
 * through `deriveStandalone("speedTransform", …)`, and the settled buffer is
 * installed into the store's processed playback lane (A/B dock). The result
 * spectrogram is a second worker call over a COPY of the processed buffer —
 * the transfer neuters only that copy.
 *
 * Preview scope follows AGENTS §9: the current sub-selection, else the first
 * 30 s; "apply to whole file" writes the full source range into the URL.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import { Button } from "../../components/ui/button";
import { formatS } from "../../lib/format";
import type { SpectrogramTilesParams } from "../../session/ops";
import { DspRpcError } from "../../session/rpc";
import { useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import {
  paintSpectrogramChunk,
  type SpectrogramColormapName,
} from "../spectrogram/paintSpectrogram";
import { spectrogramGeometry } from "../spectrogram/workerJob";
import {
  defaultSpeedRange,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PRESETS,
  SPEED_SEMITONE_MAX,
  SPEED_SEMITONE_MIN,
  type SpeedMode,
  type SpeedSettings,
  speedSettingsFromSearch,
  speedSettingsToSearch,
} from "./speedState";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;
const SPECTROGRAM_WINDOW_LENGTH = 1024;
const SPECTROGRAM_HOP_FRACTION = 0.5;
const SPECTROGRAM_MAX_FRAMES = 256;
const SPECTROGRAM_DB_FLOOR_DB = -120;
const SPECTROGRAM_DB_MIN_DB = -100;
const SPECTROGRAM_DB_MAX_DB = 0;
const SPECTROGRAM_HEIGHT_PX = 120;
const WAVEFORM_HEIGHT_PX = 72;
const SPECTROGRAM_COLORMAP: SpectrogramColormapName = "viridis";
const MAX_DEVICE_PIXEL_RATIO = 2;

type SpeedResultView = {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
  readonly outputSampleCount: number;
  readonly actualSpeedFactor: number;
  readonly elapsedMs: number;
};

type SpectrogramView = {
  readonly rows: Float32Array;
  readonly binCount: number;
  readonly frameCount: number;
  readonly nyquistHz: number;
};

type SpeedErrorCode = "tooLong" | "failed";

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

function prepareCanvas(
  canvas: HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
): CanvasRenderingContext2D | null {
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO);
  const widthDevicePx = Math.max(1, Math.round(widthPx * dpr));
  const heightDevicePx = Math.max(1, Math.round(heightPx * dpr));
  if (canvas.width !== widthDevicePx) {
    canvas.width = widthDevicePx;
  }
  if (canvas.height !== heightDevicePx) {
    canvas.height = heightDevicePx;
  }
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.clearRect(0, 0, widthDevicePx, heightDevicePx);
  }
  return ctx;
}

function SpeedWaveformCanvas({
  samples,
  ariaLabel,
}: {
  readonly samples: Float32Array;
  readonly ariaLabel: string;
}) {
  const { hostRef, widthPx } = useCanvasWidth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = prepareCanvas(canvas, widthPx, WAVEFORM_HEIGHT_PX);
    if (ctx === null || samples.length === 0) {
      return;
    }
    const widthDevicePx = canvas.width;
    const heightDevicePx = canvas.height;
    const step = Math.max(1, Math.floor(samples.length / widthDevicePx));
    ctx.strokeStyle = "#8bd3c7";
    ctx.lineWidth = Math.max(1, Math.round(window.devicePixelRatio || 1));
    ctx.beginPath();
    for (let x = 0; x < widthDevicePx; x += 1) {
      const sample = samples[Math.min(samples.length - 1, x * step)] ?? 0;
      const y = heightDevicePx / 2 - sample * (heightDevicePx / 2) * 0.9;
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }, [samples, widthPx]);
  return (
    <div ref={hostRef} dir="ltr">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        data-testid="speed.result.waveform"
        style={{ height: `${WAVEFORM_HEIGHT_PX}px` }}
        className="block w-full rounded bg-bg ring-1 ring-surface"
      />
    </div>
  );
}

function SpeedSpectrogramCanvas({
  spectrogram,
  ariaLabel,
}: {
  readonly spectrogram: SpectrogramView;
  readonly ariaLabel: string;
}) {
  const { hostRef, widthPx } = useCanvasWidth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = prepareCanvas(canvas, widthPx, SPECTROGRAM_HEIGHT_PX);
    if (ctx === null || spectrogram.frameCount === 0) {
      return;
    }
    paintSpectrogramChunk(ctx, spectrogram.rows, {
      widthPx,
      heightPx: SPECTROGRAM_HEIGHT_PX,
      dpr: Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO),
      binCount: spectrogram.binCount,
      frameStart: 0,
      frameCount: spectrogram.frameCount,
      frameStride: 1,
      totalFrames: spectrogram.frameCount,
      dbMinDb: SPECTROGRAM_DB_MIN_DB,
      dbMaxDb: SPECTROGRAM_DB_MAX_DB,
      axisMode: "linear",
      nyquistHz: spectrogram.nyquistHz,
      colormap: SPECTROGRAM_COLORMAP,
    });
  }, [spectrogram, widthPx]);
  return (
    <div ref={hostRef} dir="ltr">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        data-testid="speed.result.spectrogram"
        style={{ height: `${SPECTROGRAM_HEIGHT_PX}px` }}
        className="block w-full rounded bg-bg ring-1 ring-surface"
      />
    </div>
  );
}

function spectrogramRequest(
  samples: Float32Array,
  sampleRateHz: number,
): {
  readonly params: SpectrogramTilesParams;
  readonly binCount: number;
  readonly frameCount: number;
} {
  const geometry = spectrogramGeometry(samples.length, sampleRateHz, {
    windowFamily: "hann",
    windowLengthSamples: SPECTROGRAM_WINDOW_LENGTH,
    hopFraction: SPECTROGRAM_HOP_FRACTION,
  });
  const frameStride = Math.max(
    geometry.frameStride,
    Math.ceil(geometry.totalFrames / SPECTROGRAM_MAX_FRAMES),
  );
  const frameCount = geometry.totalFrames === 0 ? 0 : Math.ceil(geometry.totalFrames / frameStride);
  return {
    params: {
      sampleRateHz,
      windowFamily: "hann",
      windowLengthSamples: SPECTROGRAM_WINDOW_LENGTH,
      hopFraction: SPECTROGRAM_HOP_FRACTION,
      dbFloorDb: SPECTROGRAM_DB_FLOOR_DB,
      rowStart: 0,
      rowCount: frameCount,
      frameStride,
      sourceStartSample: 0,
    },
    binCount: geometry.binCount,
    frameCount,
  };
}

export function SpeedView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useMemo(
    () =>
      speedSettingsFromSearch(
        `?${searchParams.toString()}`,
        {
          sampleCount: original?.samples.length ?? 0,
          sampleRateHz: original?.sampleRateHz ?? 1,
        },
        selection,
      ),
    [searchParams, original, selection],
  );
  const [result, setResult] = useState<SpeedResultView | null>(null);
  const [spectrogram, setSpectrogram] = useState<SpectrogramView | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<SpeedErrorCode | null>(null);
  const generationRef = useRef(0);

  function updateSettings(patch: Partial<SpeedSettings>): void {
    const next = { ...settings, ...patch };
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of new URLSearchParams(speedSettingsToSearch(next))) {
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
      const store = useSessionStore.getState();
      const ticket = store.deriveStandalone(
        "speedTransform",
        {
          sampleRateHz: original.sampleRateHz,
          startSample,
          endSample,
          mode: settings.mode,
          speedFactor: settings.speedFactor,
          semitones: settings.semitones,
          reverse: settings.reverse,
        },
        { buffer: slice.buffer, byteOffset: 0, byteLength: slice.byteLength },
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
          const samples = new Float32Array(
            payload.buffer,
            payload.byteOffset,
            payload.byteLength / 4,
          );
          const installed = store.setProcessed(samples, outcome.meta.sampleRateHz, "speed");
          if (!installed.ok) {
            setBusy(false);
            setErrorCode(installed.code === "tooLong" ? "tooLong" : "failed");
            return;
          }
          setResult({
            samples,
            sampleRateHz: outcome.meta.sampleRateHz,
            outputSampleCount: outcome.meta.outputSampleCount,
            actualSpeedFactor: outcome.meta.actualSpeedFactor,
            elapsedMs: outcome.meta.elapsedMs,
          });
          const request = spectrogramRequest(samples, outcome.meta.sampleRateHz);
          if (request.frameCount === 0) {
            setSpectrogram(null);
            setBusy(false);
            return;
          }
          const copy = samples.slice();
          const spectrogramTicket = store.deriveStandalone("spectrogramTiles", request.params, {
            buffer: copy.buffer,
            byteOffset: 0,
            byteLength: copy.byteLength,
          });
          spectrogramTicket.outcome.then(
            (spectrogramOutcome) => {
              if (generationRef.current !== generation || "cancelled" in spectrogramOutcome) {
                return;
              }
              const rowsPayload = spectrogramOutcome.payload;
              if (rowsPayload === undefined) {
                setSpectrogram(null);
                setBusy(false);
                return;
              }
              setSpectrogram({
                rows: new Float32Array(
                  rowsPayload.buffer,
                  rowsPayload.byteOffset,
                  rowsPayload.byteLength / 4,
                ),
                binCount: request.binCount,
                frameCount: request.frameCount,
                nyquistHz: outcome.meta.sampleRateHz / 2,
              });
              setBusy(false);
            },
            () => {
              if (generationRef.current === generation) {
                setSpectrogram(null);
                setBusy(false);
              }
            },
          );
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

  const modeLabels: Record<SpeedMode, string> = {
    resample: t("speed.mode.resample"),
    timeStretch: t("speed.mode.timeStretch"),
  };

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{t("tool.speed.title")}</h2>
        <UploadEmptyState />
      </section>
    );
  }

  const previewRange = defaultSpeedRange(selection, original.samples.length, original.sampleRateHz);
  const durationS =
    result === null ? 0 : result.outputSampleCount / Math.max(1, result.sampleRateHz);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">{t("tool.speed.title")}</h2>

      <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("speed.controls.mode")}</span>
          <select
            value={settings.mode}
            data-testid="speed.control.mode"
            onChange={(event) => {
              const value = event.currentTarget.value;
              updateSettings({ mode: value === "timeStretch" ? "timeStretch" : "resample" });
            }}
            className={INPUT_CLASSES}
          >
            {(["resample", "timeStretch"] as const).map((mode) => (
              <option key={mode} value={mode}>
                {modeLabels[mode]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("speed.controls.customSpeed")}</span>
          <input
            type="number"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={0.05}
            value={settings.speedFactor}
            data-testid="speed.control.customSpeed"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value) && value >= SPEED_MIN && value <= SPEED_MAX) {
                updateSettings({ speedFactor: value });
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("speed.controls.semitones")}</span>
          <input
            type="number"
            min={SPEED_SEMITONE_MIN}
            max={SPEED_SEMITONE_MAX}
            step={1}
            value={settings.semitones}
            disabled={settings.mode === "resample"}
            data-testid="speed.control.semitones"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (
                Number.isFinite(value) &&
                value >= SPEED_SEMITONE_MIN &&
                value <= SPEED_SEMITONE_MAX
              ) {
                updateSettings({ semitones: value });
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>

        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={settings.reverse}
            data-testid="speed.control.reverse"
            onChange={(event) => {
              updateSettings({ reverse: event.currentTarget.checked });
            }}
            className={CONTROL_FOCUS_CLASSES}
          />
          <span>{t("speed.controls.reverse")}</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SPEED_PRESETS.map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant={settings.speedFactor === preset ? "default" : "outline"}
            aria-pressed={settings.speedFactor === preset}
            data-testid={`speed.preset.${preset}`}
            onClick={() => {
              updateSettings({ speedFactor: preset });
            }}
          >
            {t("speed.preset", { factor: preset })}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span dir="ltr">
          {t("speed.range.pattern", {
            start: formatS(settings.startSample / original.sampleRateHz),
            end: formatS(settings.endSample / original.sampleRateHz),
          })}
        </span>
        <Button
          size="sm"
          variant="outline"
          data-testid="speed.apply.preview"
          onClick={() => {
            updateSettings(previewRange);
          }}
        >
          {t("speed.apply.preview")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="speed.apply.whole"
          onClick={() => {
            updateSettings({ startSample: 0, endSample: original.samples.length });
          }}
        >
          {t("speed.apply.whole")}
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded border border-surface p-3">
        <h3 className="text-sm font-semibold">{t("speed.result.title")}</h3>
        {errorCode !== null ? (
          <p data-testid="speed.error" role="alert" className="text-sm text-danger">
            {errorCode === "tooLong" ? t("speed.error.tooLong") : t("speed.error.failed")}
          </p>
        ) : busy ? (
          <p data-testid="speed.status" className="text-sm text-muted">
            {t("speed.status.computing")}
          </p>
        ) : result !== null ? (
          <>
            <dl className="flex flex-wrap gap-4 text-xs text-muted">
              <div className="flex items-center gap-1">
                <dt>{t("speed.result.duration")}</dt>
                <dd dir="ltr" data-testid="speed.result.duration" className="tabular-nums">
                  {formatS(durationS)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("speed.result.actualSpeed")}</dt>
                <dd dir="ltr" data-testid="speed.result.actualSpeed" className="tabular-nums">
                  {`×${result.actualSpeedFactor.toFixed(2)}`}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("speed.result.elapsed")}</dt>
                <dd dir="ltr" className="tabular-nums">
                  {`${result.elapsedMs.toFixed(1)} ms`}
                </dd>
              </div>
            </dl>
            <SpeedWaveformCanvas
              samples={result.samples}
              ariaLabel={t("speed.result.waveformAria")}
            />
            {spectrogram !== null && (
              <SpeedSpectrogramCanvas
                spectrogram={spectrogram}
                ariaLabel={t("speed.result.spectrogramAria")}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-muted">{t("speed.status.idle")}</p>
        )}
      </div>

      <aside className="rounded border border-surface p-3 text-sm">
        <h3 className="mb-2 font-semibold">{t("speed.observe.title")}</h3>
        <ul className="list-disc space-y-1 ps-5 text-muted">
          <li>{t("speed.observe.resample")}</li>
          <li>{t("speed.observe.timeStretch")}</li>
          <li>{t("speed.observe.reverse")}</li>
        </ul>
      </aside>
    </section>
  );
}
