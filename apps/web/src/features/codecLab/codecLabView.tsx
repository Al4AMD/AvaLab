/**
 * F04 browser compression lab (Wave-4 Plan 01 Task 3).
 *
 * Encode is explicit: the user picks a codec and an excerpt, presses Encode,
 * and the store runs `codecLabProcess` on that exact slice (R23). The result
 * persists until the next encode, so changing a setting only raises the
 * translated stale hint. All numbers are Latin/dir="ltr" (AGENTS §6).
 */
import type { TFunction } from "i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import type { HealthResponse } from "../../api/client";
import { api } from "../../api/client";
import { ToolHeader } from "../../components/ToolHeader";
import { Button } from "../../components/ui/button";
import type { ChannelMode } from "../../lib/channel";
import { downloadWav } from "../../lib/download";
import { formatS } from "../../lib/format";
import { combineLaneResults } from "../../lib/laneCombine";
import { writeLastUsed } from "../../lib/lastUsed";
import type {
  CodecLabCodec,
  CodecLabMdctBand,
  CodecLabMeta,
  CodecLabResult,
} from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { ChannelPicker } from "../channels/ChannelPicker";
import { useChannelMode } from "../channels/useChannelMode";
import { UploadEmptyState } from "../input/upload";
import { formatMetric, type QualityMetrics } from "../metrics/metrics";
import { measureQualityMetrics } from "../metrics/qualityMetricsWorker";
import { TheoryPanel } from "../theory/TheoryPanel";
import { TOOL_THEORY } from "../theory/theoryContent";
import {
  availableRealCodecs,
  REAL_CODEC_NAMES,
  RealCodecError,
  type RealCodecName,
  type RealCodecRun,
  runRealCodec,
  runWholeFileCodec,
} from "./backendCodecs";
import { aggregateCodecLanes } from "./codecLabLanes";
import {
  CODEC_LAB_CODECS,
  CODEC_LAB_MDCT_KBPS,
  CODEC_LAB_REAL_BITRATES_KBPS,
  CODEC_LAB_REAL_COMPRESSION_MAX,
  CODEC_LAB_REAL_COMPRESSION_MIN,
  CODEC_LAB_REAL_QUALITY_MAX,
  CODEC_LAB_REAL_QUALITY_MIN,
  CODEC_LAB_REFERENCE_SPL_MAX,
  CODEC_LAB_REFERENCE_SPL_MIN,
  CODEC_LAB_STORAGE_KEY,
  type CodecLabLaneSettings,
  type CodecLabSettings,
  codecLabLanes,
  codecLabRangeFromSelection,
  codecLabSettingsFromSearch,
  codecLabSettingsToSearch,
  isCodecLabStale,
  isRealCodecStale,
  loadCodecLabSettings,
} from "./codecLabState";
import {
  type ComparisonRow,
  comparisonToCsv,
  handwrittenRow,
  publishCodecComparisonRows,
  realRow,
  sortComparisonRows,
} from "./comparison";
import {
  COMPARISON_EXCERPT_SECONDS,
  defaultComparisonRequests,
  runComparison,
} from "./comparisonRunner";
import { RateDistortionChart } from "./rateDistortionChart";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;
const HISTOGRAM_HEIGHT_PX = 96;
const MAX_DEVICE_PIXEL_RATIO = 2;

type LaneCodecResult = {
  readonly id: "mono" | "left" | "right";
  readonly meta: CodecLabMeta;
  readonly samples: Float32Array;
};

type CodecLabViewResult = {
  readonly perLane: readonly LaneCodecResult[];
  readonly playback: readonly Float32Array[];
  readonly settings: CodecLabSettings;
  readonly mode: ChannelMode;
};

type CodecLabStatus = "idle" | "running" | "ready" | "error";
type CodecLabErrorKey = "codecLab.error.failed" | "codecLab.error.playback";

type RealCodecViewResult = {
  readonly run: RealCodecRun;
  readonly settings: CodecLabSettings;
};

/** Playback payload for a real-codec result: both lanes plus the source offset. */
export function realPlayback(
  run: RealCodecRun,
  settings: CodecLabSettings,
): { readonly channels: Float32Array[]; readonly sourceStartSample: number } {
  return {
    channels: run.channels.slice(),
    sourceStartSample: settings.startSample + run.stats.referenceStartSample,
  };
}

type RealCodecStatus = "idle" | "running" | "ready" | "error";

function wholeStageLabel(t: TFunction, progress: number): string {
  if (progress < 0.6) {
    return t("codecLab.real.stage.encode");
  }
  if (progress < 0.75) {
    return t("codecLab.real.stage.decode");
  }
  if (progress < 0.9) {
    return t("codecLab.real.stage.align");
  }
  return t("codecLab.real.stage.store");
}

function realErrorText(t: TFunction, key: string | null): string {
  switch (key) {
    case "codecLab.error.codec_unavailable":
      return t("codecLab.error.codec_unavailable");
    case "codecLab.error.encode_failed":
      return t("codecLab.error.encode_failed");
    case "codecLab.error.not_found":
      return t("codecLab.error.not_found");
    case "codecLab.error.invalid_request":
      return t("codecLab.error.invalid_request");
    case "codecLab.error.internal_error":
      return t("codecLab.error.internal_error");
    case "codecLab.error.file_too_large":
      return t("codecLab.error.file_too_large");
    case "codecLab.error.decode_failed":
      return t("codecLab.error.decode_failed");
    case "codecLab.error.alignment_mismatch":
      return t("codecLab.error.alignment_mismatch");
    case "codecLab.error.backend_unavailable":
      return t("codecLab.error.backend_unavailable");
    case "codecLab.error.job_busy":
      return t("codecLab.error.job_busy");
    case "codecLab.error.job_cancelled":
      return t("codecLab.error.job_cancelled");
    case "codecLab.error.job_not_found":
      return t("codecLab.error.job_not_found");
    case "codecLab.error.unknown":
      return t("codecLab.error.unknown");
    default:
      return t("codecLab.error.failed");
  }
}

function unpackResult(outcome: CodecLabResult): Float32Array | null {
  if (outcome.payload === undefined) {
    return null;
  }
  return new Float32Array(
    outcome.payload.buffer,
    outcome.payload.byteOffset,
    outcome.payload.byteLength / 4,
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return "—";
  }
  if (Math.abs(bytes) < 1024) {
    return `${bytes.toFixed(0)} B`;
  }
  if (Math.abs(bytes) < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "∞";
}

function Histogram({
  histogram,
  ariaLabel,
}: {
  readonly histogram: readonly number[];
  readonly ariaLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO);
    const widthDevicePx = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const heightDevicePx = Math.max(1, Math.round(HISTOGRAM_HEIGHT_PX * dpr));
    canvas.width = widthDevicePx;
    canvas.height = heightDevicePx;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    ctx.clearRect(0, 0, widthDevicePx, heightDevicePx);
    const max = Math.max(1, ...histogram);
    const barWidth = widthDevicePx / Math.max(1, histogram.length);
    ctx.fillStyle = "#8bd3c7";
    for (let index = 0; index < histogram.length; index += 1) {
      const count = histogram[index] ?? 0;
      const height = (count / max) * heightDevicePx;
      if (height > 0) {
        ctx.fillRect(index * barWidth, heightDevicePx - height, Math.max(1, barWidth), height);
      }
    }
  }, [histogram]);
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel}
      data-testid="codecLab.histogram"
      dir="ltr"
      style={{ height: `${HISTOGRAM_HEIGHT_PX}px` }}
      className="block w-full rounded bg-bg ring-1 ring-surface"
    />
  );
}

const BAND_CHART_WIDTH = 240;
const BAND_CHART_HEIGHT = 72;
const BAND_CHART_PADDING = 6;

