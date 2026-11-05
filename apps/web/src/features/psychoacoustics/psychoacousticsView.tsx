/**
 * F13 psychoacoustics lab. Static Bark/ATH/spreading curves render without
 * audio; once a source exists, the worker analyses the loudest MDCT frame in
 * the current selection (else the first 30 s) and the view overlays the
 * measured band levels with the masking threshold. The view holds no DSP.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

import { formatDb, formatHz } from "../../lib/format";
import type {
  PsychoacousticAnalysisResult,
  PsychoacousticBand,
  PsychoacousticCurvesResult,
} from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { TheoryPanel } from "../theory/TheoryPanel";
import {
  clampPsychoacousticsReferenceSpl,
  PSYCHOACOUSTICS_REFERENCE_MAX,
  PSYCHOACOUSTICS_REFERENCE_MIN,
  type PsychoacousticsFrequencyScale,
  type PsychoacousticsSettings,
  psychoacousticsAnalysisRange,
  psychoacousticsSettingsFromSearch,
  psychoacousticsSettingsToSearch,
} from "./psychoacousticsState";
import { PSYCHOACOUSTICS_THEORY_SECTIONS, PSYCHOACOUSTICS_THEORY_TITLE_KEY } from "./theory";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;
const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const CHART_PADDING_LEFT = 56;
const CHART_PADDING_RIGHT = 14;
const CHART_PADDING_TOP = 14;
const CHART_PADDING_BOTTOM = 34;
const FALLBACK_SAMPLE_RATE_HZ = 48_000;

type CurvesMeta = PsychoacousticCurvesResult["meta"];
type AnalysisMeta = PsychoacousticAnalysisResult["meta"];
type AnalysisStatus = "idle" | "pending" | "ready" | "error";

function frequencyX(
  frequencyHz: number,
  scale: PsychoacousticsFrequencyScale,
  nyquistHz: number,
): number {
  const plotWidth = CHART_WIDTH - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
  if (scale === "log") {
    const low = Math.log10(20);
    const high = Math.log10(Math.max(40, nyquistHz));
    const value = Math.log10(Math.max(20, Math.min(frequencyHz, nyquistHz)));
    return CHART_PADDING_LEFT + ((value - low) / (high - low)) * plotWidth;
  }
  const ratio = Math.min(1, Math.max(0, frequencyHz / Math.max(1, nyquistHz)));
  return CHART_PADDING_LEFT + ratio * plotWidth;
}

function plotY(value: number, min: number, max: number): number {
  const range = Math.max(1e-9, max - min);
  const plotHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;
  const ratio = (value - min) / range;
  return CHART_PADDING_TOP + (1 - Math.min(1, Math.max(0, ratio))) * plotHeight;
}

function finiteRange(values: readonly number[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }
  return { min, max: min === max ? min + 1 : max };
}

function ChartFrame({
  label,
  testId,
  children,
}: {
  readonly label: string;
  readonly testId: string;
  readonly children: React.ReactNode;
}) {
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid={testId}
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="w-full rounded bg-bg ring-1 ring-surface"
    >
      <rect width={CHART_WIDTH} height={CHART_HEIGHT} fill="#0b1220" />
      {children}
    </svg>
  );
}

function AxisLabels({
  nyquistHz,
  minDb,
  maxDb,
}: {
  readonly nyquistHz: number;
  readonly minDb: number;
  readonly maxDb: number;
}) {
  return (
    <g fill="#94a3b8" fontSize="11" direction="ltr">
      <text x={CHART_PADDING_LEFT} y={CHART_HEIGHT - 10}>
        20 Hz
      </text>
      <text x={CHART_WIDTH - CHART_PADDING_RIGHT} y={CHART_HEIGHT - 10} textAnchor="end">
        {formatHz(nyquistHz)}
      </text>
      <text x={8} y={CHART_PADDING_TOP + 8}>
        {formatDb(maxDb)}
      </text>
      <text x={8} y={CHART_HEIGHT - CHART_PADDING_BOTTOM}>
        {formatDb(minDb)}
      </text>
    </g>
  );
}

export function PsychoacousticsAthChart({
  curves,
  frequencyScale,
  showThreshold,
}: {
  readonly curves: CurvesMeta | null;
  readonly frequencyScale: PsychoacousticsFrequencyScale;
  readonly showThreshold: boolean;
}) {
  const { t } = useTranslation();
  const nyquistHz = curves?.bandEdgesHz[curves.bandEdgesHz.length - 1] ?? 24_000;
  const range = finiteRange(curves === null ? [] : Array.from(curves.athDb));
  const points =
    curves === null
      ? []
      : Array.from(curves.athDb, (value, index) => ({
          x: frequencyX(curves.bandCentersHz[index] ?? 0, frequencyScale, nyquistHz),
          y: plotY(value, range.min, range.max),
        }));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  return (
    <ChartFrame label={t("psychoacoustics.chart.ath")} testId="psychoacoustics.chart.ath">
      <AxisLabels nyquistHz={nyquistHz} minDb={range.min} maxDb={range.max} />
      {showThreshold && path !== "" ? (
        <path
          data-testid="psychoacoustics.chart.athLine"
          d={path}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
        />
      ) : null}
    </ChartFrame>
  );
}

export function PsychoacousticsSpreadingChart({ curves }: { readonly curves: CurvesMeta | null }) {
  const { t } = useTranslation();
  const bandCount = curves === null ? 0 : Math.round(Math.sqrt(curves.spreadingDb.length));
  const range = finiteRange(curves === null ? [] : Array.from(curves.spreadingDb));
  const cellWidth =
    (CHART_WIDTH - CHART_PADDING_LEFT - CHART_PADDING_RIGHT) / Math.max(1, bandCount);
  const cellHeight =
    (CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM) / Math.max(1, bandCount);
  return (
    <ChartFrame
      label={t("psychoacoustics.chart.spreading")}
      testId="psychoacoustics.chart.spreading"
    >
      {curves !== null
        ? Array.from({ length: bandCount * bandCount }, (_, index) => {
            const row = Math.floor(index / bandCount);
            const column = index % bandCount;
            const value = curves.spreadingDb[index] ?? 0;
            const ratio = (value - range.min) / Math.max(1e-9, range.max - range.min);
            return (
              <rect
                key={`${row}-${column}`}
                x={CHART_PADDING_LEFT + column * cellWidth}
                y={CHART_PADDING_TOP + row * cellHeight}
                width={Math.max(0, cellWidth - 0.5)}
                height={Math.max(0, cellHeight - 0.5)}
                fill={`hsl(190 70% ${85 - 55 * ratio}%)`}
              />
            );
          })
        : null}
    </ChartFrame>
  );
}

function bandCenterHz(band: PsychoacousticBand): number {
  return Math.sqrt(Math.max(0, band.lowHz) * Math.max(0, band.highHz));
}

function pathFromBands(
  bands: readonly PsychoacousticBand[],
  read: (band: PsychoacousticBand) => number,
  scale: PsychoacousticsFrequencyScale,
  nyquistHz: number,
  minDb: number,
  maxDb: number,
): string {
  let path = "";
  let drawing = false;
  for (const band of bands) {
    const value = read(band);
    if (!Number.isFinite(value)) {
      drawing = false;
      continue;
    }
    const x = frequencyX(bandCenterHz(band), scale, nyquistHz);
    const y = plotY(value, minDb, maxDb);
    path += `${drawing ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `;
    drawing = true;
  }
  return path.trim();
}

export function PsychoacousticsBandChart({
  bands,
  frequencyScale,
  showThreshold,
}: {
  readonly bands: readonly PsychoacousticBand[];
  readonly frequencyScale: PsychoacousticsFrequencyScale;
  readonly showThreshold: boolean;
}) {
  const { t } = useTranslation();
  const nyquistHz = bands[bands.length - 1]?.highHz ?? 24_000;
  const values = bands.flatMap((band) =>
    showThreshold ? [band.levelDb, band.thresholdDb] : [band.levelDb],
  );
  const range = finiteRange(values);
  const levelPath = pathFromBands(
    bands,
    (band) => band.levelDb,
    frequencyScale,
    nyquistHz,
    range.min,
    range.max,
  );
  const thresholdPath = pathFromBands(
    bands,
    (band) => band.thresholdDb,
    frequencyScale,
    nyquistHz,
    range.min,
    range.max,
  );
  return (
    <ChartFrame label={t("psychoacoustics.chart.bands")} testId="psychoacoustics.chart.bands">
      <AxisLabels nyquistHz={nyquistHz} minDb={range.min} maxDb={range.max} />
      {levelPath !== "" ? (
        <path
          data-testid="psychoacoustics.chart.level"
          d={levelPath}
          fill="none"
          stroke="#8bd3c7"
          strokeWidth={2}
        />
      ) : null}
      {showThreshold && thresholdPath !== "" ? (
        <path
          data-testid="psychoacoustics.chart.threshold"
          d={thresholdPath}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      ) : null}
    </ChartFrame>
  );
}

export function PsychoacousticsControls({
  settings,
  onChange,
}: {
  readonly settings: PsychoacousticsSettings;
  readonly onChange: (patch: Partial<PsychoacousticsSettings>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t("psychoacoustics.controls.referenceSpl")}</span>
        <input
          type="number"
          min={PSYCHOACOUSTICS_REFERENCE_MIN}
          max={PSYCHOACOUSTICS_REFERENCE_MAX}
          step={1}
          value={settings.referenceSplDb}
          onChange={(event) =>
            onChange({
              referenceSplDb: clampPsychoacousticsReferenceSpl(Number(event.target.value)),
            })
          }
          data-testid="psychoacoustics.control.referenceSpl"
          dir="ltr"
          className={`${INPUT_CLASSES} w-24 tabular-nums`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t("psychoacoustics.controls.scale")}</span>
        <select
          value={settings.frequencyScale}
          onChange={(event) =>
            onChange({
              frequencyScale: event.target.value === "linear" ? "linear" : "log",
            })
          }
          data-testid="psychoacoustics.control.scale"
          className={INPUT_CLASSES}
        >
          <option value="log">{t("psychoacoustics.controls.scaleLog")}</option>
          <option value="linear">{t("psychoacoustics.controls.scaleLinear")}</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.showThreshold}
          onChange={(event) => onChange({ showThreshold: event.target.checked })}
          data-testid="psychoacoustics.control.threshold"
          className="size-4 accent-accent"
        />
        <span>{t("psychoacoustics.controls.showThreshold")}</span>
      </label>
    </div>
  );
}

export function PsychoacousticsAnalysisPanel({
  bands,
  frameCount,
  status,
  settings,
}: {
  readonly bands: readonly PsychoacousticBand[] | null;
  readonly frameCount: number;
  readonly status: AnalysisStatus;
  readonly settings: PsychoacousticsSettings;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t("psychoacoustics.analysis.title")}</h3>
      {status === "pending" ? (
        <p data-testid="psychoacoustics.status.pending" className="text-sm text-muted">
          {t("psychoacoustics.status.pending")}
        </p>
      ) : null}
      {status === "error" ? (
        <p data-testid="psychoacoustics.status.error" className="text-sm text-danger">
          {t("psychoacoustics.status.error")}
        </p>
      ) : null}
      {bands !== null ? (
        <>
          <p
            dir="ltr"
            data-testid="psychoacoustics.analysis.frameCount"
            className="text-xs text-muted"
          >
            {t("psychoacoustics.analysis.frameCount", { frames: frameCount })}
          </p>
          <PsychoacousticsBandChart
            bands={bands}
            frequencyScale={settings.frequencyScale}
            showThreshold={settings.showThreshold}
          />
        </>
      ) : (
        <div data-testid="psychoacoustics.chart.bandsShell">
          <PsychoacousticsBandChart
            bands={[]}
            frequencyScale={settings.frequencyScale}
            showThreshold={settings.showThreshold}
          />
        </div>
      )}
    </section>
  );
}

export function PsychoacousticsView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useMemo(
    () => psychoacousticsSettingsFromSearch(`?${searchParams.toString()}`),
    [searchParams],
  );
  const [curves, setCurves] = useState<CurvesMeta | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisMeta | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const sampleRateHz = original?.sampleRateHz ?? FALLBACK_SAMPLE_RATE_HZ;
  const sampleCount = original?.samples.length ?? 0;
  const range = psychoacousticsAnalysisRange(selection, sampleCount, sampleRateHz);

  useEffect(() => {
    let cancelled = false;
    const ticket = useSessionStore.getState().deriveStandalone("psychoacousticCurves", {
      sampleRateHz,
      referenceSplDb: settings.referenceSplDb,
    });
    ticket.outcome.then(
      (outcome) => {
        if (!cancelled && !("cancelled" in outcome)) {
          setCurves(outcome.meta);
        }
      },
      () => {
        if (!cancelled) {
          setCurves(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sampleRateHz, settings.referenceSplDb]);

  useEffect(() => {
    if (original === null || range.endSample <= range.startSample) {
      setAnalysis(null);
      setAnalysisStatus("idle");
      return;
    }
    let cancelled = false;
    setAnalysisStatus("pending");
    const copy = original.samples.slice(range.startSample, range.endSample);
    const ticket = useSessionStore.getState().deriveStandalone(
      "psychoacousticAnalysis",
      {
        sampleRateHz: original.sampleRateHz,
        startSample: range.startSample,
        endSample: range.endSample,
        referenceSplDb: settings.referenceSplDb,
      },
      { buffer: copy.buffer, byteOffset: 0, byteLength: copy.byteLength },
    );
    ticket.outcome.then(
      (outcome) => {
        if (cancelled || "cancelled" in outcome) {
          return;
        }
        setAnalysis(outcome.meta);
        setAnalysisStatus("ready");
      },
      () => {
        if (!cancelled) {
          setAnalysis(null);
          setAnalysisStatus("error");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [original, range.startSample, range.endSample, settings.referenceSplDb]);

  function updateSettings(patch: Partial<PsychoacousticsSettings>): void {
    const next = { ...settings, ...patch };
    const params = new URLSearchParams(searchParams);
    for (const [key, entry] of new URLSearchParams(psychoacousticsSettingsToSearch(next))) {
      params.set(key, entry);
    }
    setSearchParams(params, { replace: true });
  }

  const codecLabHref = `/tools/codec-lab?c=mdct&pm=1&rspl=${settings.referenceSplDb}`;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{t("tool.psychoacoustics.title")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">{t("psychoacoustics.description")}</p>
        </div>
        <Link
          to={codecLabHref}
          data-testid="psychoacoustics.link.codecLab"
          className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-bg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {t("psychoacoustics.codecLink")}
        </Link>
      </header>

      <PsychoacousticsControls settings={settings} onChange={updateSettings} />

      {original === null ? (
        <p data-testid="psychoacoustics.noSource" className="text-sm text-muted">
          {t("psychoacoustics.noSource")}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("psychoacoustics.analysis.athTitle")}</h3>
          <PsychoacousticsAthChart
            curves={curves}
            frequencyScale={settings.frequencyScale}
            showThreshold={settings.showThreshold}
          />
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("psychoacoustics.analysis.spreadingTitle")}</h3>
          <PsychoacousticsSpreadingChart curves={curves} />
        </section>
      </div>

      {original !== null ? (
        <PsychoacousticsAnalysisPanel
          bands={analysis?.bands ?? null}
          frameCount={analysis?.frameCount ?? 0}
          status={analysisStatus}
          settings={settings}
        />
      ) : null}

      <TheoryPanel
        titleKey={PSYCHOACOUSTICS_THEORY_TITLE_KEY}
        sections={PSYCHOACOUSTICS_THEORY_SECTIONS}
      />
    </section>
  );
}
