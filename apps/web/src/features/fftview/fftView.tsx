/**
 * Fourier view (F08, Wave-2 Plan 04 Task 1): one windowed frame of the
 * selection (or the whole source when nothing is selected) through the
 * `fftSelection` op, drawn as uPlot magnitude and phase charts.
 *
 * - R23: the store owns the worker call; this view never runs DSP itself.
 * - `deriveWithSourceSlice` transfers only `[start, start + FFT_MAX_LENGTH)`,
 *   so the op's 65 536-sample analysis cap also caps what crosses threads.
 * - The phase chart masks bins below the amplitude threshold (nulls), because
 *   phase of a near-zero bin is numerical noise, not information.
 * - Plots are `dir="ltr"` (AGENTS §6); labels and controls follow the locale.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import uPlot from "uplot";
import { ToolHeader } from "../../components/ToolHeader";
import "uplot/dist/uPlot.min.css";

import { Button } from "../../components/ui/button";
import { formatDb, formatHz, formatS } from "../../lib/format";
import {
  FFT_MAX_LENGTH,
  type FftSelectionParams,
  type FftSelectionResult,
  type WindowProfilesResult,
} from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import { TheoryPanel } from "../theory/TheoryPanel";
import { TOOL_THEORY } from "../theory/theoryContent";
import { BenchmarkPanel } from "./benchmarkPanel";
import { ButterflyPanel } from "./butterflyPanel";
import {
  FFT_PHASE_MASK_MAX_DB,
  FFT_PHASE_MASK_MIN_DB,
  FFT_WINDOW_FAMILIES,
  FFT_WINDOW_LENGTHS,
  type FftViewSettings,
  fftSettingsFromSearch,
  fftSettingsToSearch,
  phaseMaskBins,
} from "./fftState";

const PLOT_HEIGHT_PX = 220;
const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const MAGNITUDE_COLOR = "#38bdf8";
const PHASE_COLOR = "#f59e0b";

type Spectrum = {
  readonly meta: FftSelectionResult["meta"];
  readonly frequenciesHz: Float64Array;
  readonly magnitude: Float64Array;
  readonly phase: Float64Array;
};

const WINDOW_COLORS = ["#94a3b8", "#38bdf8", "#f59e0b", "#a78bfa", "#34d399"] as const;

type WindowProfiles = {
  readonly meta: WindowProfilesResult["meta"];
  readonly rows: Float64Array;
};

function useWindowProfiles(sampleRateHz: number, windowLengthSamples: number) {
  const [profiles, setProfiles] = useState<WindowProfiles | null>(null);
  useEffect(() => {
    if (sampleRateHz <= 0) {
      setProfiles(null);
      return;
    }
    const ticket = useSessionStore
      .getState()
      .derive("windowProfiles", { sampleRateHz, windowLengthSamples });
    if (ticket === null) {
      setProfiles(null);
      return;
    }
    ticket.outcome.then(
      (outcome) => {
        if ("cancelled" in outcome || outcome.payload === undefined) {
          return;
        }
        const payload = outcome.payload;
        setProfiles({
          meta: outcome.meta,
          rows: new Float64Array(payload.buffer, payload.byteOffset, payload.byteLength / 8),
        });
      },
      () => {
        setProfiles(null);
      },
    );
    return () => {
      useSessionStore.getState().cancel(ticket.key);
    };
  }, [sampleRateHz, windowLengthSamples]);
  return profiles;
}

function WindowProfilesChart({
  profiles,
  ariaLabel,
  xLabel,
  yLabel,
  familyLabels,
}: {
  readonly profiles: WindowProfiles;
  readonly ariaLabel: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly familyLabels: readonly string[];
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
    if (host === null) {
      return;
    }
    const { meta, rows } = profiles;
    const frequencies = new Float64Array(meta.binCount);
    for (let bin = 0; bin < meta.binCount; bin += 1) {
      frequencies[bin] = (bin * meta.sampleRateHz) / meta.fftLengthSamples;
    }
    const series = meta.families.map((_, familyIndex) => ({
      label: familyLabels[familyIndex] ?? String(familyIndex),
      stroke: WINDOW_COLORS[familyIndex % WINDOW_COLORS.length],
      width: 1,
      points: { show: false as const },
    }));
    const data: uPlot.AlignedData = [
      frequencies,
      ...meta.families.map((_, familyIndex) =>
        rows.subarray(familyIndex * meta.binCount, (familyIndex + 1) * meta.binCount),
      ),
    ];
    const options: uPlot.Options = {
      width: widthPx,
      height: PLOT_HEIGHT_PX,
      padding: [8, 12, 8, 8],
      legend: { show: true },
      scales: { x: { time: false } },
      axes: [
        {
          label: xLabel,
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.18)" },
          ticks: { stroke: "rgba(148,163,184,0.35)" },
          font: "10px ui-monospace, monospace",
          values: (_self, splits) => splits.map((value) => formatHz(value)),
        },
        {
          label: yLabel,
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.18)" },
          ticks: { stroke: "rgba(148,163,184,0.35)" },
          font: "10px ui-monospace, monospace",
          size: 56,
          values: (_self, splits) => splits.map((value) => `${value.toFixed(0)} dB`),
        },
      ],
      series: [{}, ...series],
    };
    const plot = new uPlot(options, data, host);
    return () => {
      plot.destroy();
    };
  }, [profiles, widthPx, xLabel, yLabel, familyLabels]);

  return (
    <div
      ref={hostRef}
      dir="ltr"
      role="img"
      aria-label={ariaLabel}
      data-testid="fftview.chart.windows"
    />
  );
}

type ChartProps = {
  readonly data: uPlot.AlignedData;
  readonly ariaLabel: string;
  readonly testId: string;
  readonly yLabel: string;
  readonly yFormatter: (value: number) => string;
  readonly stroke: string;
};

function SpectrumChart({ data, ariaLabel, testId, yLabel, yFormatter, stroke }: ChartProps) {
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
    if (host === null) {
      return;
    }
    const options: uPlot.Options = {
      width: widthPx,
      height: PLOT_HEIGHT_PX,
      padding: [8, 12, 8, 8],
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      scales: { x: { time: false } },
      axes: [
        {
          label: yLabel,
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.18)" },
          ticks: { stroke: "rgba(148,163,184,0.35)" },
          font: "10px ui-monospace, monospace",
          values: (_self, splits) => splits.map((value) => formatHz(value)),
        },
        {
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.18)" },
          ticks: { stroke: "rgba(148,163,184,0.35)" },
          font: "10px ui-monospace, monospace",
          size: 56,
          values: (_self, splits) => splits.map((value) => yFormatter(value)),
        },
      ],
      series: [{}, { label: yLabel, stroke, width: 1, points: { show: false } }],
    };
    const plot = new uPlot(options, data, host);
    return () => {
      plot.destroy();
    };
  }, [data, widthPx, yLabel, yFormatter, stroke]);

  return (
    <div className="min-w-0">
      <div ref={hostRef} dir="ltr" role="img" aria-label={ariaLabel} data-testid={testId} />
    </div>
  );
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

function useFftSpectrum(
  original: ReturnType<typeof useSessionStore.getState>["original"],
  settings: FftViewSettings,
  selectionStartSample: number,
  selectionEndSample: number,
): { spectrum: Spectrum | null; error: boolean } {
  const [spectrum, setSpectrum] = useState<Spectrum | null>(null);
  const [error, setError] = useState(false);
  const generationRef = useRef(0);

  const sampleCount = original?.samples.length ?? 0;
  const startSample = Math.min(Math.max(0, selectionStartSample), sampleCount);
  const endSample = Math.min(Math.max(startSample, selectionEndSample), sampleCount);
  const analysisStartSample = endSample > startSample ? startSample : 0;
  const analysisEndSample =
    endSample > startSample
      ? Math.min(endSample, startSample + FFT_MAX_LENGTH)
      : Math.min(sampleCount, FFT_MAX_LENGTH);

  const params = useMemo<FftSelectionParams>(
    () => ({
      sampleRateHz: original?.sampleRateHz ?? 0,
      // The selection range (not the capped analysis range) is pinned in the
      // cache key; the op reports `capped` from it. The transferred slice is
      // only the analysed prefix.
      startSample,
      endSample: endSample > startSample ? endSample : sampleCount,
      windowFamily: settings.windowFamily,
      windowLengthSamples: settings.windowLengthSamples,
      magnitudeMode: settings.magnitudeMode,
      phaseMode: settings.phaseMode,
    }),
    [
      original,
      startSample,
      endSample,
      sampleCount,
      settings.windowFamily,
      settings.windowLengthSamples,
      settings.magnitudeMode,
      settings.phaseMode,
    ],
  );

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setError(false);
    if (original === null || analysisEndSample <= analysisStartSample) {
      setSpectrum(null);
      return;
    }
    const ticket = useSessionStore
      .getState()
      .deriveWithSourceSlice("fftSelection", params, analysisStartSample, analysisEndSample);
    ticket.outcome.then(
      (outcome) => {
        if (generationRef.current !== generation || "cancelled" in outcome) {
          return;
        }
        const payload = outcome.payload;
        if (payload === undefined) {
          setError(true);
          return;
        }
        const values = new Float64Array(payload.buffer, payload.byteOffset, payload.byteLength / 8);
        const binCount = outcome.meta.binCount;
        setSpectrum({
          meta: outcome.meta,
          frequenciesHz: values.subarray(0, binCount),
          magnitude: values.subarray(binCount, binCount * 2),
          phase: values.subarray(binCount * 2, binCount * 3),
        });
      },
      () => {
        if (generationRef.current === generation) {
          setError(true);
        }
      },
    );
    return () => {
      useSessionStore.getState().cancel(ticket.key);
    };
  }, [original, params, analysisStartSample, analysisEndSample]);

  return { spectrum, error };
}

export function FftView() {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useMemo(
    () => fftSettingsFromSearch(`?${searchParams.toString()}`),
    [searchParams],
  );

  function updateSettings(patch: Partial<FftViewSettings>): void {
    const next = { ...settings, ...patch };
    const params = new URLSearchParams(searchParams);
    const encoded = fftSettingsToSearch(next);
    for (const [key, value] of new URLSearchParams(encoded)) {
      params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  }

  const { spectrum, error } = useFftSpectrum(
    original,
    settings,
    selection.startSample,
    selection.endSample,
  );
  const profiles = useWindowProfiles(original?.sampleRateHz ?? 0, settings.windowLengthSamples);

  const windowLabels: Record<FftSelectionParams["windowFamily"], string> = {
    rect: t("spectrogram.window.rect"),
    hann: t("spectrogram.window.hann"),
    hamming: t("spectrogram.window.hamming"),
    blackman: t("spectrogram.window.blackman"),
    kaiser: t("spectrogram.window.kaiser"),
  };
  const magnitudeFormatter = useMemo(
    () =>
      settings.magnitudeMode === "db"
        ? (value: number) => `${value.toFixed(0)} dB`
        : (value: number) => value.toPrecision(2),
    [settings.magnitudeMode],
  );
  const phaseFormatter = useMemo(() => (value: number) => `${value.toFixed(2)} rad`, []);

  const chartData = useMemo<{
    magnitude: uPlot.AlignedData;
    phase: uPlot.AlignedData;
  } | null>(() => {
    if (spectrum === null) {
      return null;
    }
    const frequencies = Array.from(spectrum.frequenciesHz);
    const magnitude = Array.from(spectrum.magnitude);
    return {
      magnitude: [frequencies, magnitude],
      phase: [
        frequencies,
        phaseMaskBins(
          spectrum.magnitude,
          spectrum.phase,
          settings.magnitudeMode,
          settings.phaseMaskDb,
        ),
      ],
    };
  }, [spectrum, settings.phaseMaskDb, settings.magnitudeMode]);

  const selectionDurationS =
    original === null
      ? 0
      : (spectrum?.meta.analysisLengthSamples ?? 0) / Math.max(1, original.sampleRateHz);

  return (
    <section className="flex flex-col gap-4">
      <ToolHeader titleKey="tool.fftview.title" descriptionKey="tool.fftview.description" />
      {original === null ? (
        <UploadEmptyState />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("fftview.controls.windowFamily")}</span>
              <select
                value={settings.windowFamily}
                data-testid="fftview.control.windowFamily"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if ((FFT_WINDOW_FAMILIES as readonly string[]).includes(value)) {
                    updateSettings({ windowFamily: value as FftViewSettings["windowFamily"] });
                  }
                }}
                className={`rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`}
              >
                {FFT_WINDOW_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {windowLabels[family]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("fftview.controls.windowLength")}</span>
              <select
                value={settings.windowLengthSamples}
                data-testid="fftview.control.windowLength"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if ((FFT_WINDOW_LENGTHS as readonly number[]).includes(value)) {
                    updateSettings({ windowLengthSamples: value });
                  }
                }}
                className={`rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`}
              >
                {FFT_WINDOW_LENGTHS.map((length) => (
                  <option key={length} value={length}>
                    {length}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="flex flex-col gap-1 border-0 p-0 text-xs">
              <legend className="font-medium">{t("fftview.controls.magnitude")}</legend>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={settings.magnitudeMode === "db" ? "default" : "outline"}
                  aria-pressed={settings.magnitudeMode === "db"}
                  data-testid="fftview.magnitude.db"
                  onClick={() => updateSettings({ magnitudeMode: "db" })}
                >
                  {t("fftview.magnitude.db")}
                </Button>
                <Button
                  size="sm"
                  variant={settings.magnitudeMode === "linear" ? "default" : "outline"}
                  aria-pressed={settings.magnitudeMode === "linear"}
                  data-testid="fftview.magnitude.linear"
                  onClick={() => updateSettings({ magnitudeMode: "linear" })}
                >
                  {t("fftview.magnitude.linear")}
                </Button>
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-1 border-0 p-0 text-xs">
              <legend className="font-medium">{t("fftview.controls.phase")}</legend>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={settings.phaseMode === "wrapped" ? "default" : "outline"}
                  aria-pressed={settings.phaseMode === "wrapped"}
                  data-testid="fftview.phase.wrapped"
                  onClick={() => updateSettings({ phaseMode: "wrapped" })}
                >
                  {t("fftview.phase.wrapped")}
                </Button>
                <Button
                  size="sm"
                  variant={settings.phaseMode === "unwrapped" ? "default" : "outline"}
                  aria-pressed={settings.phaseMode === "unwrapped"}
                  data-testid="fftview.phase.unwrapped"
                  onClick={() => updateSettings({ phaseMode: "unwrapped" })}
                >
                  {t("fftview.phase.unwrapped")}
                </Button>
              </div>
            </fieldset>

            <label className="flex flex-col gap-1 text-xs sm:col-span-2 lg:col-span-4">
              <span className="flex items-center justify-between gap-2 font-medium">
                <span>{t("fftview.controls.phaseMask")}</span>
                <span
                  dir="ltr"
                  data-testid="fftview.control.phaseMask.value"
                  className="tabular-nums"
                >
                  {formatDb(settings.phaseMaskDb)}
                </span>
              </span>
              <input
                type="range"
                min={FFT_PHASE_MASK_MIN_DB}
                max={FFT_PHASE_MASK_MAX_DB}
                step={5}
                value={settings.phaseMaskDb}
                data-testid="fftview.control.phaseMask"
                onChange={(event) =>
                  updateSettings({ phaseMaskDb: Number(event.currentTarget.value) })
                }
                className={`w-full ${CONTROL_FOCUS_CLASSES}`}
              />
            </label>
          </div>

          {error ? (
            <p role="alert" data-testid="fftview.error" className="text-sm text-muted">
              {t("fftview.error")}
            </p>
          ) : spectrum === null || chartData === null ? (
            <p role="alert" data-testid="fftview.empty" className="text-sm text-muted">
              {t("fftview.empty")}
            </p>
          ) : (
            <>
              <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <MetaItem
                  label={t("fftview.meta.sampleRate")}
                  value={formatHz(spectrum.meta.sampleRateHz)}
                  testId="fftview.meta.sampleRate"
                />
                <MetaItem
                  label={t("fftview.meta.binWidth")}
                  value={formatHz(spectrum.meta.sampleRateHz / spectrum.meta.fftLengthSamples)}
                  testId="fftview.meta.binWidth"
                />
                <MetaItem
                  label={t("fftview.meta.fftLength")}
                  value={String(spectrum.meta.fftLengthSamples)}
                  testId="fftview.meta.fftLength"
                />
                <MetaItem
                  label={t("fftview.meta.analysisLength")}
                  value={formatS(selectionDurationS)}
                  testId="fftview.meta.analysisLength"
                />
                <MetaItem
                  label={t("fftview.meta.bins")}
                  value={String(spectrum.meta.binCount)}
                  testId="fftview.meta.bins"
                />
              </dl>

              {spectrum.meta.capped ? (
                <p
                  role="status"
                  data-testid="fftview.capNotice"
                  className="rounded bg-surface px-2 py-1 text-xs text-muted"
                >
                  {t("fftview.capNotice", { samples: FFT_MAX_LENGTH })}
                </p>
              ) : null}

              <SpectrumChart
                data={chartData.magnitude}
                ariaLabel={t("fftview.chart.magnitudeLabel")}
                testId="fftview.chart.magnitude"
                yLabel={t("fftview.axis.magnitude")}
                yFormatter={magnitudeFormatter}
                stroke={MAGNITUDE_COLOR}
              />
              <p className="text-xs text-muted">{t("fftview.axis.frequency")}</p>
              <SpectrumChart
                data={chartData.phase}
                ariaLabel={t("fftview.chart.phaseLabel")}
                testId="fftview.chart.phase"
                yLabel={t("fftview.axis.phase")}
                yFormatter={phaseFormatter}
                stroke={PHASE_COLOR}
              />
              <p className="text-xs text-muted">
                {t("fftview.axis.phaseNote", { threshold: formatDb(settings.phaseMaskDb) })}
              </p>

              <h3 className="mt-2 text-sm font-semibold">{t("fftview.windowCompare.title")}</h3>
              {profiles === null ? (
                <p data-testid="fftview.windows.loading" className="text-sm text-muted">
                  {t("fftview.windowCompare.loading")}
                </p>
              ) : (
                <>
                  <WindowProfilesChart
                    profiles={profiles}
                    ariaLabel={t("fftview.windowCompare.label")}
                    xLabel={t("fftview.axis.frequency")}
                    yLabel={t("fftview.axis.level")}
                    familyLabels={profiles.meta.families.map((family) => windowLabels[family])}
                  />
                  <table className="w-full max-w-lg text-xs tabular-nums">
                    <thead>
                      <tr className="text-muted">
                        <th className="text-start font-medium">
                          {t("fftview.windowCompare.family")}
                        </th>
                        <th className="text-start font-medium">
                          {t("fftview.windowCompare.mainLobe")}
                        </th>
                        <th className="text-start font-medium">
                          {t("fftview.windowCompare.sideLobe")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {profiles.meta.families.map((family, familyIndex) => (
                        <tr key={family} data-testid={`fftview.windowCompare.${family}`}>
                          <td>{windowLabels[family]}</td>
                          <td dir="ltr">
                            {formatHz(profiles.meta.mainLobeWidthsHz[familyIndex] ?? 0)}
                          </td>
                          <td dir="ltr">
                            {formatDb(profiles.meta.sideLobeLevelsDb[familyIndex] ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <ButterflyPanel startSample={selection.startSample} />
              <BenchmarkPanel startSample={selection.startSample} endSample={selection.endSample} />
            </>
          )}
        </>
      )}

      <TheoryPanel
        titleKey={TOOL_THEORY.fftview.titleKey}
        sections={TOOL_THEORY.fftview.sections}
      />
    </section>
  );
}
