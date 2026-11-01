/**
 * Spectrogram tool (F02, Wave-2 Plan 03 Task 3): the chunk job hook feeds
 * frame-major dB chunks from the worker; this view owns controls, axes,
 * legend and the progressive canvas paint.
 *
 * - R23: all DSP goes through `useSpectrogramJob` → store → worker; the
 *   component never calls the rpc and never runs DSP on the main thread.
 * - The op analyses ONE bounded frame chunk per call (`deriveWithSourceSlice`
 *   transfers only that slice), so the canvas paints chunk by chunk.
 * - Axis mode and the dB floor are display mappings only; toggling them
 *   repaints the cached chunks and never recomputes the STFT.
 * - Honesty: the decimation banner appears whenever the cell/frame budget
 *   forced a wider analysis hop; the legend prints both dB ends, so colour is
 *   never the only channel. Plots are forced `dir="ltr"` (AGENTS §6) while
 *   control labels stay locale/RTL aware.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import { formatDb, formatHz, formatS } from "../../lib/format";
import type { SpectrogramTilesParams } from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import { ColormapLegend } from "./colormapLegend";
import {
  frequencyToY,
  paintSpectrogramChunk,
  type SpectrogramAxisMode,
  type SpectrogramColormapName,
  spectrogramFrequencyTicks,
} from "./paintSpectrogram";
import { type SpectrogramGeometry, useSpectrogramJob } from "./workerJob";

const PLOT_HEIGHT_PX = 320;
const DEFAULT_WINDOW_LENGTH = 1024;
const DEFAULT_DB_FLOOR_DB = -80;
const DB_FLOOR_MIN_DB = -120;
const DB_FLOOR_MAX_DB = -20;
const DB_MAX_DB = 0;
const WINDOW_LENGTHS = [256, 512, 1024, 2048, 4096, 8192] as const;
const WINDOW_FAMILIES = ["rect", "hann", "hamming", "blackman", "kaiser"] as const;
const HOP_FRACTIONS = [0.25, 0.5, 0.75] as const;
const COLORMAPS = ["viridis", "gray", "viridisCB"] as const;
const MAX_DEVICE_PIXEL_RATIO = 2;
const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function isWindowFamily(value: string): value is SpectrogramTilesParams["windowFamily"] {
  return (WINDOW_FAMILIES as readonly string[]).includes(value);
}

function isHopFraction(value: number): value is SpectrogramTilesParams["hopFraction"] {
  return value === 0.25 || value === 0.5 || value === 0.75;
}

function isColormap(value: string): value is SpectrogramColormapName {
  return (COLORMAPS as readonly string[]).includes(value);
}

function MetaItem({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <dt>{label}</dt>
      <dd dir="ltr" data-testid={testId} className="tabular-nums">
        {value}
      </dd>
    </div>
  );
}

type SpectrogramCanvasProps = {
  readonly geometry: SpectrogramGeometry;
  readonly chunks: ReadonlyMap<
    number,
    { readonly rowStart: number; readonly frameCount: number; readonly rows: Float32Array }
  >;
  readonly paintVersion: number;
  readonly axisMode: SpectrogramAxisMode;
  readonly colormap: SpectrogramColormapName;
  readonly dbMinDb: number;
  readonly ariaLabel: string;
};

function SpectrogramCanvas({
  geometry,
  chunks,
  paintVersion,
  axisMode,
  colormap,
  dbMinDb,
  ariaLabel,
}: SpectrogramCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `paintVersion` is the repaint trigger for the mutated chunk map.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO);
    const widthDevicePx = Math.max(1, Math.round(widthPx * dpr));
    const heightDevicePx = Math.max(1, Math.round(PLOT_HEIGHT_PX * dpr));
    if (canvas.width !== widthDevicePx) {
      canvas.width = widthDevicePx;
    }
    if (canvas.height !== heightDevicePx) {
      canvas.height = heightDevicePx;
    }
    ctx.clearRect(0, 0, widthDevicePx, heightDevicePx);
    if (geometry.totalFrames === 0) {
      return;
    }
    const ordered = [...chunks.values()].sort((a, b) => a.rowStart - b.rowStart);
    for (const chunk of ordered) {
      // A params change re-derives chunks; never paint a chunk from the old
      // analysis (its bin count would not match the new geometry).
      if (chunk.rows.length !== chunk.frameCount * geometry.binCount) {
        continue;
      }
      paintSpectrogramChunk(ctx, chunk.rows, {
        widthPx,
        heightPx: PLOT_HEIGHT_PX,
        dpr,
        binCount: geometry.binCount,
        frameStart: chunk.rowStart,
        frameCount: chunk.frameCount,
        frameStride: 1,
        totalFrames: geometry.totalFrames,
        dbMinDb,
        dbMaxDb: DB_MAX_DB,
        axisMode,
        nyquistHz: geometry.sampleRateHz / 2,
        colormap,
      });
    }
  }, [geometry, chunks, paintVersion, widthPx, axisMode, colormap, dbMinDb]);

  return (
    <div ref={hostRef} className="w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        data-testid="spectrogram.canvas"
        style={{ height: `${PLOT_HEIGHT_PX}px` }}
        className="block w-full rounded bg-bg ring-1 ring-surface"
      />
    </div>
  );
}

export function SpectrogramView() {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);

  const [windowFamily, setWindowFamily] = useState<SpectrogramTilesParams["windowFamily"]>("hann");
  const [windowLengthSamples, setWindowLengthSamples] = useState(DEFAULT_WINDOW_LENGTH);
  const [hopFraction, setHopFraction] = useState<SpectrogramTilesParams["hopFraction"]>(0.5);
  const [dbFloorDb, setDbFloorDb] = useState(DEFAULT_DB_FLOOR_DB);
  const [axisMode, setAxisMode] = useState<SpectrogramAxisMode>("linear");
  const [colormap, setColormap] = useState<SpectrogramColormapName>("viridis");

  const analysis = useMemo(
    () => ({ windowFamily, windowLengthSamples, hopFraction }),
    [windowFamily, windowLengthSamples, hopFraction],
  );
  const job = useSpectrogramJob(original, analysis);
  const geometry = job.geometry;
  const sampleRateHz = original?.sampleRateHz ?? 0;
  const durationS = geometry === null ? 0 : geometry.sampleCount / sampleRateHz;
  const axisGeometry = {
    rowCount: geometry?.binCount ?? 2,
    heightPx: PLOT_HEIGHT_PX,
    axisMode,
    nyquistHz: sampleRateHz / 2,
  };
  const frequencyTicks =
    geometry === null || sampleRateHz <= 0 ? [] : spectrogramFrequencyTicks(axisGeometry);
  const timeTicks = [0, 0.25, 0.5, 0.75, 1];
  const windowLabels: Record<SpectrogramTilesParams["windowFamily"], string> = {
    rect: t("spectrogram.window.rect"),
    hann: t("spectrogram.window.hann"),
    hamming: t("spectrogram.window.hamming"),
    blackman: t("spectrogram.window.blackman"),
    kaiser: t("spectrogram.window.kaiser"),
  };
  const colormapLabels: Record<SpectrogramColormapName, string> = {
    viridis: t("spectrogram.colormap.viridis"),
    gray: t("spectrogram.colormap.gray"),
    viridisCB: t("spectrogram.colormap.viridisCB"),
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">{t("tool.spectrogram.title")}</h2>
      {original === null ? (
        <UploadEmptyState />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("spectrogram.controls.windowFamily")}</span>
              <select
                value={windowFamily}
                data-testid="spectrogram.control.windowFamily"
                onChange={(event) => {
                  if (isWindowFamily(event.currentTarget.value)) {
                    setWindowFamily(event.currentTarget.value);
                  }
                }}
                className={`rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`}
              >
                {WINDOW_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {windowLabels[family]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("spectrogram.controls.windowLength")}</span>
              <select
                value={windowLengthSamples}
                data-testid="spectrogram.control.windowLength"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if ((WINDOW_LENGTHS as readonly number[]).includes(value)) {
                    setWindowLengthSamples(value);
                  }
                }}
                className={`rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`}
              >
                {WINDOW_LENGTHS.map((length) => (
                  <option key={length} value={length}>
                    {length}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("spectrogram.controls.hop")}</span>
              <select
                value={hopFraction}
                data-testid="spectrogram.control.hop"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (isHopFraction(value)) {
                    setHopFraction(value);
                  }
                }}
                className={`rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`}
              >
                {HOP_FRACTIONS.map((fraction) => (
                  <option key={fraction} value={fraction}>
                    {t("spectrogram.hop.option", { percent: fraction * 100 })}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("spectrogram.controls.colormap")}</span>
              <select
                value={colormap}
                data-testid="spectrogram.control.colormap"
                onChange={(event) => {
                  if (isColormap(event.currentTarget.value)) {
                    setColormap(event.currentTarget.value);
                  }
                }}
                className={`rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`}
              >
                {COLORMAPS.map((name) => (
                  <option key={name} value={name}>
                    {colormapLabels[name]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="flex items-center justify-between gap-2 font-medium">
                <span>{t("spectrogram.controls.dbFloor")}</span>
                <span
                  dir="ltr"
                  data-testid="spectrogram.control.dbFloor.value"
                  className="tabular-nums"
                >
                  {formatDb(dbFloorDb)}
                </span>
              </span>
              <input
                type="range"
                min={DB_FLOOR_MIN_DB}
                max={DB_FLOOR_MAX_DB}
                step={5}
                value={dbFloorDb}
                data-testid="spectrogram.control.dbFloor"
                onChange={(event) => setDbFloorDb(Number(event.currentTarget.value))}
                className={`w-full ${CONTROL_FOCUS_CLASSES}`}
              />
            </label>

            <fieldset className="flex flex-col gap-1 border-0 p-0 text-xs sm:col-span-2">
              <legend className="font-medium">{t("spectrogram.controls.axis")}</legend>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={axisMode === "linear" ? "default" : "outline"}
                  aria-pressed={axisMode === "linear"}
                  data-testid="spectrogram.axis.linear"
                  onClick={() => setAxisMode("linear")}
                >
                  {t("spectrogram.axis.linear")}
                </Button>
                <Button
                  size="sm"
                  variant={axisMode === "log" ? "default" : "outline"}
                  aria-pressed={axisMode === "log"}
                  data-testid="spectrogram.axis.log"
                  onClick={() => setAxisMode("log")}
                >
                  {t("spectrogram.axis.log")}
                </Button>
              </div>
            </fieldset>
          </div>

          {job.error ? (
            <p role="alert" data-testid="spectrogram.error" className="text-sm text-muted">
              {t("spectrogram.error")}
            </p>
          ) : geometry === null || geometry.totalFrames === 0 ? (
            <p role="alert" data-testid="spectrogram.empty" className="text-sm text-muted">
              {t("spectrogram.empty")}
            </p>
          ) : (
            <>
              <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <MetaItem
                  label={t("spectrogram.meta.sampleRate")}
                  value={formatHz(sampleRateHz)}
                  testId="spectrogram.meta.sampleRate"
                />
                <MetaItem
                  label={t("spectrogram.meta.duration")}
                  value={formatS(durationS)}
                  testId="spectrogram.meta.duration"
                />
                <MetaItem
                  label={t("spectrogram.meta.window")}
                  value={formatS(geometry.binCount === 0 ? 0 : windowLengthSamples / sampleRateHz)}
                  testId="spectrogram.meta.window"
                />
                <MetaItem
                  label={t("spectrogram.meta.hop")}
                  value={formatS(geometry.hopLengthSamples / sampleRateHz)}
                  testId="spectrogram.meta.hop"
                />
                <MetaItem
                  label={t("spectrogram.meta.columns")}
                  value={String(geometry.totalFrames)}
                  testId="spectrogram.meta.columns"
                />
                <MetaItem
                  label={t("spectrogram.meta.decimation")}
                  value={`×${geometry.frameStride}`}
                  testId="spectrogram.meta.decimation"
                />
              </dl>

              {geometry.frameStride > 1 ? (
                <p
                  role="status"
                  data-testid="spectrogram.decimationNotice"
                  className="rounded bg-surface px-2 py-1 text-xs text-muted"
                >
                  {t("spectrogram.decimationNotice", { factor: geometry.frameStride })}
                </p>
              ) : null}

              {job.completedChunks === 0 ? (
                <p data-testid="spectrogram.loading" className="text-sm text-muted">
                  {t("spectrogram.loading")}
                </p>
              ) : null}

              <section className="flex flex-col gap-2" dir="ltr">
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span>{t("spectrogram.axis.frequency")}</span>
                  <ColormapLegend
                    label={t("spectrogram.legend.label")}
                    colormap={colormap}
                    dbMinDb={dbFloorDb}
                    dbMaxDb={DB_MAX_DB}
                  />
                </div>

                <div className="flex gap-2">
                  <div className="relative w-16 shrink-0" style={{ height: `${PLOT_HEIGHT_PX}px` }}>
                    {frequencyTicks.map((tickHz) => (
                      <span
                        key={tickHz}
                        className="absolute end-0 -translate-y-1/2 text-[10px] text-muted tabular-nums"
                        style={{ top: `${frequencyToY(tickHz, axisGeometry)}px` }}
                      >
                        {formatHz(tickHz)}
                      </span>
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <SpectrogramCanvas
                      geometry={geometry}
                      chunks={job.chunks}
                      paintVersion={job.paintVersion}
                      axisMode={axisMode}
                      colormap={colormap}
                      dbMinDb={dbFloorDb}
                      ariaLabel={t("spectrogram.canvas.label")}
                    />
                  </div>
                </div>

                <div className="flex justify-between ps-[4.5rem] text-[10px] text-muted tabular-nums">
                  {timeTicks.map((fraction) => (
                    <span key={fraction}>{formatS(fraction * durationS)}</span>
                  ))}
                </div>
                <p className="text-xs text-muted">{t("spectrogram.axis.time")}</p>
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
