/**
 * F03 sampling rate and bit-depth lab (Wave-3 Plan 02 Task 3).
 *
 * The view is parameter plumbing: every resample/quantize/metric runs in the
 * worker through `deriveStandalone("samplingProcess", …)` and the settled
 * quantized/error halves are installed into the processed playback lane on
 * demand. The aliasing card is source-free and uses `aliasDemo`.
 *
 * Metrics are measured against the RESAMPLED reference (not the original
 * file), so the SNR readout describes quantization alone; the theoretical
 * `6.02·bits + 1.76 dB` value is shown only with its full-scale-sine label.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import uPlot from "uplot";
import { ToolHeader } from "../../components/ToolHeader";
import "uplot/dist/uPlot.min.css";

import { Button } from "../../components/ui/button";
import { formatDb, formatHz, formatS } from "../../lib/format";
import { combineLaneOutputs, type LaneResults } from "../../lib/laneCombine";
import { laneParamsLinked } from "../../lib/laneParams";
import { writeLastUsed } from "../../lib/lastUsed";
import type { AliasDemoResult, SamplingProcessResult } from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { ChannelPicker } from "../channels/ChannelPicker";
import { useChannelMode } from "../channels/useChannelMode";
import { UploadEmptyState } from "../input/upload";
import { TheoryPanel } from "../theory/TheoryPanel";
import { TOOL_THEORY } from "../theory/theoryContent";
import {
  defaultSamplingRange,
  loadSamplingSettings,
  SAMPLING_MAX_BITS,
  SAMPLING_MAX_RATE_HZ,
  SAMPLING_MIN_BITS,
  SAMPLING_MIN_RATE_HZ,
  SAMPLING_RATE_PRESETS,
  SAMPLING_STORAGE_KEY,
  type SamplingLaneSettings,
  type SamplingSettings,
  samplingLanes,
  samplingSettingsFromSearch,
  samplingSettingsToSearch,
} from "./samplingState";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;
const WAVEFORM_HEIGHT_PX = 64;
const ERROR_CHART_HEIGHT_PX = 160;
const ERROR_CHART_MAX_POINTS = 4000;
const MAX_DEVICE_PIXEL_RATIO = 2;
const ALIAS_SOURCE_RATE_HZ = 48_000;
const ALIAS_TARGET_RATES = [4000, 8000, 16_000] as const;
const ALIAS_DEFAULT_TARGET_RATE_HZ = 8000;
const ALIAS_DEFAULT_FREQUENCY_HZ = 5000;
const ALIAS_DURATION_SECONDS = 1;

type SamplingResult = {
  readonly meta: SamplingProcessResult["meta"];
  readonly quantized: Float32Array;
  readonly error: Float32Array;
  readonly reference: Float32Array;
};

type AliasResult = {
  readonly meta: AliasDemoResult["meta"];
  readonly samples: Float32Array;
};

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

function MiniWaveform({
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
        data-testid={testId}
        style={{ height: `${WAVEFORM_HEIGHT_PX}px` }}
        className="block w-full rounded bg-bg ring-1 ring-surface"
      />
    </div>
  );
}

function ErrorChart({
  error,
  sampleRateHz,
  ariaLabel,
  xLabel,
  yLabel,
}: {
  readonly error: Float32Array;
  readonly sampleRateHz: number;
  readonly ariaLabel: string;
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
    if (host === null || error.length === 0) {
      return;
    }
    const step = Math.max(1, Math.ceil(error.length / ERROR_CHART_MAX_POINTS));
    const count = Math.ceil(error.length / step);
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      xs[index] = (index * step) / sampleRateHz;
      ys[index] = error[index * step] ?? 0;
    }
    const options: uPlot.Options = {
      width: widthPx,
      height: ERROR_CHART_HEIGHT_PX,
      legend: { show: false },
      cursor: { show: false },
      scales: { x: { time: false } },
      series: [{}, { stroke: "#f59e0b", width: 1 }],
      axes: [
        {
          stroke: "#8b98a5",
          grid: { stroke: "#1f2933" },
          label: xLabel,
          labelSize: 14,
          size: 28,
        },
        {
          stroke: "#8b98a5",
          grid: { stroke: "#1f2933" },
          label: yLabel,
          labelSize: 14,
          size: 40,
        },
      ],
    };
    const plot = new uPlot(options, [xs, ys] as uPlot.AlignedData, host);
    return () => {
      plot.destroy();
    };
  }, [error, sampleRateHz, widthPx, xLabel, yLabel]);

  return (
    <figure className="flex flex-col gap-1">
      <div
        ref={hostRef}
        dir="ltr"
        role="img"
        data-testid="sampling.error.chart"
        aria-label={ariaLabel}
      />
    </figure>
  );
}

function AliasingCard({ sourceLoaded }: { readonly sourceLoaded: boolean }) {
  const { t } = useTranslation();
  const [targetRateHz, setTargetRateHz] = useState<number>(ALIAS_DEFAULT_TARGET_RATE_HZ);
  const [frequencyHz, setFrequencyHz] = useState(ALIAS_DEFAULT_FREQUENCY_HZ);
  const [antiAlias, setAntiAlias] = useState(false);
  const [result, setResult] = useState<AliasResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setFailed(false);
    setBusy(true);
    const timer = window.setTimeout(() => {
      const appliedFrequencyHz = Math.min(frequencyHz, 2 * targetRateHz);
      const ticket = useSessionStore.getState().deriveStandalone("aliasDemo", {
        sourceRateHz: ALIAS_SOURCE_RATE_HZ,
        targetRateHz,
        frequencyHz: appliedFrequencyHz,
        durationSeconds: ALIAS_DURATION_SECONDS,
        antiAlias,
      });
      ticket.outcome.then(
        (outcome) => {
          if (generationRef.current !== generation || "cancelled" in outcome) {
            return;
          }
          const payload = outcome.payload;
          if (payload === undefined) {
            setBusy(false);
            setFailed(true);
            return;
          }
          setResult({
            meta: outcome.meta,
            samples: new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
          });
          setBusy(false);
        },
        () => {
          if (generationRef.current === generation) {
            setBusy(false);
            setFailed(true);
          }
        },
      );
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [targetRateHz, frequencyHz, antiAlias]);

  const maxFrequencyHz = 2 * targetRateHz;

  return (
    <div className="flex flex-col gap-3 rounded border border-surface p-3">
      <h3 className="text-sm font-semibold">{t("sampling.alias.title")}</h3>
      <p className="text-xs text-muted">{t("sampling.alias.description")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("sampling.alias.targetRate")}</span>
          <select
            value={targetRateHz}
            data-testid="sampling.alias.targetRate"
            onChange={(event) => {
              setTargetRateHz(Number(event.currentTarget.value));
            }}
            className={INPUT_CLASSES}
          >
            {ALIAS_TARGET_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {formatHz(rate)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("sampling.alias.frequency")}</span>
          <input
            type="range"
            min={0}
            max={maxFrequencyHz}
            step={100}
            value={Math.min(frequencyHz, maxFrequencyHz)}
            data-testid="sampling.alias.frequency"
            onChange={(event) => {
              setFrequencyHz(Number(event.currentTarget.value));
            }}
            className={CONTROL_FOCUS_CLASSES}
          />
          <span dir="ltr" className="tabular-nums text-muted">
            {formatHz(Math.min(frequencyHz, maxFrequencyHz))}
          </span>
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={antiAlias}
            data-testid="sampling.alias.antiAlias"
            onChange={(event) => {
              setAntiAlias(event.currentTarget.checked);
            }}
            className={CONTROL_FOCUS_CLASSES}
          />
          <span>{t("sampling.controls.antiAlias")}</span>
        </label>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {t("sampling.error.failed")}
        </p>
      ) : busy ? (
        <p data-testid="sampling.alias.status" className="text-sm text-muted">
          {t("sampling.status.computing")}
        </p>
      ) : result !== null ? (
        <>
          <dl className="flex flex-wrap gap-4 text-xs text-muted">
            <div className="flex items-center gap-1">
              <dt>{t("sampling.alias.predicted")}</dt>
              <dd dir="ltr" data-testid="sampling.alias.predicted" className="tabular-nums">
                {formatHz(result.meta.aliasFrequencyHz)}
              </dd>
            </div>
            <div className="flex items-center gap-1">
              <dt>{t("sampling.alias.measured")}</dt>
              <dd dir="ltr" data-testid="sampling.alias.measured" className="tabular-nums">
                {formatHz(result.meta.measuredPeakHz)}
              </dd>
            </div>
          </dl>
          <MiniWaveform
            samples={result.samples}
            ariaLabel={t("sampling.alias.waveformAria")}
            testId="sampling.alias.waveform"
          />
          {sourceLoaded && (
            <div>
              <Button
                size="sm"
                variant="outline"
                data-testid="sampling.alias.play"
                onClick={() => {
                  useSessionStore
                    .getState()
                    .setProcessed(result.samples.slice(), targetRateHz, "alias");
                }}
              >
                {t("sampling.alias.play")}
              </Button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

type SamplingLaneKey = "left" | "right";

function readSamplingResult(outcome: {
  readonly meta: SamplingProcessResult["meta"];
  readonly payload?: {
    readonly buffer: ArrayBuffer;
    readonly byteOffset: number;
    readonly byteLength: number;
  };
}): SamplingResult | null {
  const payload = outcome.payload;
  if (payload === undefined) {
    return null;
  }
  const values = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  const sampleCount = outcome.meta.outputSampleCount;
  const quantized = values.slice(0, sampleCount);
  const error = values.slice(sampleCount, sampleCount * 2);
  const reference = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    reference[index] = (quantized[index] ?? 0) + (error[index] ?? 0);
  }
  return { meta: outcome.meta, quantized, error, reference };
}

export function SamplingView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const channel = useChannelMode(original, "both");
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useMemo(() => {
    const source = {
      sampleCount: original?.samples.length ?? 0,
      sampleRateHz: original?.sampleRateHz ?? 1,
    };
    if (searchParams.toString() === "") {
      return loadSamplingSettings(source, selection);
    }
    return samplingSettingsFromSearch(`?${searchParams.toString()}`, source, selection);
  }, [searchParams, original, selection]);
  const resolved = useMemo(() => samplingLanes(settings), [settings]);
  const effectiveLane: SamplingLaneKey =
    channel.mode === "both" ? settings.editLane : channel.mode === "right" ? "right" : "left";
  const laneSettings = resolved[effectiveLane];
  const lanePair = useMemo(
    () => ({
      primary: { bits: settings.bits, dither: settings.dither },
      ...(settings.right === undefined ? {} : { right: settings.right }),
    }),
    [settings.bits, settings.dither, settings.right],
  );
  const linked = laneParamsLinked(lanePair);

  useEffect(() => {
    writeLastUsed(SAMPLING_STORAGE_KEY, samplingSettingsToSearch(settings));
  }, [settings]);
  const [laneResults, setLaneResults] = useState<Partial<Record<SamplingLaneKey, SamplingResult>>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const generationRef = useRef(0);
  const result = laneResults[effectiveLane] ?? null;

  function writeSettings(next: SamplingSettings): void {
    const params = new URLSearchParams(searchParams);
    for (const key of Array.from(params.keys())) {
      if (key === "el" || (key.startsWith("rr") && key.length > 2)) {
        params.delete(key);
      }
    }
    for (const [key, value] of new URLSearchParams(samplingSettingsToSearch(next))) {
      params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  }

  function updateSettings(patch: Partial<SamplingSettings>): void {
    writeSettings({ ...settings, ...patch });
  }

  function updateLaneSettings(patch: Partial<SamplingLaneSettings>): void {
    const next = { ...laneSettings, ...patch };
    writeSettings(
      effectiveLane === "right" ? { ...settings, right: next } : { ...settings, ...next },
    );
  }

  function selectEditLane(lane: SamplingLaneKey): void {
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
    setFailed(false);
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
        setFailed(true);
        return;
      }
      const store = useSessionStore.getState();
      const targets: SamplingLaneKey[] =
        channel.mode === "both" ? ["left", "right"] : [effectiveLane];
      const pending = targets.map((lane) => {
        const params = {
          sampleRateHz: original.sampleRateHz,
          startSample,
          endSample,
          targetRateHz: settings.targetRateHz,
          antiAlias: settings.antiAlias,
          bits: resolved[lane].bits,
          dither: resolved[lane].dither,
          seed: settings.seed,
        };
        if (channel.mode === "mono") {
          const slice = original.samples.slice(startSample, endSample);
          return {
            lane,
            ticket: store.deriveStandalone("samplingProcess", params, {
              buffer: slice.buffer,
              byteOffset: 0,
              byteLength: slice.byteLength,
            }),
          };
        }
        return {
          lane,
          ticket: store.deriveWithSourceSliceLane(
            "samplingProcess",
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
          const next: Partial<Record<SamplingLaneKey, SamplingResult>> = {};
          for (const { lane, outcome } of settled) {
            if ("cancelled" in outcome) {
              return;
            }
            const unpacked = readSamplingResult(outcome);
            if (unpacked === null) {
              setBusy(false);
              setFailed(true);
              return;
            }
            next[lane] = unpacked;
          }
          setLaneResults(next);
          setBusy(false);
        },
        () => {
          if (generationRef.current === generation) {
            setBusy(false);
            setFailed(true);
          }
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

  const previewRange = original
    ? defaultSamplingRange(selection, original.samples.length, original.sampleRateHz)
    : { startSample: 0, endSample: 0 };

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <ToolHeader titleKey="tool.sampling.title" descriptionKey="tool.sampling.description" />
        <UploadEmptyState />
        <AliasingCard sourceLoaded={false} />
      </section>
    );
  }

  const durationS =
    result === null ? 0 : result.meta.outputSampleCount / Math.max(1, result.meta.sampleRateHz);
  const targetIsPreset = SAMPLING_RATE_PRESETS.includes(
    settings.targetRateHz as (typeof SAMPLING_RATE_PRESETS)[number],
  );
  const laneLabels: Record<SamplingLaneKey, string> = {
    left: t("sampling.lane.left"),
    right: t("sampling.lane.right"),
  };

  function play(kind: "quantized" | "error"): void {
    const selected = laneResults[effectiveLane];
    if (selected === null || selected === undefined) {
      return;
    }
    if (channel.mode === "mono") {
      const installed = useSessionStore
        .getState()
        .setProcessed(selected[kind].slice(), selected.meta.sampleRateHz, "sampling");
      setFailed(!installed.ok);
      return;
    }
    const outputs: LaneResults =
      channel.mode === "both"
        ? { left: laneResults.left?.[kind], right: laneResults.right?.[kind] }
        : channel.mode === "right"
          ? { right: selected[kind] }
          : { left: selected[kind] };
    const combined = combineLaneOutputs(channel.mode, outputs);
    if (combined === null) {
      setFailed(true);
      return;
    }
    const installed = useSessionStore
      .getState()
      .setProcessed(combined, selected.meta.sampleRateHz, "sampling");
    setFailed(!installed.ok);
  }

  return (
    <section className="flex flex-col gap-4">
      <ToolHeader titleKey="tool.sampling.title" descriptionKey="tool.sampling.description" />

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
                  data-testid={`sampling.lane.${lane}`}
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
                data-testid="sampling.linkRight"
                checked={linked}
                onChange={(event) => {
                  setLinked(event.currentTarget.checked);
                }}
              />
              <span>{t("sampling.lane.link")}</span>
            </label>
            <p data-testid="sampling.lane.status" className="text-xs text-muted">
              {linked ? t("sampling.lane.linked") : t("sampling.lane.separate")}
            </p>
          </>
        ) : null}
        <p data-testid="sampling.lane.gridNote" className="text-xs text-muted">
          {t("sampling.lane.gridNote")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("sampling.controls.targetRate")}</span>
          <select
            value={targetIsPreset ? String(settings.targetRateHz) : "custom"}
            data-testid="sampling.control.targetRate"
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value !== "custom") {
                updateSettings({ targetRateHz: Number(value) });
              }
            }}
            className={INPUT_CLASSES}
          >
            {SAMPLING_RATE_PRESETS.map((rate) => (
              <option key={rate} value={rate}>
                {formatHz(rate)}
              </option>
            ))}
            {!targetIsPreset && <option value="custom">{t("sampling.controls.custom")}</option>}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("sampling.controls.customRate")}</span>
          <input
            type="number"
            min={SAMPLING_MIN_RATE_HZ}
            max={SAMPLING_MAX_RATE_HZ}
            step={1}
            value={settings.targetRateHz}
            data-testid="sampling.control.customRate"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (
                Number.isSafeInteger(value) &&
                value >= SAMPLING_MIN_RATE_HZ &&
                value <= SAMPLING_MAX_RATE_HZ
              ) {
                updateSettings({ targetRateHz: value });
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">
            {t("sampling.controls.bits")} <span dir="ltr">{laneSettings.bits}</span>
          </span>
          <input
            type="range"
            min={SAMPLING_MIN_BITS}
            max={SAMPLING_MAX_BITS}
            step={1}
            value={laneSettings.bits}
            data-testid="sampling.control.bits"
            onChange={(event) => {
              updateLaneSettings({ bits: Number(event.currentTarget.value) });
            }}
            className={CONTROL_FOCUS_CLASSES}
          />
        </label>

        <div className="flex flex-col gap-2 self-end text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.antiAlias}
              data-testid="sampling.control.antiAlias"
              onChange={(event) => {
                updateSettings({ antiAlias: event.currentTarget.checked });
              }}
              className={CONTROL_FOCUS_CLASSES}
            />
            <span>{t("sampling.controls.antiAlias")}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={laneSettings.dither}
              data-testid="sampling.control.dither"
              onChange={(event) => {
                updateLaneSettings({ dither: event.currentTarget.checked });
              }}
              className={CONTROL_FOCUS_CLASSES}
            />
            <span>{t("sampling.controls.dither")}</span>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span dir="ltr">
          {t("sampling.range.pattern", {
            start: formatS(settings.startSample / original.sampleRateHz),
            end: formatS(settings.endSample / original.sampleRateHz),
          })}
        </span>
        <Button
          size="sm"
          variant="outline"
          data-testid="sampling.apply.preview"
          onClick={() => {
            updateSettings(previewRange);
          }}
        >
          {t("sampling.apply.preview")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="sampling.apply.whole"
          onClick={() => {
            updateSettings({ startSample: 0, endSample: original.samples.length });
          }}
        >
          {t("sampling.apply.whole")}
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded border border-surface p-3">
        <h3 className="text-sm font-semibold">{t("sampling.result.title")}</h3>
        {failed ? (
          <p data-testid="sampling.error" role="alert" className="text-sm text-danger">
            {t("sampling.error.failed")}
          </p>
        ) : busy ? (
          <p data-testid="sampling.status" className="text-sm text-muted">
            {t("sampling.status.computing")}
          </p>
        ) : result !== null ? (
          <>
            <dl className="flex flex-wrap gap-4 text-xs text-muted">
              <div className="flex items-center gap-1">
                <dt>{t("sampling.metrics.snr")}</dt>
                <dd dir="ltr" data-testid="sampling.metric.snr" className="tabular-nums">
                  {formatDb(result.meta.snrDb)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("sampling.metrics.segmentalSnr")}</dt>
                <dd dir="ltr" data-testid="sampling.metric.segmentalSnr" className="tabular-nums">
                  {formatDb(result.meta.segmentalSnrDb)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("sampling.metrics.psnr")}</dt>
                <dd dir="ltr" data-testid="sampling.metric.psnr" className="tabular-nums">
                  {formatDb(result.meta.psnrDb)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("sampling.metrics.theorySnr")}</dt>
                <dd dir="ltr" data-testid="sampling.metric.theorySnr" className="tabular-nums">
                  {formatDb(result.meta.theorySnrDb)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("sampling.metrics.mse")}</dt>
                <dd dir="ltr" data-testid="sampling.metric.mse" className="tabular-nums">
                  {result.meta.mse.toExponential(2)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("sampling.metrics.duration")}</dt>
                <dd dir="ltr" data-testid="sampling.metric.duration" className="tabular-nums">
                  {formatS(durationS)}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted">{t("sampling.metrics.psnrNote")}</p>
            <p className="text-xs text-muted">{t("sampling.metrics.theoryNote")}</p>

            {channel.mode === "both" && (
              <table data-testid="sampling.metrics.lanes" className="w-full text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="text-start font-medium">{t("sampling.lane.label")}</th>
                    <th className="text-start font-medium">{t("sampling.metrics.snr")}</th>
                    <th className="text-start font-medium">{t("sampling.metrics.segmentalSnr")}</th>
                    <th className="text-start font-medium">{t("sampling.metrics.psnr")}</th>
                    <th className="text-start font-medium">{t("sampling.metrics.mse")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(["left", "right"] as const).map((lane) => {
                    const laneResult = laneResults[lane];
                    return (
                      <tr key={lane} data-testid={`sampling.metrics.lane.${lane}`}>
                        <td>{laneLabels[lane]}</td>
                        <td dir="ltr" className="tabular-nums">
                          {laneResult === undefined ? "—" : formatDb(laneResult.meta.snrDb)}
                        </td>
                        <td dir="ltr" className="tabular-nums">
                          {laneResult === undefined
                            ? "—"
                            : formatDb(laneResult.meta.segmentalSnrDb)}
                        </td>
                        <td dir="ltr" className="tabular-nums">
                          {laneResult === undefined ? "—" : formatDb(laneResult.meta.psnrDb)}
                        </td>
                        <td dir="ltr" className="tabular-nums">
                          {laneResult === undefined ? "—" : laneResult.meta.mse.toExponential(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <figure className="flex flex-col gap-1">
                <MiniWaveform
                  samples={result.reference}
                  ariaLabel={t("sampling.result.beforeAria")}
                  testId="sampling.result.before"
                />
                <figcaption className="text-xs text-muted">
                  {t("sampling.result.before")}
                </figcaption>
              </figure>
              <figure className="flex flex-col gap-1">
                <MiniWaveform
                  samples={result.quantized}
                  ariaLabel={t("sampling.result.afterAria")}
                  testId="sampling.result.after"
                />
                <figcaption className="text-xs text-muted">{t("sampling.result.after")}</figcaption>
              </figure>
            </div>

            <ErrorChart
              error={result.error}
              sampleRateHz={result.meta.sampleRateHz}
              ariaLabel={t("sampling.result.errorAria")}
              xLabel={t("sampling.result.timeAxis")}
              yLabel={t("sampling.result.errorAxis")}
            />

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                data-testid="sampling.play.processed"
                onClick={() => {
                  play("quantized");
                }}
              >
                {t("sampling.play.processed")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="sampling.play.residual"
                onClick={() => {
                  play("error");
                }}
              >
                {t("sampling.play.residual")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="sampling.reset"
                onClick={() => {
                  useSessionStore.getState().clearProcessed();
                }}
              >
                {t("player.reset")}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">{t("sampling.status.idle")}</p>
        )}
      </div>

      <AliasingCard sourceLoaded />

      <aside className="rounded border border-surface p-3 text-sm">
        <h3 className="mb-2 font-semibold">{t("sampling.observe.title")}</h3>
        <ul className="list-disc space-y-1 ps-5 text-muted">
          <li>{t("sampling.observe.aliasing")}</li>
          <li>{t("sampling.observe.dither")}</li>
          <li>{t("sampling.observe.snr")}</li>
        </ul>
      </aside>

      <TheoryPanel
        titleKey={TOOL_THEORY.sampling.titleKey}
        sections={TOOL_THEORY.sampling.sections}
      />
    </section>
  );
}
