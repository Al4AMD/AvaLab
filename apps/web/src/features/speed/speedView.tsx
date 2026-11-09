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
import { ToolHeader } from "../../components/ToolHeader";

import { Button } from "../../components/ui/button";
import { formatS } from "../../lib/format";
import { combineLaneOutputs, type LaneResults } from "../../lib/laneCombine";
import { laneParamsLinked } from "../../lib/laneParams";
import { writeLastUsed } from "../../lib/lastUsed";
import type { SpectrogramTilesParams } from "../../session/ops";
import { DspRpcError } from "../../session/rpc";
import { useSessionStore } from "../../session/store";
import { ChannelPicker } from "../channels/ChannelPicker";
import { useChannelMode } from "../channels/useChannelMode";
import { UploadEmptyState } from "../input/upload";
import {
  paintSpectrogramChunk,
  type SpectrogramColormapName,
} from "../spectrogram/paintSpectrogram";
import { spectrogramGeometry } from "../spectrogram/workerJob";
import { TheoryPanel } from "../theory/TheoryPanel";
import { TOOL_THEORY } from "../theory/theoryContent";
import {
  defaultSpeedRange,
  loadSpeedSettings,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PRESETS,
  SPEED_SEMITONE_MAX,
  SPEED_SEMITONE_MIN,
  SPEED_STORAGE_KEY,
  type SpeedLaneSettings,
  type SpeedMode,
  type SpeedSettings,
  speedLanes,
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
  const settings = useMemo(() => {
    const source = {
      sampleCount: original?.samples.length ?? 0,
      sampleRateHz: original?.sampleRateHz ?? 1,
    };
    if (searchParams.toString() === "") {
      return loadSpeedSettings(source, selection);
    }
    return speedSettingsFromSearch(`?${searchParams.toString()}`, source, selection);
  }, [searchParams, original, selection]);

  useEffect(() => {
    writeLastUsed(SPEED_STORAGE_KEY, speedSettingsToSearch(settings));
  }, [settings]);
  const channel = useChannelMode(original, "both");
  const resolved = useMemo(() => speedLanes(settings), [settings]);
  const effectiveLane: "left" | "right" =
    channel.mode === "both" ? settings.editLane : channel.mode === "right" ? "right" : "left";
  const laneSettings = resolved[effectiveLane];
  const lanePair = useMemo(
    () => ({
      primary: { reverse: settings.reverse },
      ...(settings.right === undefined ? {} : { right: settings.right }),
    }),
    [settings.reverse, settings.right],
  );
  const linked = laneParamsLinked(lanePair);

  const [laneResults, setLaneResults] = useState<
    Partial<Record<"left" | "right", SpeedResultView>>
  >({});
  const [spectrogram, setSpectrogram] = useState<SpectrogramView | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<SpeedErrorCode | null>(null);
  const generationRef = useRef(0);
  const result = laneResults[effectiveLane] ?? null;

  function writeSettings(next: SpeedSettings): void {
    const params = new URLSearchParams(searchParams);
    for (const key of Array.from(params.keys())) {
      if (key === "el" || (key.startsWith("rr") && key.length > 2)) {
        params.delete(key);
      }
    }
    for (const [key, value] of new URLSearchParams(speedSettingsToSearch(next))) {
      params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  }

  function updateSettings(patch: Partial<SpeedSettings>): void {
    writeSettings({ ...settings, ...patch });
  }

  function updateLaneSettings(patch: Partial<SpeedLaneSettings>): void {
    const next = { ...laneSettings, ...patch };
    writeSettings(
      effectiveLane === "right" ? { ...settings, right: next } : { ...settings, ...next },
    );
  }

  function selectEditLane(lane: "left" | "right"): void {
    writeSettings({ ...settings, editLane: lane });
  }

  function setLinked(nextLinked: boolean): void {
    writeSettings({
      ...settings,
      ...(nextLinked ? { right: undefined } : { right: resolved.left }),
      editLane: settings.editLane,
    });
  }

  useEffect(() => {
    if (original === null) {
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setErrorCode(null);
    setBusy(true);
    let tickets: { readonly key: string }[] = [];
    const timer = window.setTimeout(() => {
      const startSample = Math.max(0, Math.min(settings.startSample, original.samples.length));
      const endSample = Math.max(
        startSample,
        Math.min(settings.endSample, original.samples.length),
      );
      if (endSample <= startSample) {
        setBusy(false);
        setErrorCode("failed");
        return;
      }
      const store = useSessionStore.getState();
      const targets = channel.mode === "both" ? (["left", "right"] as const) : [effectiveLane];
      const pending = targets.map((lane) => {
        const params = {
          sampleRateHz: original.sampleRateHz,
          startSample,
          endSample,
          mode: settings.mode,
          speedFactor: settings.speedFactor,
          semitones: settings.semitones,
          reverse: resolved[lane].reverse,
        };
        if (channel.mode === "mono") {
          const slice = original.samples.slice(startSample, endSample);
          return {
            lane,
            ticket: store.deriveStandalone("speedTransform", params, {
              buffer: slice.buffer,
              byteOffset: 0,
              byteLength: slice.byteLength,
            }),
          };
        }
        return {
          lane,
          ticket: store.deriveWithSourceSliceLane(
            "speedTransform",
            params,
            startSample,
            endSample,
            lane === "right" ? 1 : 0,
          ),
        };
      });
      tickets = pending.map((entry) => entry.ticket);
      void Promise.all(
        pending.map(async (entry) => ({ lane: entry.lane, outcome: await entry.ticket.outcome })),
      ).then(
        (settled) => {
          if (generationRef.current !== generation) {
            return;
          }
          const next: Partial<Record<"left" | "right", SpeedResultView>> = {};
          for (const { lane, outcome } of settled) {
            if ("cancelled" in outcome) {
              return;
            }
            const payload = outcome.payload;
            if (payload === undefined) {
              setBusy(false);
              setErrorCode("failed");
              return;
            }
            next[lane] = {
              samples: new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
              sampleRateHz: outcome.meta.sampleRateHz,
              outputSampleCount: outcome.meta.outputSampleCount,
              actualSpeedFactor: outcome.meta.actualSpeedFactor,
              elapsedMs: outcome.meta.elapsedMs,
            };
          }
          setLaneResults(next);
          const selected = next[effectiveLane];
          if (selected === undefined) {
            setBusy(false);
            setErrorCode("failed");
            return;
          }
          const outputs: LaneResults =
            channel.mode === "both"
              ? { left: next.left?.samples, right: next.right?.samples }
              : channel.mode === "right"
                ? { right: selected.samples }
                : { left: selected.samples };
          const playback =
            channel.mode === "mono" ? selected.samples : combineLaneOutputs(channel.mode, outputs);
          if (playback === null) {
            setBusy(false);
            setErrorCode("failed");
            return;
          }
          const installed = store.setProcessed(playback, selected.sampleRateHz, "speed");
          if (!installed.ok) {
            setBusy(false);
            setErrorCode(installed.code === "tooLong" ? "tooLong" : "failed");
            return;
          }
          const request = spectrogramRequest(selected.samples, selected.sampleRateHz);
          if (request.frameCount === 0) {
            setSpectrogram(null);
            setBusy(false);
            return;
          }
          const copy = selected.samples.slice();
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
                nyquistHz: selected.sampleRateHz / 2,
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
      for (const ticket of tickets) {
        useSessionStore.getState().cancel(ticket.key);
      }
    };
  }, [original, settings, channel.mode, effectiveLane, resolved]);

  const modeLabels: Record<SpeedMode, string> = {
    resample: t("speed.mode.resample"),
    timeStretch: t("speed.mode.timeStretch"),
  };
  const laneLabels = {
    left: t("speed.lane.left"),
    right: t("speed.lane.right"),
  } as const;

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <ToolHeader titleKey="tool.speed.title" descriptionKey="tool.speed.description" />
        <UploadEmptyState />
      </section>
    );
  }

  const previewRange = defaultSpeedRange(selection, original.samples.length, original.sampleRateHz);
  const durationS =
    result === null ? 0 : result.outputSampleCount / Math.max(1, result.sampleRateHz);

  return (
    <section className="flex flex-col gap-4">
      <ToolHeader titleKey="tool.speed.title" descriptionKey="tool.speed.description" />

      <div className="flex flex-col gap-3 rounded border border-surface p-3">
        <ChannelPicker mode={channel.mode} modes={channel.modes} onChange={channel.setMode} />
        {channel.mode === "both" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {(["left", "right"] as const).map((lane) => (
                <Button
                  key={lane}
                  size="sm"
                  variant={effectiveLane === lane ? "default" : "outline"}
                  aria-pressed={effectiveLane === lane}
                  data-testid={`speed.lane.${lane}`}
                  onClick={() => {
                    selectEditLane(lane);
                  }}
                >
                  {laneLabels[lane]}
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                data-testid="speed.linkRight"
                checked={linked}
                onChange={(event) => {
                  setLinked(event.currentTarget.checked);
                }}
              />
              <span>{t("speed.lane.link")}</span>
            </label>
            <p data-testid="speed.lane.status" className="text-xs text-muted">
              {linked ? t("speed.lane.linked") : t("speed.lane.separate")}
            </p>
          </>
        ) : null}
        <p data-testid="speed.lane.gridNote" className="text-xs text-muted">
          {t("speed.lane.gridNote")}
        </p>
      </div>

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

        <div className="flex flex-col gap-1 self-end text-xs">
          <span className="font-medium">{t("speed.controls.direction")}</span>
          <fieldset
            aria-label={t("speed.controls.direction")}
            className="m-0 flex items-center gap-1 border-0 p-0"
          >
            <Button
              size="sm"
              variant={laneSettings.reverse ? "outline" : "default"}
              aria-pressed={!laneSettings.reverse}
              data-testid="speed.control.direction.forward"
              onClick={() => {
                updateLaneSettings({ reverse: false });
              }}
            >
              {t("speed.controls.forward")}
            </Button>
            <Button
              size="sm"
              variant={laneSettings.reverse ? "default" : "outline"}
              aria-pressed={laneSettings.reverse}
              data-testid="speed.control.direction.reverse"
              onClick={() => {
                updateLaneSettings({ reverse: true });
              }}
            >
              {t("speed.controls.reverse")}
            </Button>
          </fieldset>
        </div>
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
            {channel.mode === "both" && (
              <table data-testid="speed.result.lanes" className="w-full text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="text-start font-medium">{t("speed.lane.label")}</th>
                    <th className="text-start font-medium">{t("speed.result.duration")}</th>
                    <th className="text-start font-medium">{t("speed.result.actualSpeed")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(["left", "right"] as const).map((lane) => {
                    const laneResult = laneResults[lane];
                    return (
                      <tr key={lane} data-testid={`speed.result.lane.${lane}`}>
                        <td>{laneLabels[lane]}</td>
                        <td dir="ltr" className="tabular-nums">
                          {laneResult === undefined
                            ? "—"
                            : formatS(laneResult.outputSampleCount / laneResult.sampleRateHz)}
                        </td>
                        <td dir="ltr" className="tabular-nums">
                          {laneResult === undefined
                            ? "—"
                            : `×${laneResult.actualSpeedFactor.toFixed(2)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
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

      <TheoryPanel titleKey={TOOL_THEORY.speed.titleKey} sections={TOOL_THEORY.speed.sections} />
    </section>
  );
}