function bandSeriesPoints(values: readonly number[]): string {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return "";
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x =
        values.length <= 1
          ? BAND_CHART_WIDTH / 2
          : (index / (values.length - 1)) * BAND_CHART_WIDTH;
      const normalized = Number.isFinite(value) ? (value - min) / span : 0;
      const y =
        BAND_CHART_PADDING + (1 - normalized) * (BAND_CHART_HEIGHT - 2 * BAND_CHART_PADDING);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function bandRange(values: readonly number[]): string {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return "—";
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return `${min.toFixed(1)} … ${max.toFixed(1)} dB`;
}

function BandSeries({
  values,
  label,
  colorClass,
  testId,
}: {
  readonly values: readonly number[];
  readonly label: string;
  readonly colorClass: string;
  readonly testId: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${BAND_CHART_WIDTH} ${BAND_CHART_HEIGHT}`}
        className={`w-full rounded bg-bg ring-1 ring-surface ${colorClass}`}
        data-testid={testId}
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          points={bandSeriesPoints(values)}
        />
      </svg>
      <span dir="ltr" className="text-xs tabular-nums text-muted">
        {bandRange(values)}
      </span>
    </div>
  );
}

/** Per-band threshold and SMR for the loudest psychoacoustic MDCT frame. */
export function MdctBandChart({
  bands,
}: {
  readonly bands: readonly CodecLabMdctBand[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <figure className="mt-3 flex flex-col gap-2" data-testid="codecLab.psycho.bandChart">
      <figcaption className="text-xs font-medium">{t("codecLab.mdct.bandChartTitle")}</figcaption>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BandSeries
          values={bands.map((band) => band.thresholdDb)}
          label={t("codecLab.mdct.threshold")}
          colorClass="text-accent"
          testId="codecLab.psycho.thresholdChart"
        />
        <BandSeries
          values={bands.map((band) => band.smrDb)}
          label={t("codecLab.mdct.smr")}
          colorClass="text-danger"
          testId="codecLab.psycho.smrChart"
        />
      </div>
    </figure>
  );
}

export function CodecLabPsychoControls({
  settings,
  onChange,
}: {
  readonly settings: CodecLabLaneSettings;
  readonly onChange: (patch: Partial<CodecLabLaneSettings>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <label className="flex items-center gap-2 self-end text-xs">
        <input
          type="checkbox"
          checked={settings.mdctPsychoacoustic}
          data-testid="codecLab.control.psycho"
          onChange={(event) => {
            onChange({ mdctPsychoacoustic: event.currentTarget.checked });
          }}
          className={CONTROL_FOCUS_CLASSES}
        />
        <span className="font-medium">{t("codecLab.mdct.psycho")}</span>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium">{t("codecLab.mdct.referenceSpl")}</span>
        <input
          type="number"
          min={CODEC_LAB_REFERENCE_SPL_MIN}
          max={CODEC_LAB_REFERENCE_SPL_MAX}
          step={1}
          dir="ltr"
          value={settings.mdctReferenceSplDb}
          data-testid="codecLab.control.referenceSpl"
          onChange={(event) => {
            const raw = Number(event.currentTarget.value);
            if (Number.isFinite(raw)) {
              onChange({
                mdctReferenceSplDb: Math.max(
                  CODEC_LAB_REFERENCE_SPL_MIN,
                  Math.min(CODEC_LAB_REFERENCE_SPL_MAX, Math.round(raw)),
                ),
              });
            }
          }}
          className={INPUT_CLASSES}
        />
      </label>
      <p
        data-testid="codecLab.psycho.mode"
        className="self-end text-xs text-muted sm:col-span-2 lg:col-span-4"
      >
        {settings.mdctPsychoacoustic ? t("codecLab.mdct.psychoOn") : t("codecLab.mdct.legacy")}
      </p>
    </>
  );
}

function StatRow({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-surface/60 py-1">
      <dt>{label}</dt>
      <dd dir="ltr" data-testid={testId} className="tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export function CodecLabView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const backendOnline = useSessionStore((state) => state.backendOnline);
  const [searchParams, setSearchParams] = useSearchParams();
  const channel = useChannelMode(original, "both");
  const settings = useMemo(() => {
    const source = {
      sampleCount: original?.samples.length ?? 0,
      sampleRateHz: original?.sampleRateHz ?? 1,
    };
    if (searchParams.toString() === "") {
      return loadCodecLabSettings(source, selection);
    }
    return codecLabSettingsFromSearch(`?${searchParams.toString()}`, source, selection);
  }, [searchParams, original, selection]);
  const resolvedLanes = useMemo(() => codecLabLanes(settings), [settings]);
  const effectiveLane: "left" | "right" =
    channel.mode === "both" ? settings.editLane : channel.mode === "right" ? "right" : "left";
  const laneSettings = effectiveLane === "right" ? resolvedLanes.right : resolvedLanes.left;
  const linked = settings.right === undefined;

  useEffect(() => {
    writeLastUsed(CODEC_LAB_STORAGE_KEY, codecLabSettingsToSearch(settings));
  }, [settings]);
  const [status, setStatus] = useState<CodecLabStatus>("idle");
  const [result, setResult] = useState<CodecLabViewResult | null>(null);
  const [errorKey, setErrorKey] = useState<CodecLabErrorKey | null>(null);
  const runIdRef = useRef(0);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [realStatus, setRealStatus] = useState<RealCodecStatus>("idle");
  const [realResult, setRealResult] = useState<RealCodecViewResult | null>(null);
  const [realMetrics, setRealMetrics] = useState<QualityMetrics | null>(null);
  const [realErrorKey, setRealErrorKey] = useState<string | null>(null);
  const [realIsWhole, setRealIsWhole] = useState(false);
  const [wholeStatus, setWholeStatus] = useState<"idle" | "running">("idle");
  const [wholeProgress, setWholeProgress] = useState(0);
  const [wholeErrorKey, setWholeErrorKey] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "ok" | "error">("idle");
  const [batchRows, setBatchRows] = useState<ComparisonRow[] | null>(null);
  const [batchStatus, setBatchStatus] = useState<"idle" | "running">("idle");
  const [batchCompleted, setBatchCompleted] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [chartQuality, setChartQuality] = useState<"snrDb" | "psnrDb">("snrDb");
  const batchAbortRef = useRef<AbortController | null>(null);
  const realRunIdRef = useRef(0);
  const realAbortRef = useRef<AbortController | null>(null);
  const wholeRunIdRef = useRef(0);
  const wholeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    runIdRef.current += 1;
    setStatus("idle");
    setResult(null);
    setErrorKey(null);
    realRunIdRef.current += 1;
    realAbortRef.current?.abort();
    setRealStatus("idle");
    setRealResult(null);
    setRealErrorKey(null);
    setRealIsWhole(false);
    wholeRunIdRef.current += 1;
    wholeAbortRef.current?.abort();
    setWholeStatus("idle");
    setWholeProgress(0);
    setWholeErrorKey(null);
    setCopyStatus("idle");
    batchAbortRef.current?.abort();
    batchAbortRef.current = null;
    setBatchStatus("idle");
    setBatchRows(null);
    setBatchCompleted(0);
    setBatchTotal(0);
    if (original === null) {
      return;
    }
  }, [original]);

  useEffect(() => {
    if (!backendOnline) {
      setHealth(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    api
      .GET("/health", { signal: controller.signal })
      .then(({ data, response }) => {
        if (!cancelled && response.ok && data !== undefined) {
          setHealth(data);
        }
      })
      .catch(() => {
        // The offline hint comes from the store flag; a failed probe is silent.
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [backendOnline]);

  useEffect(
    () => () => {
      realAbortRef.current?.abort();
      wholeAbortRef.current?.abort();
      batchAbortRef.current?.abort();
    },
    [],
  );

  const singleComparisonRows = useMemo<ComparisonRow[]>(() => {
    const rows: ComparisonRow[] = [];
    const meta = result?.mode === "both" ? undefined : result?.perLane[0]?.meta;
    if (meta !== undefined) {
      rows.push(handwrittenRow(meta, `codecLab.codec.${meta.codec}`));
    }
    if (realResult !== null) {
      rows.push(
        realRow(
          realResult.run,
          realResult.settings.realCodec,
          `codecLab.real.codec.${realResult.settings.realCodec}`,
          realMetrics,
        ),
      );
    }
    return sortComparisonRows(rows);
  }, [result, realResult, realMetrics]);

  const comparisonRows = useMemo(
    () => sortComparisonRows(batchRows ?? singleComparisonRows),
    [batchRows, singleComparisonRows],
  );

  useEffect(() => {
    publishCodecComparisonRows(original, comparisonRows);
  }, [original, comparisonRows]);

  useEffect(() => {
    if (realResult === null) {
      setRealMetrics(null);
      return;
    }
    let cancelled = false;
    void measureQualityMetrics(
      realResult.run.reference,
      realResult.run.decoded,
      realResult.run.stats.sampleRateHz,
    ).then(
      (metrics) => {
        if (!cancelled) {
          setRealMetrics(metrics);
        }
      },
      () => {
        if (!cancelled) {
          setRealMetrics(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [realResult]);

  function writeSettings(next: CodecLabSettings): void {
    const params = new URLSearchParams(searchParams);
    for (const key of Array.from(params.keys())) {
      if (key === "el" || (key.startsWith("rr") && key.length > 2)) {
        params.delete(key);
      }
    }
    for (const [key, entry] of new URLSearchParams(codecLabSettingsToSearch(next))) {
      params.set(key, entry);
    }
    setSearchParams(params, { replace: true });
  }

  function updateSettings(patch: Partial<CodecLabSettings>): void {
    writeSettings({ ...settings, ...patch });
  }

  function updateLaneSettings(patch: Partial<CodecLabLaneSettings>): void {
    const nextLane = { ...laneSettings, ...patch };
    writeSettings(
      effectiveLane === "right" ? { ...settings, right: nextLane } : { ...settings, ...nextLane },
    );
  }

  function selectEditLane(lane: "left" | "right"): void {
    updateSettings({ ...settings, editLane: lane });
  }

  function setLinked(nextLinked: boolean): void {
    writeSettings({
      ...settings,
      ...(nextLinked ? { right: undefined } : { right: resolvedLanes.right }),
    });
  }

  function updateRange(startSample: number, endSample: number): void {
    const sampleCount = original?.samples.length ?? 0;
    const sampleRateHz = original?.sampleRateHz ?? 1;
    const range = codecLabRangeFromSelection({ startSample, endSample }, sampleCount, sampleRateHz);
    updateSettings(range);
  }

  const sampleRateHz = original?.sampleRateHz ?? 1;
  const sampleCount = original?.samples.length ?? 0;
  const rangeEmpty = settings.endSample <= settings.startSample;

  function run(): void {
    if (original === null || rangeEmpty || status === "running") {
      return;
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const runSettings = settings;
    const runMode = channel.mode;
    const lanes = codecLabLanes(runSettings);
    const targets: readonly {
      readonly id: "mono" | "left" | "right";
      readonly index: 0 | 1;
      readonly settings: CodecLabLaneSettings;
    }[] =
      runMode === "both"
        ? [
            { id: "left", index: 0, settings: lanes.left },
            { id: "right", index: 1, settings: lanes.right },
          ]
        : runMode === "right"
          ? [{ id: "right", index: 1, settings: lanes.right }]
          : runMode === "left"
            ? [{ id: "left", index: 0, settings: lanes.left }]
            : [{ id: "mono", index: 0, settings: lanes.left }];

    const encodeLane = (target: (typeof targets)[number]): Promise<LaneCodecResult> => {
      const params = {
        codec: target.settings.codec,
        sampleRateHz: original.sampleRateHz,
        startSample: runSettings.startSample,
        endSample: runSettings.endSample,
        mdctBitsPerSecond: target.settings.mdctBitsPerSecond,
        mdctPsychoacoustic: target.settings.mdctPsychoacoustic,
        mdctReferenceSplDb: target.settings.mdctReferenceSplDb,
      };
      const ticket =
        target.id === "mono"
          ? useSessionStore
              .getState()
              .deriveWithSourceSlice(
                "codecLabProcess",
                params,
                runSettings.startSample,
                runSettings.endSample,
              )
          : useSessionStore
              .getState()
              .deriveWithSourceSliceLane(
                "codecLabProcess",
                params,
                runSettings.startSample,
                runSettings.endSample,
                target.index,
              );
      return ticket.outcome.then((outcome) => {
        if ("cancelled" in outcome) {
          throw new Error("codecLabProcess cancelled");
        }
        const samples = unpackResult(outcome);
        if (samples === null) {
          throw new Error("codecLabProcess returned no payload");
        }
        return { id: target.id, meta: outcome.meta, samples };
      });
    };

    setStatus("running");
    setErrorKey(null);
    void Promise.all(targets.map(encodeLane)).then(
      (perLane) => {
        if (runIdRef.current !== runId) {
          return;
        }
        const resultLength = perLane[0]?.samples.length ?? 0;
        const laneSamples = (id: LaneCodecResult["id"]): Float32Array | undefined =>
          perLane.find((lane) => lane.id === id)?.samples;
        const playback = combineLaneResults(
          runMode,
          original.channels,
          runSettings.startSample,
          resultLength,
          {
            mono: laneSamples("mono"),
            left: laneSamples("left"),
            right: laneSamples("right"),
          },
        );
        if (playback === null) {
          setStatus("error");
          setErrorKey("codecLab.error.failed");
          return;
        }
        setResult({ perLane, playback, settings: runSettings, mode: runMode });
        setBatchRows(null);
        setStatus("ready");
      },
      () => {
        if (runIdRef.current === runId) {
          setStatus("error");
          setErrorKey("codecLab.error.failed");
        }
      },
    );
  }

  function playResult(): void {
    if (result === null) {
      return;
    }
    const sampleRate = result.perLane[0]?.meta.sampleRateHz ?? sampleRateHz;
    const playback = result.playback.map((channel) => channel.slice());
    const installed = useSessionStore.getState().setProcessed(playback, sampleRate, "codecLab");
    if (!installed.ok) {
      setErrorKey("codecLab.error.playback");
    }
  }

  const realAvailable = availableRealCodecs(health);
  const realCodecAvailable = realAvailable.includes(settings.realCodec);

  function runWholeFile(): void {
    if (
      original === null ||
      wholeStatus === "running" ||
      realStatus === "running" ||
      !backendOnline ||
      !realCodecAvailable
    ) {
      return;
    }
    const runId = wholeRunIdRef.current + 1;
    wholeRunIdRef.current = runId;
    wholeAbortRef.current?.abort();
    const controller = new AbortController();
    wholeAbortRef.current = controller;
    const wholeSettings: CodecLabSettings = {
      ...settings,
      startSample: 0,
      endSample: original.samples.length,
    };
    setWholeStatus("running");
    setWholeProgress(0);
    setWholeErrorKey(null);
    runWholeFileCodec(
      {
        samples: original.samples,
        channels: original.channels,
        sampleRateHz: original.sampleRateHz,
        startSample: 0,
        endSample: original.samples.length,
      },
      {
        codec: settings.realCodec,
        bitrateKbps: settings.realBitrateKbps,
        quality: settings.realQuality,
        compressionLevel: settings.realCompressionLevel,
      },
      {
        signal: controller.signal,
        onProgress: (progress) => {
          if (wholeRunIdRef.current === runId) {
            setWholeProgress(progress);
          }
        },
      },
    ).then(
      (run) => {
        if (wholeRunIdRef.current !== runId || controller.signal.aborted) {
          return;
        }
        setWholeStatus("idle");
        setWholeProgress(1);
        setRealResult({ run, settings: wholeSettings });
        setRealIsWhole(true);
        setBatchRows(null);
        setRealStatus("ready");
      },
      (error: unknown) => {
        if (wholeRunIdRef.current !== runId || controller.signal.aborted) {
          return;
        }
        setWholeStatus("idle");
        setWholeErrorKey(
          error instanceof RealCodecError ? error.messageKey : "codecLab.error.failed",
        );
      },
    );
  }

  function cancelWholeFile(): void {
    if (wholeStatus !== "running") {
      return;
    }
    wholeAbortRef.current?.abort();
    setWholeStatus("idle");
    setWholeProgress(0);
  }

  function runReal(): void {
    if (
      original === null ||
      rangeEmpty ||
      realStatus === "running" ||
      !backendOnline ||
      !realCodecAvailable
    ) {
      return;
    }
    const runId = realRunIdRef.current + 1;
    realRunIdRef.current = runId;
    realAbortRef.current?.abort();
    const controller = new AbortController();
    realAbortRef.current = controller;
    const runSettings = settings;
    setRealStatus("running");
    setRealErrorKey(null);
    runRealCodec(
      {
        samples: original.samples.subarray(runSettings.startSample, runSettings.endSample),
        channels: original.channels.map((channel) =>
          channel.subarray(runSettings.startSample, runSettings.endSample),
        ),
        sampleRateHz: original.sampleRateHz,
        startSample: runSettings.startSample,
        endSample: runSettings.endSample,
      },
      {
        codec: runSettings.realCodec,
        bitrateKbps: runSettings.realBitrateKbps,
        quality: runSettings.realQuality,
        compressionLevel: runSettings.realCompressionLevel,
      },
      { signal: controller.signal },
    ).then(
      (run) => {
        if (realRunIdRef.current !== runId) {
          return;
        }
        setRealResult({ run, settings: runSettings });
        setRealIsWhole(false);
        setBatchRows(null);
        setRealStatus("ready");
      },
      (error: unknown) => {
        if (realRunIdRef.current !== runId || controller.signal.aborted) {
          return;
        }
        setRealStatus("error");
        setRealErrorKey(
          error instanceof RealCodecError ? error.messageKey : "codecLab.error.failed",
        );
      },
    );
  }

  function runBatch(): void {
    if (
      original === null ||
      rangeEmpty ||
      batchStatus === "running" ||
      status === "running" ||
      realStatus === "running"
    ) {
      return;
    }
    const startSample = settings.startSample;
    const cappedEnd = Math.min(
      settings.endSample,
      startSample + Math.round(COMPARISON_EXCERPT_SECONDS * original.sampleRateHz),
    );
    if (cappedEnd <= startSample) {
      return;
    }
    const requests = defaultComparisonRequests(realAvailable);
    const controller = new AbortController();
    batchAbortRef.current = controller;
    setBatchRows([]);
    setBatchCompleted(0);
    setBatchTotal(requests.length);
    setBatchStatus("running");
    void runComparison(
      {
        samples: original.samples,
        sampleRateHz: original.sampleRateHz,
        startSample,
        endSample: cappedEnd,
      },
      requests,
      {
        runHandwritten: async (request) => {
          const ticket = useSessionStore.getState().deriveWithSourceSlice(
            "codecLabProcess",
            {
              codec: request.codec,
              sampleRateHz: original.sampleRateHz,
              startSample,
              endSample: cappedEnd,
              mdctBitsPerSecond: request.mdctBitsPerSecond,
              mdctPsychoacoustic: settings.mdctPsychoacoustic,
              mdctReferenceSplDb: settings.mdctReferenceSplDb,
            },
            startSample,
            cappedEnd,
          );
          const outcome = await ticket.outcome;
          if ("cancelled" in outcome) {
            throw new Error("codecLabProcess cancelled");
          }
          return outcome.meta;
        },
        runReal: async (request) =>
          runRealCodec(
            {
              samples: original.samples.subarray(startSample, cappedEnd),
              channels: original.channels.map((channel) =>
                channel.subarray(startSample, cappedEnd),
              ),
              sampleRateHz: original.sampleRateHz,
              startSample,
              endSample: cappedEnd,
            },
            request.params,
            { signal: controller.signal },
          ),
        measureQuality: (run) =>
          measureQualityMetrics(run.reference, run.decoded, run.stats.sampleRateHz),
        signal: controller.signal,
        onProgress: (completed, total, row) => {
          if (batchAbortRef.current !== controller) {
            return;
          }
          setBatchCompleted(completed);
          setBatchTotal(total);
          setBatchRows((previous) => [...(previous ?? []), row]);
        },
      },
    ).then(
      (rows) => {
        if (batchAbortRef.current !== controller) {
          return;
        }
        batchAbortRef.current = null;
        setBatchRows(rows);
        setBatchCompleted(rows.length);
        setBatchStatus("idle");
      },
      () => {
        if (batchAbortRef.current === controller) {
          batchAbortRef.current = null;
          setBatchStatus("idle");
        }
      },
    );
  }

  function cancelBatch(): void {
    const controller = batchAbortRef.current;
    if (controller === null) {
      return;
    }
    batchAbortRef.current = null;
    controller.abort();
    setBatchStatus("idle");
  }

  function playRealResult(): void {
    if (realResult === null) {
      return;
    }
    const playback = realPlayback(realResult.run, realResult.settings);
    const installed = useSessionStore
      .getState()
      .setProcessed(playback.channels, realResult.run.stats.sampleRateHz, "codecLab.real", {
        sourceStartSample: playback.sourceStartSample,
      });
    if (!installed.ok) {
      setRealErrorKey("codecLab.error.playback");
    }
  }

  const codecLabels: Record<CodecLabCodec, string> = {
    rle: t("codecLab.codec.rle"),
    huffman: t("codecLab.codec.huffman"),
    deltaHuffman: t("codecLab.codec.deltaHuffman"),
    mulaw: t("codecLab.codec.mulaw"),
    alaw: t("codecLab.codec.alaw"),
    mdct: t("codecLab.codec.mdct"),
  };
  async function copyComparison(): Promise<void> {
    if (comparisonRows.length === 0) {
      return;
    }
    try {
      await navigator.clipboard.writeText(comparisonToCsv(comparisonRows));
      setCopyStatus("ok");
    } catch {
      setCopyStatus("error");
    }
  }

  const realCodecLabels: Record<RealCodecName, string> = {
    wav: t("codecLab.real.codec.wav"),
    flac: t("codecLab.real.codec.flac"),
    mp3: t("codecLab.real.codec.mp3"),
    aac: t("codecLab.real.codec.aac"),
    opus: t("codecLab.real.codec.opus"),
    vorbis: t("codecLab.real.codec.vorbis"),
  };

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <ToolHeader titleKey="tool.codecLab.title" descriptionKey="tool.codecLab.description" />
        <UploadEmptyState />
      </section>
    );
  }

  const stale =
    result !== null && (isCodecLabStale(settings, result.settings) || result.mode !== channel.mode);
  const realStale =
    realResult !== null && !realIsWhole && isRealCodecStale(settings, realResult.settings);
  const diagnosticLane =
    result?.mode === "both"
      ? effectiveLane
      : result?.mode === "right"
        ? "right"
        : result?.mode === "left"
          ? "left"
          : "mono";
  const displayLane =
    result?.perLane.find((lane) => lane.id === diagnosticLane) ?? result?.perLane[0] ?? null;
  const displayMeta = displayLane?.meta ?? null;
  const aggregate =
    result?.mode === "both" ? aggregateCodecLanes(result.perLane.map((lane) => lane.meta)) : null;
  const codeLengths = displayMeta?.codeLengths ?? [];
  const nonZeroCodeLengths = codeLengths
    .map((length, symbol) => ({ length, symbol }))
    .filter((entry) => entry.length > 0);
  const laneLabels = {
    left: t("codecLab.stats.lane.left"),
    right: t("codecLab.stats.lane.right"),
  } as const;
  const toyLaneLabels = {
    left: t("codecLab.lane.left"),
    right: t("codecLab.lane.right"),
  } as const;

  return (
    <section className="flex flex-col gap-4">
      <ToolHeader titleKey="tool.codecLab.title" descriptionKey="tool.codecLab.description" />

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
                  data-testid={`codecLab.lane.${lane}`}
                  onClick={() => {
                    selectEditLane(lane);
                  }}
                >
                  {toyLaneLabels[lane]}
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                data-testid="codecLab.linkRight"
                checked={linked}
                onChange={(event) => {
                  setLinked(event.currentTarget.checked);
                }}
              />
              <span>{t("codecLab.lane.link")}</span>
            </label>
            <p data-testid="codecLab.lane.status" className="text-xs text-muted">
              {linked ? t("codecLab.lane.linked") : t("codecLab.lane.separate")}
            </p>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("codecLab.excerpt.start")}</span>
          <input
            type="number"
            min={0}
            step={0.01}
            dir="ltr"
            value={(settings.startSample / sampleRateHz).toFixed(3)}
            data-testid="codecLab.control.start"
            onChange={(event) => {
              const seconds = Number(event.currentTarget.value);
              if (Number.isFinite(seconds)) {
                updateRange(Math.round(seconds * sampleRateHz), settings.endSample);
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("codecLab.excerpt.end")}</span>
          <input
            type="number"
            min={0}
            step={0.01}
            dir="ltr"
            value={(settings.endSample / sampleRateHz).toFixed(3)}
            data-testid="codecLab.control.end"
            onChange={(event) => {
              const seconds = Number(event.currentTarget.value);
              if (Number.isFinite(seconds)) {
                updateRange(settings.startSample, Math.round(seconds * sampleRateHz));
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>
        <div className="flex items-end">
          <Button
            size="sm"
            variant="outline"
            data-testid="codecLab.useSelection"
            onClick={() => {
              updateSettings(codecLabRangeFromSelection(selection, sampleCount, sampleRateHz));
            }}
          >
            {t("codecLab.excerpt.useSelection")}
          </Button>
        </div>
        <p data-testid="codecLab.range" dir="ltr" className="self-end text-xs text-muted">
          {t("codecLab.excerpt.range", {
            start: formatS(settings.startSample / sampleRateHz),
            end: formatS(settings.endSample / sampleRateHz),
          })}
        </p>
        <p className="text-xs text-muted sm:col-span-2 lg:col-span-4">
          {t("codecLab.excerpt.capNotice")}
        </p>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("codecLab.codec.label")}</span>
          <select
            value={laneSettings.codec}
            data-testid="codecLab.control.codec"
            onChange={(event) => {
              const next = event.currentTarget.value;
              if ((CODEC_LAB_CODECS as readonly string[]).includes(next)) {
                updateLaneSettings({ codec: next as CodecLabCodec });
              }
            }}
            className={INPUT_CLASSES}
          >
            {CODEC_LAB_CODECS.map((codec) => (
              <option key={codec} value={codec}>
                {codecLabels[codec]}
              </option>
            ))}
          </select>
        </label>
        {laneSettings.codec === "mdct" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("codecLab.bitrate.label")}</span>
            <select
              value={laneSettings.mdctBitsPerSecond / 1000}
              data-testid="codecLab.control.bitrate"
              onChange={(event) => {
                const kbps = Number(event.currentTarget.value);
                if (Number.isFinite(kbps)) {
                  updateLaneSettings({ mdctBitsPerSecond: kbps * 1000 });
                }
              }}
              className={INPUT_CLASSES}
            >
              {CODEC_LAB_MDCT_KBPS.map((kbps) => (
                <option key={kbps} value={kbps}>
                  {t("codecLab.bitrate.option", { kbps })}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {laneSettings.codec === "mdct" ? (
          <CodecLabPsychoControls settings={laneSettings} onChange={updateLaneSettings} />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid="codecLab.encode"
          disabled={status === "running" || rangeEmpty}
          onClick={run}
        >
          {status === "running" ? t("codecLab.running") : t("codecLab.encode")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="codecLab.play"
          disabled={result === null}
          onClick={playResult}
        >
          {t("codecLab.play")}
        </Button>
        {stale ? (
          <p data-testid="codecLab.stale" role="status" className="text-sm text-accent">
            {t("codecLab.stale")}
          </p>
        ) : null}
      </div>

      {errorKey !== null ? (
        <p data-testid="codecLab.error" role="alert" className="text-sm text-danger">
          {errorKey === "codecLab.error.failed"
            ? t("codecLab.error.failed")
            : t("codecLab.error.playback")}
        </p>
      ) : status === "idle" ? (
        <p className="text-sm text-muted">{t("codecLab.status.idle")}</p>
      ) : null}

      {result !== null && displayMeta !== null ? (
        <>
          <div className="rounded border border-surface p-3">
            <h3 className="mb-2 text-sm font-semibold">{t("codecLab.stats.title")}</h3>
            <p
              data-testid={result.mode === "mono" ? "codecLab.toy.mono" : "codecLab.toy.mode"}
              className="mb-2 text-xs text-muted"
            >
              {result.mode === "mono"
                ? t("codecLab.toy.mono")
                : result.mode === "both"
                  ? t("codecLab.toy.stereo")
                  : t("codecLab.toy.lane")}
            </p>
            {result.mode === "both" && aggregate !== null ? (
              <>
                <h4 className="mb-1 text-xs font-semibold">{t("codecLab.stats.aggregate")}</h4>
                <dl
                  data-testid="codecLab.stats.aggregate"
                  className="grid grid-cols-1 gap-x-6 text-xs sm:grid-cols-2"
                >
                  <StatRow
                    label={t("codecLab.stats.originalBytes")}
                    value={formatBytes(aggregate.originalBytes)}
                    testId="codecLab.aggregate.originalBytes"
                  />
                  <StatRow
                    label={t("codecLab.stats.compressedBytes")}
                    value={formatBytes(aggregate.compressedSizeBytes)}
                    testId="codecLab.aggregate.compressedBytes"
                  />
                  <StatRow
                    label={t("codecLab.stats.ratio")}
                    value={`${formatNumber(aggregate.compressionRatio)}×`}
                    testId="codecLab.aggregate.ratio"
                  />
                  <StatRow
                    label={t("codecLab.stats.bitsPerSample")}
                    value={formatNumber(aggregate.bitsPerSample)}
                    testId="codecLab.aggregate.bitsPerSample"
                  />
                  <StatRow
                    label={t("codecLab.stats.bitrate")}
                    value={`${formatNumber(aggregate.bitrateKbps)} kbps`}
                    testId="codecLab.aggregate.bitrate"
                  />
                  <StatRow
                    label={t("codecLab.stats.entropy")}
                    value={`${formatNumber(aggregate.entropyBitsPerSymbol)} bit/symbol`}
                    testId="codecLab.aggregate.entropy"
                  />
                  <StatRow
                    label={t("codecLab.stats.encodeMs")}
                    value={`${formatNumber(aggregate.encodeMs)} ms`}
                    testId="codecLab.aggregate.encodeMs"
                  />
                  <StatRow
                    label={t("codecLab.stats.decodeMs")}
                    value={`${formatNumber(aggregate.decodeMs)} ms`}
                    testId="codecLab.aggregate.decodeMs"
                  />
                  <StatRow
                    label={t("codecLab.stats.bitExact")}
                    value={aggregate.bitExact ? t("codecLab.stats.yes") : t("codecLab.stats.no")}
                    testId="codecLab.aggregate.bitExact"
                  />
                </dl>
              </>
            ) : (
              <dl className="grid grid-cols-1 gap-x-6 text-xs sm:grid-cols-2">
                <StatRow
                  label={t("codecLab.stats.originalBytes")}
                  value={formatBytes(displayMeta.originalBytes)}
                  testId="codecLab.stat.originalBytes"
                />
                <StatRow
                  label={t("codecLab.stats.compressedBytes")}
                  value={formatBytes(displayMeta.compressedSizeBytes)}
                  testId="codecLab.stat.compressedBytes"
                />
                <StatRow
                  label={t("codecLab.stats.ratio")}
                  value={`${formatNumber(displayMeta.compressionRatio)}×`}
                  testId="codecLab.stat.ratio"
                />
                <StatRow
                  label={t("codecLab.stats.bitsPerSample")}
                  value={formatNumber(displayMeta.bitsPerSample)}
                  testId="codecLab.stat.bitsPerSample"
                />
                <StatRow
                  label={t("codecLab.stats.bitrate")}
                  value={`${formatNumber(displayMeta.bitrateKbps)} kbps`}
                  testId="codecLab.stat.bitrate"
                />
                <StatRow
                  label={t("codecLab.stats.entropy")}
                  value={`${formatNumber(displayMeta.entropyBitsPerSymbol)} bit/symbol`}
                  testId="codecLab.stat.entropy"
                />
                <StatRow
                  label={t("codecLab.stats.encodeMs")}
                  value={`${formatNumber(displayMeta.encodeMs)} ms`}
                  testId="codecLab.stat.encodeMs"
                />
                <StatRow
                  label={t("codecLab.stats.decodeMs")}
                  value={`${formatNumber(displayMeta.decodeMs)} ms`}
                  testId="codecLab.stat.decodeMs"
                />
                <StatRow
                  label={t("codecLab.stats.bitExact")}
                  value={displayMeta.bitExact ? t("codecLab.stats.yes") : t("codecLab.stats.no")}
                  testId="codecLab.stat.bitExact"
                />
                <StatRow
                  label={t("codecLab.stats.snr")}
                  value={`${formatNumber(displayMeta.snrDb)} dB`}
                  testId="codecLab.stat.snr"
                />
                <StatRow
                  label={t("codecLab.stats.segmentalSnr")}
                  value={`${formatNumber(displayMeta.segmentalSnrDb)} dB`}
                  testId="codecLab.stat.segmentalSnr"
                />
                <StatRow
                  label={t("codecLab.stats.psnr")}
                  value={`${formatNumber(displayMeta.psnrDb)} dB`}
                  testId="codecLab.stat.psnr"
                />
                <StatRow
                  label={t("codecLab.stats.mse")}
                  value={formatNumber(displayMeta.mse, 6)}
                  testId="codecLab.stat.mse"
                />
              </dl>
            )}
            {result.mode === "both" ? (
              <div className="mt-3 overflow-x-auto">
                <table data-testid="codecLab.stats.lanes" className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-surface text-muted">
                      <th className="py-1 pe-3 text-start font-medium">{t("channel.label")}</th>
                      <th className="py-1 pe-3 text-start font-medium">
                        {t("codecLab.stats.mse")}
                      </th>
                      <th className="py-1 pe-3 text-start font-medium">
                        {t("codecLab.stats.snr")}
                      </th>
                      <th className="py-1 pe-3 text-start font-medium">
                        {t("codecLab.stats.segmentalSnr")}
                      </th>
                      <th className="py-1 text-start font-medium">{t("codecLab.stats.psnr")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.perLane.map((lane) => (
                      <tr key={lane.id} data-testid={`codecLab.stats.lane.${lane.id}`}>
                        <td className="py-1 pe-3">
                          {lane.id === "right" ? laneLabels.right : laneLabels.left}
                        </td>
                        <td dir="ltr" className="py-1 pe-3 tabular-nums">
                          {formatNumber(lane.meta.mse, 6)}
                        </td>
                        <td dir="ltr" className="py-1 pe-3 tabular-nums">
                          {formatNumber(lane.meta.snrDb)} dB
                        </td>
                        <td dir="ltr" className="py-1 pe-3 tabular-nums">
                          {formatNumber(lane.meta.segmentalSnrDb)} dB
                        </td>
                        <td dir="ltr" className="py-1 tabular-nums">
                          {formatNumber(lane.meta.psnrDb)} dB
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="mt-2 text-xs text-muted">{t("codecLab.stats.psnrNote")}</p>
          </div>

          {displayMeta.frameCount !== null ? (
            <div className="rounded border border-surface p-3 text-xs">
              <h3 className="mb-2 text-sm font-semibold">
                {t("codecLab.mdct.title")}
                {result.mode === "both" ? ` — ${laneLabels[effectiveLane]}` : ""}
              </h3>
              <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-3">
                <StatRow
                  label={t("codecLab.mdct.sparsity")}
                  value={`${formatNumber((displayMeta.coefficientSparsity ?? 0) * 100)}%`}
                  testId="codecLab.mdct.sparsity"
                />
                <StatRow
                  label={t("codecLab.mdct.frames")}
                  value={String(displayMeta.frameCount)}
                  testId="codecLab.mdct.frames"
                />
                {displayMeta.psychoacoustic ? (
                  <>
                    <StatRow
                      label={t("codecLab.mdct.entropyBits")}
                      value={String(displayMeta.mdctEntropyBits ?? 0)}
                      testId="codecLab.mdct.entropyBits"
                    />
                    <StatRow
                      label={t("codecLab.mdct.sideInfoBits")}
                      value={String(displayMeta.mdctSideInfoBits ?? 0)}
                      testId="codecLab.mdct.sideInfoBits"
                    />
                    <StatRow
                      label={t("codecLab.mdct.totalBitrate")}
                      value={`${formatNumber(displayMeta.bitrateKbps)} kbps`}
                      testId="codecLab.mdct.totalBitrate"
                    />
                    <StatRow
                      label={t("codecLab.mdct.maskedShare")}
                      value={`${formatNumber((displayMeta.mdctMaskedFraction ?? 0) * 100)}%`}
                      testId="codecLab.mdct.maskedShare"
                    />
                  </>
                ) : (
                  <StatRow
                    label={t("codecLab.mdct.totalBits")}
                    value={String(displayMeta.bitsTotal ?? 0)}
                    testId="codecLab.mdct.totalBits"
                  />
                )}
              </dl>
              {displayMeta.mdctBands !== null ? (
                <MdctBandChart bands={displayMeta.mdctBands} />
              ) : null}
              {displayMeta.psychoacoustic ? (
                <p className="mt-2 text-xs text-muted">{t("codecLab.mdct.psychoNote")}</p>
              ) : null}
            </div>
          ) : null}

          <figure className="flex flex-col gap-1 rounded border border-surface p-3">
            <figcaption className="text-sm font-semibold">
              {t("codecLab.histogram.title")}
              {result.mode === "both" ? ` — ${laneLabels[effectiveLane]}` : ""}
            </figcaption>
            <Histogram histogram={displayMeta.histogram} ariaLabel={t("codecLab.histogram.aria")} />
          </figure>

          {nonZeroCodeLengths.length > 0 ? (
            <div className="rounded border border-surface p-3">
              <h3 className="mb-2 text-sm font-semibold">
                {t("codecLab.codeLengths.title")}
                {result.mode === "both" ? ` — ${laneLabels[effectiveLane]}` : ""}
              </h3>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-bg text-muted">
                    <tr>
                      <th className="text-start font-medium">{t("codecLab.codeLengths.symbol")}</th>
                      <th className="text-end font-medium">{t("codecLab.codeLengths.length")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nonZeroCodeLengths.map((entry) => (
                      <tr key={entry.symbol}>
                        <td dir="ltr" className="font-mono">
                          0x{entry.symbol.toString(16).padStart(2, "0").toUpperCase()}
                        </td>
                        <td dir="ltr" className="text-end tabular-nums">
                          {entry.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="rounded border border-surface p-3" data-testid="codecLab.real">
        <h3 className="mb-2 text-sm font-semibold">{t("codecLab.real.title")}</h3>
        {!backendOnline ? (
          <p data-testid="codecLab.real.offline" className="mb-2 text-xs text-muted">
            {t("codecLab.real.offline")}
          </p>
        ) : health === null ? (
          <p className="mb-2 text-xs text-muted">{t("codecLab.real.checking")}</p>
        ) : realAvailable.length === 0 ? (
          <p data-testid="codecLab.real.unavailable" className="mb-2 text-xs text-muted">
            {t("codecLab.real.none")}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("codecLab.real.codecLabel")}</span>
            <select
              value={settings.realCodec}
              data-testid="codecLab.real.codec"
              disabled={!backendOnline || realAvailable.length === 0 || realStatus === "running"}
              onChange={(event) => {
                const next = event.currentTarget.value;
                if ((REAL_CODEC_NAMES as readonly string[]).includes(next)) {
                  updateSettings({ realCodec: next as RealCodecName });
                }
              }}
              className={INPUT_CLASSES}
            >
              {REAL_CODEC_NAMES.map((name) => (
                <option key={name} value={name} disabled={!realAvailable.includes(name)}>
                  {realCodecLabels[name]}
                </option>
              ))}
            </select>
          </label>
          {settings.realCodec === "mp3" ||
          settings.realCodec === "aac" ||
          settings.realCodec === "opus" ? (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("codecLab.real.bitrateLabel")}</span>
              <select
                value={settings.realBitrateKbps}
                data-testid="codecLab.real.bitrate"
                disabled={realStatus === "running"}
                onChange={(event) => {
                  const kbps = Number(event.currentTarget.value);
                  if (Number.isFinite(kbps)) {
                    updateSettings({ realBitrateKbps: kbps });
                  }
                }}
                className={INPUT_CLASSES}
              >
                {CODEC_LAB_REAL_BITRATES_KBPS.map((kbps) => (
                  <option key={kbps} value={kbps}>
                    {t("codecLab.bitrate.option", { kbps })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {settings.realCodec === "vorbis" ? (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("codecLab.real.qualityLabel")}</span>
              <select
                value={settings.realQuality}
                data-testid="codecLab.real.quality"
                disabled={realStatus === "running"}
                onChange={(event) => {
                  const quality = Number(event.currentTarget.value);
                  if (Number.isFinite(quality)) {
                    updateSettings({ realQuality: quality });
                  }
                }}
                className={INPUT_CLASSES}
              >
                {Array.from(
                  { length: CODEC_LAB_REAL_QUALITY_MAX - CODEC_LAB_REAL_QUALITY_MIN + 1 },
                  (_, index) => CODEC_LAB_REAL_QUALITY_MIN + index,
                ).map((quality) => (
                  <option key={quality} value={quality}>
                    {quality}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {settings.realCodec === "flac" ? (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("codecLab.real.compressionLabel")}</span>
              <select
                value={settings.realCompressionLevel}
                data-testid="codecLab.real.compression"
                disabled={realStatus === "running"}
                onChange={(event) => {
                  const level = Number(event.currentTarget.value);
                  if (Number.isFinite(level)) {
                    updateSettings({ realCompressionLevel: level });
                  }
                }}
                className={INPUT_CLASSES}
              >
                {Array.from(
                  { length: CODEC_LAB_REAL_COMPRESSION_MAX - CODEC_LAB_REAL_COMPRESSION_MIN + 1 },
                  (_, index) => CODEC_LAB_REAL_COMPRESSION_MIN + index,
                ).map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            data-testid="codecLab.real.encode"
            disabled={
              !backendOnline ||
              !realCodecAvailable ||
              realStatus === "running" ||
              wholeStatus === "running" ||
              rangeEmpty
            }
            onClick={runReal}
          >
            {realStatus === "running" ? t("codecLab.real.running") : t("codecLab.real.encode")}
          </Button>
          <Button
            data-testid="codecLab.real.wholeEncode"
            variant="outline"
            disabled={
              !backendOnline ||
              !realCodecAvailable ||
              realStatus === "running" ||
              wholeStatus === "running"
            }
            onClick={runWholeFile}
          >
            {wholeStatus === "running"
              ? t("codecLab.real.wholeRunning")
              : t("codecLab.real.wholeEncode")}
          </Button>
          {wholeStatus === "running" ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="codecLab.real.wholeCancel"
              onClick={cancelWholeFile}
            >
              {t("codecLab.real.wholeCancel")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            data-testid="codecLab.real.play"
            disabled={realResult === null}
            onClick={playRealResult}
          >
            {t("codecLab.real.play")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="codecLab.real.export"
            disabled={realResult === null}
            onClick={() => {
              if (realResult === null) {
                return;
              }
              downloadWav(
                realResult.run.channels,
                realResult.run.stats.sampleRateHz,
                `avalab-${realResult.settings.realCodec}.wav`,
              );
            }}
          >
            {t("codecLab.real.export")}
          </Button>
          {realStale ? (
            <p data-testid="codecLab.real.stale" role="status" className="text-sm text-accent">
              {t("codecLab.real.stale")}
            </p>
          ) : null}
          {backendOnline && health !== null && !realCodecAvailable ? (
            <p className="text-xs text-muted">{t("codecLab.real.codecUnavailable")}</p>
          ) : null}
        </div>
        {wholeStatus === "running" ? (
          <p
            data-testid="codecLab.real.wholeProgress"
            role="status"
            dir="ltr"
            className="mt-2 text-xs tabular-nums text-muted"
          >
            {t("codecLab.real.wholeProgress", {
              percent: Math.round(wholeProgress * 100),
              stage: wholeStageLabel(t, wholeProgress),
            })}
          </p>
        ) : null}
        {wholeErrorKey !== null ? (
          <p
            data-testid="codecLab.real.wholeError"
            role="alert"
            className="mt-2 text-sm text-danger"
          >
            {realErrorText(t, wholeErrorKey)}
          </p>
        ) : null}
        {realErrorKey !== null ? (
          <p data-testid="codecLab.real.error" role="alert" className="mt-2 text-sm text-danger">
            {realErrorText(t, realErrorKey)}
          </p>
        ) : realStatus === "idle" && wholeStatus === "idle" ? (
          <p className="mt-2 text-xs text-muted">{t("codecLab.real.idle")}</p>
        ) : null}
        <p className="mt-2 text-xs text-muted">{t("codecLab.real.wholeHint")}</p>
        {realResult !== null ? (
          <>
            <p
              data-testid="codecLab.real.channels"
              dir="ltr"
              className="mt-3 text-xs font-medium tabular-nums text-muted"
            >
              {realResult.run.stats.channels === 2
                ? t("codecLab.real.stereo")
                : t("codecLab.real.channels", { count: realResult.run.stats.channels })}
            </p>
            {realMetrics !== null ? (
              <>
                <p data-testid="codecLab.metrics.monoAnalysis" className="mt-2 text-xs font-medium">
                  {t("codecLab.metrics.monoAnalysis")}
                </p>
                <p className="text-xs text-muted">{t("codecLab.metrics.monoHint")}</p>
              </>
            ) : null}
            <dl className="mt-3 grid grid-cols-1 gap-x-6 text-xs sm:grid-cols-2">
              <StatRow
                label={t("codecLab.real.encodedSize")}
                value={formatBytes(realResult.run.stats.sizeBytes)}
                testId="codecLab.real.stat.size"
              />
              <StatRow
                label={t("codecLab.stats.bitrate")}
                value={`${formatNumber(realResult.run.stats.bitrateKbps)} kbps`}
                testId="codecLab.real.stat.bitrate"
              />
              <StatRow
                label={t("codecLab.stats.encodeMs")}
                value={`${formatNumber(realResult.run.stats.encodeMs)} ms`}
                testId="codecLab.real.stat.encodeMs"
              />
              <StatRow
                label={t("codecLab.real.delaySamples")}
                value={String(realResult.run.stats.codecDelaySamples)}
                testId="codecLab.real.stat.delay"
              />
              <StatRow
                label={t("codecLab.real.alignedSamples")}
                value={String(realResult.run.stats.alignedSampleCount)}
                testId="codecLab.real.stat.aligned"
              />
              <StatRow
                label={t("codecLab.real.duration")}
                value={`${formatNumber(realResult.run.stats.durationSeconds, 3)} s`}
                testId="codecLab.real.stat.duration"
              />
              <StatRow
                label={t("codecLab.stats.bitExact")}
                value={
                  realResult.run.stats.bitExact ? t("codecLab.stats.yes") : t("codecLab.stats.no")
                }
                testId="codecLab.real.stat.bitExact"
              />
              <StatRow
                label={t("codecLab.real.lossless")}
                value={
                  realResult.run.stats.lossless ? t("codecLab.stats.yes") : t("codecLab.stats.no")
                }
                testId="codecLab.real.stat.lossless"
              />
              {realMetrics !== null ? (
                <>
                  <StatRow
                    label={t("codecLab.stats.mse")}
                    value={formatMetric(realMetrics.mse, 6)}
                    testId="codecLab.real.stat.mse"
                  />
                  <StatRow
                    label={t("codecLab.stats.snr")}
                    value={`${formatMetric(realMetrics.snrDb)} dB`}
                    testId="codecLab.real.stat.snr"
                  />
                  <StatRow
                    label={t("codecLab.stats.segmentalSnr")}
                    value={`${formatMetric(realMetrics.segmentalSnrDb)} dB`}
                    testId="codecLab.real.stat.segmentalSnr"
                  />
                  <StatRow
                    label={t("codecLab.stats.psnr")}
                    value={`${formatMetric(realMetrics.psnrDb)} dB`}
                    testId="codecLab.real.stat.psnr"
                  />
                </>
              ) : null}
            </dl>
            <p className="mt-2 text-xs text-muted">{t("codecLab.stats.psnrNote")}</p>
          </>
        ) : null}
      </div>

      <div className="rounded border border-surface p-3 text-sm" data-testid="codecLab.comparison">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{t("codecLab.comparison.title")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="codecLab.comparison.run"
              disabled={
                batchStatus === "running" ||
                rangeEmpty ||
                status === "running" ||
                realStatus === "running" ||
                wholeStatus === "running"
              }
              onClick={runBatch}
            >
              {batchStatus === "running"
                ? t("codecLab.comparison.running")
                : t("codecLab.comparison.run")}
            </Button>
            {batchStatus === "running" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="codecLab.comparison.cancel"
                onClick={cancelBatch}
              >
                {t("codecLab.comparison.cancel")}
              </Button>
            ) : null}
            <span
              data-testid="codecLab.comparison.progress"
              dir="ltr"
              className="text-xs tabular-nums text-muted"
            >
              {t("codecLab.comparison.progress", {
                completed: batchCompleted,
                total: batchTotal,
              })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="codecLab.comparison.copy"
              disabled={comparisonRows.length === 0}
              onClick={() => {
                void copyComparison();
              }}
            >
              {t("codecLab.comparison.copy")}
            </Button>
          </div>
        </div>
        {!backendOnline ? (
          <p data-testid="codecLab.comparison.offline" className="mt-2 text-xs text-muted">
            {t("codecLab.comparison.offline")}
          </p>
        ) : null}
        {copyStatus === "ok" ? (
          <p
            data-testid="codecLab.comparison.copyStatus"
            role="status"
            className="text-xs text-accent"
          >
            {t("codecLab.comparison.copied")}
          </p>
        ) : null}
        {copyStatus === "error" ? (
          <p
            data-testid="codecLab.comparison.copyStatus"
            role="alert"
            className="text-xs text-danger"
          >
            {t("codecLab.comparison.copyFailed")}
          </p>
        ) : null}
        {comparisonRows.length === 0 ? (
          <p data-testid="codecLab.comparison.empty" className="mt-2 text-xs text-muted">
            {t("codecLab.comparison.empty")}
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table data-testid="codecLab.comparison.table" className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface text-start">
                  <th className="py-1 pe-3 text-start font-medium">
                    {t("codecLab.comparison.header.method")}
                  </th>
                  <th className="py-1 pe-3 text-start font-medium">
                    {t("codecLab.comparison.header.family")}
                  </th>
                  <th className="py-1 pe-3 text-start font-medium">
                    {t("codecLab.comparison.header.bitrate")}
                  </th>
                  <th className="py-1 pe-3 text-start font-medium">
                    {t("codecLab.comparison.header.ratio")}
                  </th>
                  <th className="py-1 pe-3 text-start font-medium">
                    {t("codecLab.comparison.header.snr")}
                  </th>
                  <th className="py-1 pe-3 text-start font-medium">
                    {t("codecLab.comparison.header.psnr")}
                  </th>
                  <th className="py-1 pe-3 text-start font-medium">
                    {t("codecLab.comparison.header.encodeMs")}
                  </th>
                  <th className="py-1 pe-3 text-start font-medium">
                    {t("codecLab.comparison.header.bitExact")}
                  </th>
                  <th className="py-1 text-start font-medium">
                    {t("codecLab.comparison.header.lossless")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid={`codecLab.comparison.row.${row.id}`}
                    className="border-b border-surface/60"
                  >
                    <td className="py-1 pe-3">{t(row.labelKey)}</td>
                    <td className="py-1 pe-3">
                      {row.family === "handwritten"
                        ? t("codecLab.comparison.family.handwritten")
                        : t("codecLab.comparison.family.real")}
                    </td>
                    {row.errorKey !== undefined ? (
                      <td colSpan={7} className="py-1 text-danger">
                        {t(row.errorKey)}
                      </td>
                    ) : (
                      <>
                        <td dir="ltr" className="py-1 pe-3 tabular-nums">
                          {formatMetric(row.bitrateKbps, 2)}
                        </td>
                        <td dir="ltr" className="py-1 pe-3 tabular-nums">
                          {formatMetric(row.compressionRatio, 3)}
                        </td>
                        <td dir="ltr" className="py-1 pe-3 tabular-nums">
                          {formatMetric(row.snrDb, 2)}
                        </td>
                        <td dir="ltr" className="py-1 pe-3 tabular-nums">
                          {formatMetric(row.psnrDb, 2)}
                        </td>
                        <td dir="ltr" className="py-1 pe-3 tabular-nums">
                          {formatMetric(row.encodeMs, 2)}
                        </td>
                        <td className="py-1 pe-3">
                          {row.bitExact ? t("codecLab.stats.yes") : t("codecLab.stats.no")}
                        </td>
                        <td className="py-1">
                          {row.lossless ? t("codecLab.stats.yes") : t("codecLab.stats.no")}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result?.mode === "both" ? (
          <p data-testid="codecLab.comparison.stereoNote" className="mt-2 text-xs text-muted">
            {t("codecLab.comparison.stereoNote")}
          </p>
        ) : null}
        {comparisonRows.length > 0 ? (
          <div className="mt-3 border-t border-surface pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-semibold">{t("codecLab.comparison.chart.title")}</h4>
              <label className="flex items-center gap-2 text-xs">
                <span>{t("codecLab.comparison.chart.quality")}</span>
                <select
                  data-testid="codecLab.comparison.chart.quality"
                  className={INPUT_CLASSES}
                  value={chartQuality}
                  onChange={(event) => {
                    setChartQuality(event.target.value === "psnrDb" ? "psnrDb" : "snrDb");
                  }}
                >
                  <option value="snrDb">{t("codecLab.comparison.chart.snr")}</option>
                  <option value="psnrDb">{t("codecLab.comparison.chart.psnr")}</option>
                </select>
              </label>
            </div>
            <RateDistortionChart rows={comparisonRows} quality={chartQuality} />
          </div>
        ) : null}
      </div>

      <TheoryPanel
        titleKey={TOOL_THEORY["codec-lab"].titleKey}
        sections={TOOL_THEORY["codec-lab"].sections}
      />
    </section>
  );
}
