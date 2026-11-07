/**
 * F09 spectrum editor (Wave-3 Plan 05 Task 3): band edits on Re/Im/magnitude/
 * phase of one rectangular-window frame, Hermitian ON/OFF, presets, and
 * playback of the IFFT result through the processed lane.
 *
 * The store owns every worker call (R23); this view only unpacks the packed
 * Float64 payload `[samples | re | im | mag | phase]`. Charts are uPlot and
 * stay LTR (AGENTS §6). The 200 ms debounce matches the other Wave-3 labs.
 */

import type {
  SpectrumCurveEdit,
  SpectrumCurvePoint,
  SpectrumCurveTarget,
  SpectrumEdit,
  SpectrumEditMode,
  SpectrumEditTarget,
} from "@avalab/dsp";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import uPlot from "uplot";
import { ToolHeader } from "../../components/ToolHeader";
import "uplot/dist/uPlot.min.css";

import { Button } from "../../components/ui/button";
import type { ChannelMode } from "../../lib/channel";
import { formatHz, formatS } from "../../lib/format";
import { combineLaneResults, type LaneResults } from "../../lib/laneCombine";
import {
  laneParamsLinked,
  relinkLaneParams,
  resolveLaneParams,
  setPrimaryLane,
  setRightLane,
  unlinkLaneParams,
} from "../../lib/laneParams";
import { FFT_MAX_LENGTH, type SpectrumEditResult } from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { ChannelPicker } from "../channels/ChannelPicker";
import { useChannelMode } from "../channels/useChannelMode";
import { UploadEmptyState } from "../input/upload";
import { TheoryPanel } from "../theory/TheoryPanel";
import { TOOL_THEORY } from "../theory/theoryContent";
import { CurveCanvas } from "./curveCanvas";
import {
  CURVE_URL_KEY,
  isCurveTarget,
  MAX_CURVE_POINTS,
  SPECTRUM_CURVE_TARGETS,
} from "./curveState";
import {
  binsFromHz,
  loadSpectrumEditPair,
  presetEdits,
  SPECTRUM_EDIT_MODES,
  SPECTRUM_EDIT_PRESETS,
  SPECTRUM_EDIT_TARGETS,
  type SpectrumEditLaneSettings,
  type SpectrumEditPairSettings,
  type SpectrumEditPreset,
  type SpectrumEditSettings,
  saveSpectrumEditPair,
  spectrumEditPairFromSearch,
  spectrumEditPairToSearch,
} from "./spectrumEditState";

const PLOT_HEIGHT_PX = 180;
const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;
const DEBOUNCE_MS = 200;
const RE_COLOR = "#38bdf8";
const IM_COLOR = "#f472b6";
const MAG_COLOR = "#34d399";
const PHASE_COLOR = "#f59e0b";

type SpectrumEditViewResult = {
  readonly meta: SpectrumEditResult["meta"];
  readonly samples: Float32Array;
  readonly re: Float64Array;
  readonly im: Float64Array;
  readonly magnitude: Float64Array;
  readonly phase: Float64Array;
};

function unpackResult(outcome: {
  meta: SpectrumEditResult["meta"];
  payload?: { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
}): SpectrumEditViewResult | null {
  if (outcome.payload === undefined) {
    return null;
  }
  const values = new Float64Array(
    outcome.payload.buffer,
    outcome.payload.byteOffset,
    outcome.payload.byteLength / 8,
  );
  const { sampleCount, binCount } = outcome.meta;
  if (values.length !== sampleCount + binCount * 4) {
    return null;
  }
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = values[index] ?? 0;
  }
  return {
    meta: outcome.meta,
    samples,
    re: values.subarray(sampleCount, sampleCount + binCount),
    im: values.subarray(sampleCount + binCount, sampleCount + binCount * 2),
    magnitude: values.subarray(sampleCount + binCount * 2, sampleCount + binCount * 3),
    phase: values.subarray(sampleCount + binCount * 3, sampleCount + binCount * 4),
  };
}

function designTargets(
  mode: ChannelMode,
  effectiveLane: "left" | "right",
): readonly ("left" | "right")[] {
  if (mode === "mono" || mode === "left") {
    return ["left"];
  }
  if (mode === "right") {
    return ["right"];
  }
  return [effectiveLane, effectiveLane === "left" ? "right" : "left"];
}

function paramsFor(
  lane: SpectrumEditLaneSettings,
  startSample: number,
  endSample: number,
  sampleRateHz: number,
): {
  readonly sampleRateHz: number;
  readonly startSample: number;
  readonly endSample: number;
  readonly edits: readonly SpectrumEdit[];
  readonly curves: readonly SpectrumCurveEdit[];
  readonly hermitian: boolean;
} {
  return {
    sampleRateHz,
    startSample,
    endSample,
    edits: lane.edits,
    curves: lane.curves,
    hermitian: lane.hermitian,
  };
}

function EditChart({
  frequencies,
  values,
  label,
  yFormatter,
  stroke,
  testId,
}: {
  readonly frequencies: Float64Array;
  readonly values: Float64Array;
  readonly label: string;
  readonly yFormatter: (value: number) => string;
  readonly stroke: string;
  readonly testId: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(480);

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
      legend: { show: false },
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false } },
      axes: [
        {
          label: "Hz",
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.18)" },
          ticks: { stroke: "rgba(148,163,184,0.35)" },
          font: "10px ui-monospace, monospace",
          values: (_self, splits) => splits.map((value) => formatHz(value)),
        },
        {
          label,
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.18)" },
          ticks: { stroke: "rgba(148,163,184,0.35)" },
          font: "10px ui-monospace, monospace",
          size: 56,
          values: (_self, splits) => splits.map((value) => yFormatter(value)),
        },
      ],
      series: [{}, { label, stroke, width: 1, points: { show: false } }],
    };
    const plot = new uPlot(options, [frequencies, values], host);
    return () => {
      plot.destroy();
    };
  }, [frequencies, values, widthPx, label, yFormatter, stroke]);

  return (
    <div className="min-w-0 rounded border border-surface p-2">
      <div ref={hostRef} dir="ltr" role="img" aria-label={label} data-testid={testId} />
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

export function SpectrumEditView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const [searchParams, setSearchParams] = useSearchParams();
  const channel = useChannelMode(original, "both");
  const search = searchParams.toString();
  const pair = useMemo(() => {
    const source = {
      sampleCount: original?.samples.length ?? 0,
      sampleRateHz: original?.sampleRateHz ?? 1,
    };
    return search === ""
      ? loadSpectrumEditPair(source, selection)
      : spectrumEditPairFromSearch(`?${search}`, source, selection);
  }, [search, original, selection]);
  const resolved = useMemo(() => resolveLaneParams(pair.lanes), [pair.lanes]);
  const effectiveLane =
    channel.mode === "both" ? pair.editLane : channel.mode === "right" ? "right" : "left";
  const settings = useMemo<SpectrumEditSettings>(
    () => ({
      ...resolved[effectiveLane],
      startSample: pair.startSample,
      endSample: pair.endSample,
    }),
    [resolved, effectiveLane, pair.startSample, pair.endSample],
  );
  const linked = laneParamsLinked(pair.lanes);

  useEffect(() => {
    saveSpectrumEditPair(pair);
  }, [pair]);

  function writePair(nextPair: SpectrumEditPairSettings): void {
    const params = new URLSearchParams(searchParams);
    for (const key of Array.from(params.keys())) {
      if (key === "el" || key === CURVE_URL_KEY || (key.startsWith("rr") && key.length > 2)) {
        params.delete(key);
      }
    }
    for (const [key, value] of new URLSearchParams(spectrumEditPairToSearch(nextPair))) {
      params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  }

  function updateSettings(patch: Partial<SpectrumEditLaneSettings>): void {
    const current = effectiveLane === "right" ? resolved.right : pair.lanes.primary;
    const next = { ...current, ...patch };
    const lanes =
      effectiveLane === "right" ? setRightLane(pair.lanes, next) : setPrimaryLane(pair.lanes, next);
    writePair({ ...pair, lanes });
  }

  function selectEditLane(lane: "left" | "right"): void {
    writePair({ ...pair, editLane: lane });
  }

  function setLinked(nextLinked: boolean): void {
    const lanes = nextLinked ? relinkLaneParams(pair.lanes) : unlinkLaneParams(pair.lanes);
    writePair({ ...pair, lanes });
  }

  const [laneResults, setLaneResults] = useState<
    Partial<Record<"left" | "right", SpectrumEditViewResult>>
  >({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [bandStartHz, setBandStartHz] = useState(500);
  const [bandEndHz, setBandEndHz] = useState(2000);
  const [target, setTarget] = useState<SpectrumEditTarget>("mag");
  const [mode, setMode] = useState<SpectrumEditMode>("zero");
  const [value, setValue] = useState(0);
  const [curveTarget, setCurveTarget] = useState<SpectrumCurveTarget>("mag");
  const [curveDraft, setCurveDraft] = useState<readonly SpectrumCurvePoint[]>([]);
  const generationRef = useRef(0);

  const rangeStart = Math.max(0, Math.min(settings.startSample, original?.samples.length ?? 0));
  const rangeEnd = Math.max(
    rangeStart,
    Math.min(settings.endSample, original?.samples.length ?? 0),
  );
  const analysisStart = rangeStart;
  const analysisEnd = Math.min(rangeEnd, rangeStart + FFT_MAX_LENGTH);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setFailed(false);
    if (original === null || analysisEnd <= analysisStart) {
      setLaneResults({});
      setBusy(false);
      return;
    }
    setBusy(true);
    let tickets: { readonly key: string }[] = [];
    const timer = window.setTimeout(() => {
      const pending = designTargets(channel.mode, effectiveLane).map((targetLane) => {
        const laneSettings = resolved[targetLane];
        const ticket =
          channel.mode === "mono"
            ? useSessionStore
                .getState()
                .deriveWithSourceSlice(
                  "spectrumEdit",
                  paramsFor(laneSettings, rangeStart, rangeEnd, original.sampleRateHz),
                  analysisStart,
                  analysisEnd,
                )
            : useSessionStore
                .getState()
                .deriveWithSourceSliceLane(
                  "spectrumEdit",
                  paramsFor(laneSettings, rangeStart, rangeEnd, original.sampleRateHz),
                  analysisStart,
                  analysisEnd,
                  targetLane === "right" ? 1 : 0,
                );
        return { lane: targetLane, ticket };
      });
      tickets = pending.map((entry) => entry.ticket);
      void Promise.all(
        pending.map(async (entry) => ({ lane: entry.lane, outcome: await entry.ticket.outcome })),
      ).then(
        (settled) => {
          if (generationRef.current !== generation) {
            return;
          }
          const next: Partial<Record<"left" | "right", SpectrumEditViewResult>> = {};
          for (const { lane, outcome } of settled) {
            if ("cancelled" in outcome) {
              return;
            }
            const unpacked = unpackResult(outcome);
            if (unpacked === null) {
              setLaneResults({});
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
            setLaneResults({});
            setBusy(false);
            setFailed(true);
          }
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      for (const ticket of tickets) {
        useSessionStore.getState().cancel(ticket.key);
      }
    };
  }, [
    original,
    channel.mode,
    effectiveLane,
    resolved,
    rangeStart,
    rangeEnd,
    analysisStart,
    analysisEnd,
  ]);

  const result = laneResults[effectiveLane] ?? null;

  function playResult(): void {
    if (result === null || original === null) {
      return;
    }
    if (channel.mode === "mono") {
      const installed = useSessionStore
        .getState()
        .setProcessed(result.samples.slice(), result.meta.sampleRateHz, "spectrumEdit");
      setFailed(!installed.ok);
      return;
    }
    let results: LaneResults;
    if (channel.mode === "both") {
      const left = laneResults.left;
      const right = laneResults.right;
      if (left === undefined || right === undefined) {
        setFailed(true);
        return;
      }
      const sampleCount = result.meta.sampleCount;
      if (left.meta.sampleCount !== sampleCount || right.meta.sampleCount !== sampleCount) {
        setFailed(true);
        return;
      }
      results = { left: left.samples, right: right.samples };
    } else if (channel.mode === "right") {
      results = { right: result.samples };
    } else {
      results = { left: result.samples };
    }
    const combined = combineLaneResults(
      channel.mode,
      original.channels,
      analysisStart,
      result.meta.sampleCount,
      results,
    );
    if (combined === null) {
      setFailed(true);
      return;
    }
    const installed = useSessionStore
      .getState()
      .setProcessed(combined, original.sampleRateHz, "spectrumEdit");
    setFailed(!installed.ok);
  }

  const targetLabels: Record<SpectrumEditTarget, string> = {
    re: t("spectrumEdit.target.re"),
    im: t("spectrumEdit.target.im"),
    mag: t("spectrumEdit.target.mag"),
    phase: t("spectrumEdit.target.phase"),
  };
  const modeLabels: Record<SpectrumEditMode, string> = {
    zero: t("spectrumEdit.mode.zero"),
    scale: t("spectrumEdit.mode.scale"),
    set: t("spectrumEdit.mode.set"),
  };
  const laneLabels = {
    left: t("spectrumEdit.lane.left"),
    right: t("spectrumEdit.lane.right"),
  } as const;
  const presetLabels: Record<SpectrumEditPreset, string> = {
    zeroIm: t("spectrumEdit.preset.zeroIm"),
    zeroRe: t("spectrumEdit.preset.zeroRe"),
    zeroPhase: t("spectrumEdit.preset.zeroPhase"),
    linearPhase: t("spectrumEdit.preset.linearPhase"),
    randomPhase: t("spectrumEdit.preset.randomPhase"),
    magnitudeOnly: t("spectrumEdit.preset.magnitudeOnly"),
    phaseOnly: t("spectrumEdit.preset.phaseOnly"),
  };

  const editRows = useMemo(() => {
    const occurrences = new Map<string, number>();
    return settings.edits.map((edit: SpectrumEdit, index: number) => {
      const base = `${edit.startBin}:${edit.endBin}:${edit.target}:${edit.mode}:${edit.value}`;
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      return { edit, index, key: `${base}:${occurrence}` };
    });
  }, [settings.edits]);

  const curveValues = useMemo(() => {
    if (result === null) {
      return new Float64Array(0);
    }
    if (curveTarget === "mag") {
      return result.magnitude;
    }
    if (curveTarget === "phase") {
      return result.phase;
    }
    return curveTarget === "re" ? result.re : result.im;
  }, [result, curveTarget]);

  const frequencies = useMemo(() => {
    if (result === null) {
      return new Float64Array(0);
    }
    const bins = new Float64Array(result.meta.binCount);
    for (let bin = 0; bin < bins.length; bin += 1) {
      bins[bin] = bin * result.meta.frequencyResolutionHz;
    }
    return bins;
  }, [result]);

  function addEdit(): void {
    if (result === null || !Number.isFinite(value)) {
      return;
    }
    const bins = binsFromHz(
      bandStartHz,
      bandEndHz,
      result.meta.sampleRateHz,
      result.meta.fftLengthSamples,
    );
    if (bins.endBin <= bins.startBin) {
      return;
    }
    updateSettings({
      edits: [...settings.edits, { ...bins, target, mode, value }],
    });
  }

  function applyCurve(): void {
    if (curveDraft.length < 2) {
      return;
    }
    updateSettings({
      curves: [
        ...settings.curves.filter((curve) => curve.target !== curveTarget),
        { target: curveTarget, points: curveDraft },
      ],
    });
    setCurveDraft([]);
  }

  function clearCurve(): void {
    updateSettings({
      curves: settings.curves.filter((curve) => curve.target !== curveTarget),
    });
    setCurveDraft([]);
  }

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <ToolHeader
          titleKey="tool.spectrumEdit.title"
          descriptionKey="tool.spectrumEdit.description"
        />
        <UploadEmptyState />
      </section>
    );
  }

  const numberFormatter = (entry: number): string => entry.toPrecision(3);
  const phaseFormatter = (entry: number): string => `${entry.toFixed(2)} rad`;

  return (
    <section className="flex flex-col gap-4">
      <ToolHeader
        titleKey="tool.spectrumEdit.title"
        descriptionKey="tool.spectrumEdit.description"
      />

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
                  data-testid={`spectrumEdit.lane.${lane}`}
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
                data-testid="spectrumEdit.linkRight"
                checked={linked}
                onChange={(event) => {
                  setLinked(event.currentTarget.checked);
                }}
              />
              <span>{t("spectrumEdit.lane.link")}</span>
            </label>
            <p data-testid="spectrumEdit.lane.status" className="text-xs text-muted">
              {linked ? t("spectrumEdit.lane.linked") : t("spectrumEdit.lane.separate")}
            </p>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("spectrumEdit.controls.bandStart")}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={bandStartHz}
            data-testid="spectrumEdit.control.bandStart"
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next)) {
                setBandStartHz(next);
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("spectrumEdit.controls.bandEnd")}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={bandEndHz}
            data-testid="spectrumEdit.control.bandEnd"
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next)) {
                setBandEndHz(next);
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("spectrumEdit.controls.target")}</span>
          <select
            value={target}
            data-testid="spectrumEdit.control.target"
            onChange={(event) => {
              const next = event.currentTarget.value;
              if ((SPECTRUM_EDIT_TARGETS as readonly string[]).includes(next)) {
                setTarget(next as SpectrumEditTarget);
              }
            }}
            className={INPUT_CLASSES}
          >
            {(["re", "im", "mag", "phase"] as const).map((entry) => (
              <option key={entry} value={entry}>
                {targetLabels[entry]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("spectrumEdit.controls.mode")}</span>
          <select
            value={mode}
            data-testid="spectrumEdit.control.mode"
            onChange={(event) => {
              const next = event.currentTarget.value;
              if ((SPECTRUM_EDIT_MODES as readonly string[]).includes(next)) {
                setMode(next as SpectrumEditMode);
              }
            }}
            className={INPUT_CLASSES}
          >
            {SPECTRUM_EDIT_MODES.map((entry) => (
              <option key={entry} value={entry}>
                {modeLabels[entry]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("spectrumEdit.controls.value")}</span>
          <input
            type="number"
            step={0.1}
            value={value}
            data-testid="spectrumEdit.control.value"
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next)) {
                setValue(next);
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={settings.hermitian}
            data-testid="spectrumEdit.control.hermitian"
            onChange={(event) => {
              updateSettings({ hermitian: event.currentTarget.checked });
            }}
            className={CONTROL_FOCUS_CLASSES}
          />
          <span>{t("spectrumEdit.controls.hermitian")}</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={result === null}
          data-testid="spectrumEdit.add"
          onClick={addEdit}
        >
          {t("spectrumEdit.controls.add")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={settings.edits.length === 0}
          data-testid="spectrumEdit.clear"
          onClick={() => {
            updateSettings({ edits: [] });
          }}
        >
          {t("spectrumEdit.controls.clear")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{t("spectrumEdit.preset.title")}</span>
        {SPECTRUM_EDIT_PRESETS.map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant="outline"
            disabled={result === null}
            data-testid={`spectrumEdit.preset.${preset}`}
            onClick={() => {
              if (result !== null) {
                updateSettings({ edits: presetEdits(preset, result.meta.binCount) });
              }
            }}
          >
            {presetLabels[preset]}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded border border-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("spectrumEdit.curve.title")}</h3>
          <label className="flex items-center gap-2 text-xs">
            <span>{t("spectrumEdit.curve.target")}</span>
            <select
              value={curveTarget}
              data-testid="spectrumEdit.curve.target"
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (isCurveTarget(next)) {
                  setCurveTarget(next);
                  setCurveDraft([]);
                }
              }}
              className={INPUT_CLASSES}
            >
              {SPECTRUM_CURVE_TARGETS.map((entry) => (
                <option key={entry} value={entry}>
                  {targetLabels[entry]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <CurveCanvas
          binCount={result?.meta.binCount ?? 1}
          values={curveValues}
          target={curveTarget}
          points={curveDraft.slice(0, MAX_CURVE_POINTS)}
          committed={settings.curves
            .filter((curve) => curve.target === curveTarget)
            .flatMap((curve) => curve.points)}
          onChange={(points) => {
            setCurveDraft(points);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={curveDraft.length < 2}
            data-testid="spectrumEdit.curve.apply"
            onClick={applyCurve}
          >
            {t("spectrumEdit.curve.apply")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={curveDraft.length === 0}
            data-testid="spectrumEdit.curve.undo"
            onClick={() => {
              setCurveDraft((points) => points.slice(0, -1));
            }}
          >
            {t("spectrumEdit.curve.undo")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={curveDraft.length === 0 && settings.curves.length === 0}
            data-testid="spectrumEdit.curve.clear"
            onClick={clearCurve}
          >
            {t("spectrumEdit.curve.clear")}
          </Button>
          <span className="text-xs text-muted" data-testid="spectrumEdit.curve.count">
            {t("spectrumEdit.curve.points", { count: curveDraft.length })}
          </span>
        </div>
      </div>

      <div className="rounded border border-surface p-3 text-xs text-muted">
        <p data-testid="spectrumEdit.range">
          {t("spectrumEdit.range.pattern", {
            start: formatS(rangeStart / original.sampleRateHz),
            end: formatS(rangeEnd / original.sampleRateHz),
          })}
        </p>
        <p data-testid="spectrumEdit.range.hint">{t("spectrumEdit.range.hint")}</p>
      </div>

      {!settings.hermitian ? (
        <p
          data-testid="spectrumEdit.warning.hermitian"
          role="status"
          className="text-sm text-danger"
        >
          {t("spectrumEdit.warning.hermitianOff")}
        </p>
      ) : null}

      {result?.meta.capped === true ? (
        <p data-testid="spectrumEdit.cap" className="text-sm text-muted">
          {t("spectrumEdit.cap.notice")}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 rounded border border-surface p-3">
        <h3 className="text-sm font-semibold">{t("spectrumEdit.controls.edits")}</h3>
        {failed ? (
          <p data-testid="spectrumEdit.error" role="alert" className="text-sm text-danger">
            {t("spectrumEdit.error.failed")}
          </p>
        ) : busy ? (
          <p data-testid="spectrumEdit.status" className="text-sm text-muted">
            {t("spectrumEdit.status.computing")}
          </p>
        ) : result === null ? (
          <p className="text-sm text-muted">{t("spectrumEdit.status.empty")}</p>
        ) : (
          <>
            <dl className="flex flex-wrap gap-4 text-xs text-muted">
              <MetaItem
                label={t("spectrumEdit.meta.channel")}
                value={laneLabels[effectiveLane]}
                testId="spectrumEdit.meta.channel"
              />
              <MetaItem
                label={t("spectrumEdit.meta.sampleCount")}
                value={String(result.meta.sampleCount)}
                testId="spectrumEdit.meta.sampleCount"
              />
              <MetaItem
                label={t("spectrumEdit.meta.fftLength")}
                value={String(result.meta.fftLengthSamples)}
                testId="spectrumEdit.meta.fftLength"
              />
              <MetaItem
                label={t("spectrumEdit.meta.binWidth")}
                value={`${result.meta.frequencyResolutionHz.toFixed(4)} Hz`}
                testId="spectrumEdit.meta.binWidth"
              />
              <MetaItem
                label={t("spectrumEdit.meta.imaginaryRatio")}
                value={result.meta.imaginaryEnergyRatio.toExponential(3)}
                testId="spectrumEdit.meta.imaginaryRatio"
              />
            </dl>
            <ul className="flex flex-col gap-1 text-xs">
              {settings.edits.length === 0 ? (
                <li className="text-muted">{t("spectrumEdit.edits.empty")}</li>
              ) : (
                editRows.map(({ edit, index, key }) => (
                  <li key={key} className="flex items-center gap-2">
                    <code dir="ltr" data-testid="spectrumEdit.edit.item">
                      {t("spectrumEdit.edits.item", {
                        start: edit.startBin,
                        end: edit.endBin,
                        target: targetLabels[edit.target],
                        mode: modeLabels[edit.mode],
                        value: edit.value,
                      })}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`spectrumEdit.remove.${index}`}
                      onClick={() => {
                        updateSettings({
                          edits: settings.edits.filter((_, entryIndex) => entryIndex !== index),
                        });
                      }}
                    >
                      {t("spectrumEdit.controls.remove")}
                    </Button>
                  </li>
                ))
              )}
            </ul>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <EditChart
                frequencies={frequencies}
                values={result.re}
                label={t("spectrumEdit.chart.re")}
                yFormatter={numberFormatter}
                stroke={RE_COLOR}
                testId="spectrumEdit.chart.re"
              />
              <EditChart
                frequencies={frequencies}
                values={result.im}
                label={t("spectrumEdit.chart.im")}
                yFormatter={numberFormatter}
                stroke={IM_COLOR}
                testId="spectrumEdit.chart.im"
              />
              <EditChart
                frequencies={frequencies}
                values={result.magnitude}
                label={t("spectrumEdit.chart.magnitude")}
                yFormatter={numberFormatter}
                stroke={MAG_COLOR}
                testId="spectrumEdit.chart.magnitude"
              />
              <EditChart
                frequencies={frequencies}
                values={result.phase}
                label={t("spectrumEdit.chart.phase")}
                yFormatter={phaseFormatter}
                stroke={PHASE_COLOR}
                testId="spectrumEdit.chart.phase"
              />
            </div>
            <Button
              size="sm"
              data-testid="spectrumEdit.play"
              onClick={playResult}
              className="self-start"
            >
              {t("spectrumEdit.play")}
            </Button>
          </>
        )}
      </div>

      <div className="rounded border border-surface p-3 text-sm">
        <h3 className="text-sm font-semibold">{t("spectrumEdit.observe.title")}</h3>
        <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs text-muted">
          <li>{t("spectrumEdit.observe.magnitude")}</li>
          <li>{t("spectrumEdit.observe.phase")}</li>
          <li>{t("spectrumEdit.observe.hermitian")}</li>
          <li>{t("spectrumEdit.observe.gibbs")}</li>
        </ul>
      </div>

      <TheoryPanel
        titleKey={TOOL_THEORY["spectrum-edit"].titleKey}
        sections={TOOL_THEORY["spectrum-edit"].sections}
      />
    </section>
  );
}
