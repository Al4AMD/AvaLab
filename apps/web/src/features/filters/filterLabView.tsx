/**
 * F11 filter design lab (Wave-5 Plan 04 Task 4).
 *
 * Design and apply both run in the worker: `filterDesign` returns one `{b,a}`
 * pair plus the analysis arrays the plots draw, and `filterApply` filters the
 * selected excerpt (or the whole source) through FFT convolution or direct
 * form II. The view only maps URL state, paints the returned arrays and
 * installs settled audio into the processed-playback lane.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { ToolHeader } from "../../components/ToolHeader";

import { Button } from "../../components/ui/button";
import { downloadWav } from "../../lib/download";
import { formatDb, formatHz, formatS } from "../../lib/format";
import { combineLaneResults, type LaneResults } from "../../lib/laneCombine";
import {
  laneParamsLinked,
  relinkLaneParams,
  resolveLaneParams,
  setPrimaryLane,
  setRightLane,
  unlinkLaneParams,
} from "../../lib/laneParams";
import type {
  FilterApplyParams,
  FilterBand,
  FilterDesignKind,
  FilterDesignParams,
  FilterDesignResult,
  FilterWindowKind,
} from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { ChannelPicker } from "../channels/ChannelPicker";
import { useChannelMode } from "../channels/useChannelMode";
import { UploadEmptyState } from "../input/upload";
import { TheoryPanel } from "../theory/TheoryPanel";
import { TOOL_THEORY } from "../theory/theoryContent";
import { FilterLinePlot } from "./filterPlots";
import {
  FILTER_DESIGN_KINDS,
  FILTER_WINDOWS,
  type FilterEditLane,
  type FilterPairSettings,
  type FilterSettings,
  filterPairAtRate,
  filterPairFromSearch,
  filterPairToSearch,
  loadFilterPair,
  saveFilterPair,
} from "./filterState";
import { PoleZeroPlot } from "./poleZeroPlot";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;
const FILTER_PREVIEW_SECONDS = 30;
const DESIGN_DEBOUNCE_MS = 150;
const PROCESSED_LABEL = "filters";

export type FilterAppliedRange = {
  readonly startSample: number;
  readonly endSample: number;
  readonly delaySamples: number;
  readonly rightDelaySamples?: number;
};

export type FilterLabPanelProps = {
  readonly settings: FilterSettings;
  readonly onSettingsChange: (patch: Partial<FilterSettings>) => void;
  readonly design: FilterDesignResult | null;
  readonly designBusy: boolean;
  readonly designError: string | null;
  readonly onApply: (scope: "selection" | "all") => void;
  readonly applyBusy: boolean;
  readonly applyError: string | null;
  readonly applied: FilterAppliedRange | null;
  readonly exportAvailable?: boolean;
  readonly onExportWav?: () => void;
  readonly channelControls?: React.ReactNode;
  readonly rightDelaySamples?: number;
};

export function filterBandsForKind(kind: FilterDesignKind): readonly FilterBand[] {
  return kind === "biquad"
    ? ["lowpass", "highpass", "notch", "peaking"]
    : ["lowpass", "highpass", "bandpass", "bandstop"];
}

export function filterDesignParams(settings: FilterSettings): FilterDesignParams {
  return {
    kind: settings.kind,
    band: settings.band,
    cutoffHz: settings.cutoffHz,
    cutoff2Hz: settings.cutoff2Hz,
    order: settings.order,
    taps: settings.taps,
    window: settings.window,
    rippleDb: settings.rippleDb,
    q: settings.q,
    gainDb: settings.gainDb,
    sampleRateHz: settings.sampleRateHz,
  };
}

export function filterApplyParams(
  settings: FilterSettings,
  design: FilterDesignResult,
): FilterApplyParams {
  return {
    b: design.b,
    a: design.a,
    fir: settings.kind === "fir",
    sampleRateHz: settings.sampleRateHz,
    compensateDelay: true,
  };
}

function clampRange(startSample: number, endSample: number, sampleCount: number) {
  const start = Math.max(0, Math.min(Math.round(startSample), sampleCount));
  const end = Math.max(start, Math.min(Math.round(endSample), sampleCount));
  return { startSample: start, endSample: end };
}

/** Apply scope: the current selection, or the first 30 s when the selection
 * is the whole source (AGENTS §9 live-preview budget). "all" is explicit. */
export function filterApplyRange(
  scope: "selection" | "all",
  selection: { readonly startSample: number; readonly endSample: number },
  sampleCount: number,
  sampleRateHz: number,
): { readonly startSample: number; readonly endSample: number } {
  if (sampleCount <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  if (scope === "all") {
    return { startSample: 0, endSample: sampleCount };
  }
  const selected = clampRange(selection.startSample, selection.endSample, sampleCount);
  const isSubSelection = selected.startSample > 0 || selected.endSample < sampleCount;
  if (isSubSelection && selected.endSample > selected.startSample) {
    return selected;
  }
  const previewEnd = Math.min(sampleCount, Math.round(FILTER_PREVIEW_SECONDS * sampleRateHz));
  return { startSample: 0, endSample: previewEnd };
}

export function filterSettingsValid(settings: FilterSettings): boolean {
  if (
    !Number.isInteger(settings.sampleRateHz) ||
    settings.sampleRateHz < 1_000 ||
    settings.sampleRateHz > 96_000
  ) {
    return false;
  }
  if (!filterBandsForKind(settings.kind).includes(settings.band)) {
    return false;
  }
  const nyquistHz = settings.sampleRateHz / 2;
  if (
    !Number.isFinite(settings.cutoffHz) ||
    settings.cutoffHz <= 0 ||
    settings.cutoffHz >= nyquistHz
  ) {
    return false;
  }
  if (settings.band === "bandpass" || settings.band === "bandstop") {
    if (
      !Number.isFinite(settings.cutoff2Hz) ||
      settings.cutoff2Hz <= settings.cutoffHz ||
      settings.cutoff2Hz >= nyquistHz
    ) {
      return false;
    }
  }
  if (settings.kind === "fir") {
    return (
      Number.isInteger(settings.taps) &&
      settings.taps >= 3 &&
      settings.taps <= 257 &&
      settings.taps % 2 === 1 &&
      FILTER_WINDOWS.includes(settings.window)
    );
  }
  if (settings.kind === "biquad") {
    return Number.isFinite(settings.q) && settings.q > 0 && Number.isFinite(settings.gainDb);
  }
  return (
    Number.isInteger(settings.order) &&
    settings.order >= 1 &&
    settings.order <= 8 &&
    (settings.kind !== "chebyshev1" ||
      (Number.isFinite(settings.rippleDb) && settings.rippleDb >= 0.1 && settings.rippleDb <= 3))
  );
}

function selectLabel(
  t: (key: string) => string,
  group: "kinds" | "bands" | "windows",
  value: FilterDesignKind | FilterBand | FilterWindowKind,
): string {
  if (group === "kinds") {
    switch (value) {
      case "fir":
        return t("filters.kinds.fir");
      case "butterworth":
        return t("filters.kinds.butterworth");
      case "chebyshev1":
        return t("filters.kinds.chebyshev1");
      case "biquad":
        return t("filters.kinds.biquad");
    }
  }
  if (group === "bands") {
    switch (value) {
      case "lowpass":
        return t("filters.bands.lowpass");
      case "highpass":
        return t("filters.bands.highpass");
      case "bandpass":
        return t("filters.bands.bandpass");
      case "bandstop":
        return t("filters.bands.bandstop");
      case "notch":
        return t("filters.bands.notch");
      case "peaking":
        return t("filters.bands.peaking");
    }
  }
  switch (value) {
    case "hamming":
      return t("filters.windows.hamming");
    case "blackman":
      return t("filters.windows.blackman");
    case "kaiser":
      return t("filters.windows.kaiser");
  }
  return String(value);
}

export function FilterLabPanel({
  settings,
  onSettingsChange,
  design,
  designBusy,
  designError,
  onApply,
  applyBusy,
  applyError,
  applied,
  exportAvailable = false,
  onExportWav,
  channelControls,
  rightDelaySamples,
}: FilterLabPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const valid = filterSettingsValid(settings);
  const unstable = design !== null && !design.stable;
  const canApply = valid && design?.stable === true && !designBusy && !applyBusy;
  const bands = filterBandsForKind(settings.kind);
  const nyquistHz = settings.sampleRateHz / 2;
  const rootsOmitted = settings.kind === "fir" && settings.taps > 33;
  const sampleAxis = Array.from({ length: 256 }, (_, index) => index);
  const showSecondCutoff = settings.band === "bandpass" || settings.band === "bandstop";
  const rightDelay = rightDelaySamples ?? applied?.rightDelaySamples;

  return (
    <section className="flex flex-col gap-4">
      <ToolHeader titleKey="tool.filters.title" descriptionKey="tool.filters.description" />

      {channelControls}

      <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("filters.controls.kind")}</span>
          <select
            value={settings.kind}
            data-testid="filters.control.kind"
            onChange={(event) => {
              const kind = event.currentTarget.value as FilterDesignKind;
              const nextBands = filterBandsForKind(kind);
              onSettingsChange({
                kind,
                band: nextBands.includes(settings.band)
                  ? settings.band
                  : (nextBands[0] ?? "lowpass"),
              });
            }}
            className={INPUT_CLASSES}
          >
            {FILTER_DESIGN_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {selectLabel(t, "kinds", kind)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("filters.controls.band")}</span>
          <select
            value={settings.band}
            data-testid="filters.control.band"
            onChange={(event) => {
              onSettingsChange({ band: event.currentTarget.value as FilterBand });
            }}
            className={INPUT_CLASSES}
          >
            {bands.map((band) => (
              <option key={band} value={band}>
                {selectLabel(t, "bands", band)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("filters.controls.cutoff")}</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, nyquistHz - 1)}
            step={1}
            value={settings.cutoffHz}
            data-testid="filters.control.cutoff"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) {
                onSettingsChange({ cutoffHz: value });
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>

        {showSecondCutoff ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("filters.controls.cutoff2")}</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, nyquistHz - 1)}
              step={1}
              value={settings.cutoff2Hz}
              data-testid="filters.control.cutoff2"
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) {
                  onSettingsChange({ cutoff2Hz: value });
                }
              }}
              className={INPUT_CLASSES}
            />
          </label>
        ) : null}

        {settings.kind === "fir" ? (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("filters.controls.taps")}</span>
              <input
                type="number"
                min={3}
                max={257}
                step={2}
                value={settings.taps}
                data-testid="filters.control.taps"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) {
                    onSettingsChange({ taps: value });
                  }
                }}
                className={INPUT_CLASSES}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("filters.controls.window")}</span>
              <select
                value={settings.window}
                data-testid="filters.control.window"
                onChange={(event) => {
                  onSettingsChange({ window: event.currentTarget.value as FilterWindowKind });
                }}
                className={INPUT_CLASSES}
              >
                {FILTER_WINDOWS.map((windowKind) => (
                  <option key={windowKind} value={windowKind}>
                    {selectLabel(t, "windows", windowKind)}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : settings.kind === "biquad" ? (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("filters.controls.q")}</span>
              <input
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                value={settings.q}
                data-testid="filters.control.q"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) {
                    onSettingsChange({ q: value });
                  }
                }}
                className={INPUT_CLASSES}
              />
            </label>
            {settings.band === "peaking" ? (
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium">{t("filters.controls.gain")}</span>
                <input
                  type="number"
                  min={-24}
                  max={24}
                  step={1}
                  value={settings.gainDb}
                  data-testid="filters.control.gain"
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) {
                      onSettingsChange({ gainDb: value });
                    }
                  }}
                  className={INPUT_CLASSES}
                />
              </label>
            ) : null}
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("filters.controls.order")}</span>
              <input
                type="number"
                min={1}
                max={8}
                step={1}
                value={settings.order}
                data-testid="filters.control.order"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) {
                    onSettingsChange({ order: value });
                  }
                }}
                className={INPUT_CLASSES}
              />
            </label>
            {settings.kind === "chebyshev1" ? (
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium">{t("filters.controls.ripple")}</span>
                <input
                  type="number"
                  min={0.1}
                  max={3}
                  step={0.1}
                  value={settings.rippleDb}
                  data-testid="filters.control.ripple"
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) {
                      onSettingsChange({ rippleDb: value });
                    }
                  }}
                  className={INPUT_CLASSES}
                />
              </label>
            ) : null}
          </>
        )}

        <div className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("filters.controls.sampleRate")}</span>
          <span dir="ltr" data-testid="filters.control.sampleRate" className="tabular-nums">
            {formatHz(settings.sampleRateHz)}
          </span>
        </div>
      </div>

      {!valid ? (
        <p data-testid="filters.error.invalid" role="alert" className="text-sm text-danger">
          {t("filters.error.invalid")}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 rounded border border-surface p-3">
        <h3 className="text-sm font-semibold">{t("filters.result.title")}</h3>
        {designBusy ? (
          <p data-testid="filters.status.designing" className="text-sm text-muted">
            {t("filters.status.designing")}
          </p>
        ) : null}
        {designError !== null ? (
          <p data-testid="filters.error.design" role="alert" className="text-sm text-danger">
            {designError}
          </p>
        ) : null}

        {design !== null ? (
          <>
            <dl className="flex flex-wrap gap-4 text-xs text-muted">
              <div className="flex items-center gap-1">
                <dt>{t("filters.result.stability")}</dt>
                <dd
                  dir="ltr"
                  data-testid="filters.result.stability"
                  className={design.stable ? "tabular-nums" : "tabular-nums text-danger"}
                >
                  {design.stable ? t("filters.result.stable") : t("filters.result.unstable")}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("filters.result.delay")}</dt>
                <dd dir="ltr" data-testid="filters.result.delay" className="tabular-nums">
                  {design.delaySamples} samples ·{" "}
                  {formatS(design.delaySamples / settings.sampleRateHz)}
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt>{t("filters.result.coefficients")}</dt>
                <dd dir="ltr" className="tabular-nums">
                  {design.b.length} b · {design.a.length} a
                </dd>
              </div>
            </dl>
            {unstable ? (
              <p data-testid="filters.unstableWarning" role="alert" className="text-sm text-danger">
                {t("filters.unstableWarning")}
              </p>
            ) : null}
            <p className="text-xs text-muted">{t("filters.delayNote")}</p>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <FilterLinePlot
                x={design.frequenciesHz}
                y={design.magnitudeDb}
                xLabel={t("filters.plots.frequencyAxis")}
                yLabel={t("filters.plots.magnitudeAxis")}
                ariaLabel={t("filters.plots.magnitudeAria")}
                emptyLabel={t("filters.plots.empty")}
                testId="filters.plot.magnitude"
                xFormat={formatHz}
                yFormat={formatDb}
              />
              <FilterLinePlot
                x={design.frequenciesHz}
                y={design.phaseRad}
                xLabel={t("filters.plots.frequencyAxis")}
                yLabel={t("filters.plots.phaseAxis")}
                ariaLabel={t("filters.plots.phaseAria")}
                emptyLabel={t("filters.plots.empty")}
                testId="filters.plot.phase"
                color="#8bd3c7"
                xFormat={formatHz}
                yFormat={(value) => `${value.toFixed(2)} rad`}
              />
              <FilterLinePlot
                x={design.frequenciesHz}
                y={design.groupDelaySamples}
                xLabel={t("filters.plots.frequencyAxis")}
                yLabel={t("filters.plots.groupDelayAxis")}
                ariaLabel={t("filters.plots.groupDelayAria")}
                emptyLabel={t("filters.plots.empty")}
                testId="filters.plot.groupDelay"
                color="#f59e0b"
                xFormat={formatHz}
                yFormat={(value) => `${value.toFixed(1)} samples`}
              />
              <FilterLinePlot
                x={sampleAxis}
                y={design.impulse}
                xLabel={t("filters.plots.samplesAxis")}
                yLabel={t("filters.plots.amplitudeAxis")}
                ariaLabel={t("filters.plots.impulseAria")}
                emptyLabel={t("filters.plots.empty")}
                testId="filters.plot.impulse"
                color="#8bd3c7"
                xFormat={(value) => `${value.toFixed(0)}`}
                yFormat={(value) => value.toFixed(3)}
              />
              <FilterLinePlot
                x={sampleAxis}
                y={design.step}
                xLabel={t("filters.plots.samplesAxis")}
                yLabel={t("filters.plots.amplitudeAxis")}
                ariaLabel={t("filters.plots.stepAria")}
                emptyLabel={t("filters.plots.empty")}
                testId="filters.plot.step"
                color="#f59e0b"
                xFormat={(value) => `${value.toFixed(0)}`}
                yFormat={(value) => value.toFixed(3)}
              />
              <PoleZeroPlot
                poles={design.poles}
                zeros={design.zeros}
                stable={design.stable}
                omitted={rootsOmitted}
                title={t("filters.poleZero.title")}
                ariaLabel={t("filters.poleZero.aria")}
                polesLabel={t("filters.poleZero.poles")}
                zerosLabel={t("filters.poleZero.zeros")}
                stableLabel={t("filters.poleZero.stable")}
                unstableLabel={t("filters.poleZero.unstable")}
                omittedLabel={t("filters.poleZero.omitted")}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                data-testid="filters.apply.selection"
                disabled={!canApply}
                onClick={() => {
                  onApply("selection");
                }}
              >
                {t("filters.apply.selection")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="filters.apply.all"
                disabled={!canApply}
                onClick={() => {
                  onApply("all");
                }}
              >
                {t("filters.apply.all")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="filters.export.wav"
                disabled={!exportAvailable || onExportWav === undefined}
                onClick={onExportWav}
              >
                {t("filters.export.wav")}
              </Button>
              {applyBusy ? (
                <span data-testid="filters.apply.busy" className="text-xs text-muted">
                  {t("filters.apply.busy")}
                </span>
              ) : null}
            </div>
            {applyError !== null ? (
              <p data-testid="filters.error.apply" role="alert" className="text-sm text-danger">
                {applyError}
              </p>
            ) : null}
            {applied !== null ? (
              <>
                <p data-testid="filters.apply.done" dir="ltr" className="text-xs text-muted">
                  {t("filters.apply.done", {
                    start: formatS(applied.startSample / settings.sampleRateHz),
                    end: formatS(applied.endSample / settings.sampleRateHz),
                    delay: applied.delaySamples,
                  })}
                </p>
                {rightDelay !== undefined ? (
                  <p
                    data-testid="filters.result.delayRight"
                    dir="ltr"
                    className="text-xs text-muted"
                  >
                    {t("filters.result.delayRight")}: {rightDelay} samples
                  </p>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <TheoryPanel
        titleKey={TOOL_THEORY.filters.titleKey}
        sections={TOOL_THEORY.filters.sections}
      />
    </section>
  );
}

type FilterDesignLanes = {
  left: FilterDesignResult | null;
  right: FilterDesignResult | null;
};

export function FilterLabView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const processed = useSessionStore((state) => state.processed);
  const [searchParams, setSearchParams] = useSearchParams();
  const channel = useChannelMode(original, "both");
  const [designs, setDesigns] = useState<FilterDesignLanes | null>(null);
  const [designBusy, setDesignBusy] = useState(false);
  const [designError, setDesignError] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState<FilterAppliedRange | null>(null);
  const designGenerationRef = useRef(0);

  const search = searchParams.toString();
  const pair = useMemo(() => {
    const base = search === "" ? loadFilterPair() : filterPairFromSearch(`?${search}`);
    return original === null ? base : filterPairAtRate(base, original.sampleRateHz);
  }, [search, original]);
  const resolved = useMemo(() => resolveLaneParams(pair), [pair]);
  const effectiveLane: FilterEditLane =
    channel.mode === "both" ? pair.editLane : channel.mode === "right" ? "right" : "left";
  const settings = effectiveLane === "right" ? resolved.right : resolved.left;
  const linked = laneParamsLinked(pair);

  useEffect(() => {
    saveFilterPair(pair);
  }, [pair]);

  function writePair(nextPair: FilterPairSettings): void {
    const params = new URLSearchParams(searchParams);
    for (const key of Array.from(params.keys())) {
      if (key === "el" || (key.startsWith("rr") && key.length > 2)) {
        params.delete(key);
      }
    }
    for (const [key, value] of new URLSearchParams(filterPairToSearch(nextPair))) {
      params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  }

  function updateSettings(patch: Partial<FilterSettings>): void {
    const current = effectiveLane === "right" ? resolved.right : pair.primary;
    const next = { ...current, ...patch };
    const nextPair =
      effectiveLane === "right" ? setRightLane(pair, next) : setPrimaryLane(pair, next);
    writePair({ ...nextPair, editLane: pair.editLane });
  }

  function updateSharedSettings(patch: Partial<FilterSettings>): void {
    writePair({
      ...pair,
      primary: { ...pair.primary, ...patch },
      ...(pair.right === undefined ? {} : { right: { ...pair.right, ...patch } }),
    });
  }

  function selectEditLane(lane: FilterEditLane): void {
    writePair({ ...pair, editLane: lane });
  }

  function setLinked(nextLinked: boolean): void {
    const next = nextLinked ? relinkLaneParams(pair) : unlinkLaneParams(pair);
    writePair({ ...next, editLane: pair.editLane });
  }

  useEffect(() => {
    if (original === null) {
      return;
    }
    const generation = designGenerationRef.current + 1;
    designGenerationRef.current = generation;
    setDesignError(null);
    const both = channel.mode === "both";
    const targets: readonly { lane: FilterEditLane; settings: FilterSettings }[] = both
      ? linked
        ? [{ lane: "left", settings: resolved.left }]
        : [
            { lane: "left", settings: resolved.left },
            { lane: "right", settings: resolved.right },
          ]
      : [{ lane: effectiveLane, settings }];
    if (targets.some((target) => !filterSettingsValid(target.settings))) {
      setDesigns(null);
      setDesignBusy(false);
      if (both) {
        setDesignError(t("filters.error.invalid"));
      }
      return;
    }
    setDesignBusy(true);
    const timer = window.setTimeout(() => {
      const tickets = targets.map((target) => ({
        target,
        ticket: useSessionStore
          .getState()
          .deriveStandalone("filterDesign", filterDesignParams(target.settings)),
      }));
      Promise.all(
        tickets.map(async ({ target, ticket }) => ({ target, outcome: await ticket.outcome })),
      ).then(
        (settled) => {
          if (designGenerationRef.current !== generation) {
            return;
          }
          const next: FilterDesignLanes = { left: null, right: null };
          for (const { target, outcome } of settled) {
            if ("cancelled" in outcome) {
              setDesignBusy(false);
              return;
            }
            next[target.lane] = outcome;
          }
          if (both && linked) {
            next.right = next.left;
          }
          setDesigns(next);
          setDesignBusy(false);
        },
        () => {
          if (designGenerationRef.current === generation) {
            setDesigns(null);
            setDesignBusy(false);
            setDesignError(t("filters.error.designFailed"));
          }
        },
      );
    }, DESIGN_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [original, channel.mode, effectiveLane, resolved, settings, linked, t]);

  async function applyFilter(scope: "selection" | "all"): Promise<void> {
    if (original === null) {
      return;
    }
    updateSharedSettings({ applyScope: scope });
    const range = filterApplyRange(
      scope,
      selection,
      original.samples.length,
      original.sampleRateHz,
    );
    if (range.endSample <= range.startSample) {
      setApplyError(t("filters.error.emptyRange"));
      return;
    }
    setApplyBusy(true);
    setApplyError(null);
    try {
      if (channel.mode === "mono") {
        const monoDesign = designs?.left ?? null;
        if (monoDesign === null || !filterSettingsValid(pair.primary)) {
          return;
        }
        const slice = original.samples.slice(range.startSample, range.endSample);
        const ticket = useSessionStore
          .getState()
          .deriveStandalone("filterApply", filterApplyParams(pair.primary, monoDesign), {
            buffer: slice.buffer,
            byteOffset: 0,
            byteLength: slice.byteLength,
          });
        const outcome = await ticket.outcome;
        if ("cancelled" in outcome) {
          return;
        }
        const installed = useSessionStore
          .getState()
          .setProcessed(outcome.samples, pair.primary.sampleRateHz, PROCESSED_LABEL);
        if (!installed.ok) {
          setApplyError(t("filters.error.playback"));
          return;
        }
        setApplied({
          startSample: range.startSample,
          endSample: range.endSample,
          delaySamples: outcome.delaySamples,
        });
        return;
      }

      let active: readonly {
        lane: 0 | 1;
        settings: FilterSettings;
        design: FilterDesignResult;
      }[];
      if (channel.mode === "both") {
        const leftDesign = designs?.left ?? null;
        const rightDesign = designs?.right ?? null;
        if (leftDesign === null || rightDesign === null) {
          return;
        }
        active = [
          { lane: 0, settings: resolved.left, design: leftDesign },
          { lane: 1, settings: resolved.right, design: rightDesign },
        ];
      } else {
        const laneDesign = designs?.[effectiveLane] ?? null;
        if (laneDesign === null) {
          return;
        }
        active = [{ lane: effectiveLane === "right" ? 1 : 0, settings, design: laneDesign }];
      }
      if (active.some((entry) => !filterSettingsValid(entry.settings))) {
        return;
      }

      const settled = await Promise.all(
        active.map(async (entry) => {
          const ticket = useSessionStore
            .getState()
            .deriveWithSourceSliceLane(
              "filterApply",
              filterApplyParams(entry.settings, entry.design),
              range.startSample,
              range.endSample,
              entry.lane,
            );
          return { lane: entry.lane, outcome: await ticket.outcome };
        }),
      );
      if (settled.some(({ outcome }) => "cancelled" in outcome)) {
        return;
      }
      const laneResults: { left?: Float32Array; right?: Float32Array } = {};
      for (const { lane, outcome } of settled) {
        if ("cancelled" in outcome) {
          return;
        }
        if (lane === 0) {
          laneResults.left = outcome.samples;
        } else {
          laneResults.right = outcome.samples;
        }
      }
      const combined = combineLaneResults(
        channel.mode,
        original.channels,
        range.startSample,
        range.endSample - range.startSample,
        laneResults as LaneResults,
      );
      if (combined === null) {
        setApplyError(t("filters.error.playback"));
        return;
      }
      const installed = useSessionStore
        .getState()
        .setProcessed(combined, original.sampleRateHz, PROCESSED_LABEL);
      if (!installed.ok) {
        setApplyError(t("filters.error.playback"));
        return;
      }
      setApplied({
        startSample: range.startSample,
        endSample: range.endSample,
        delaySamples:
          (channel.mode === "both" ? designs?.left : designs?.[effectiveLane])?.delaySamples ?? 0,
        ...(channel.mode === "both"
          ? { rightDelaySamples: designs?.right?.delaySamples ?? 0 }
          : {}),
      });
    } catch {
      setApplyError(t("filters.error.applyFailed"));
    } finally {
      setApplyBusy(false);
    }
  }

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <ToolHeader titleKey="tool.filters.title" descriptionKey="tool.filters.description" />
        <UploadEmptyState />
      </section>
    );
  }

  const displayedDesign = designs?.[effectiveLane] ?? null;
  const panelDesign =
    channel.mode === "both" && designs !== null && (designs.left === null || designs.right === null)
      ? null
      : displayedDesign;

  const laneLabels = {
    left: t("filters.lane.left"),
    right: t("filters.lane.right"),
  } as const;

  const channelControls = (
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
                data-testid={`filters.lane.${lane}`}
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
              data-testid="filters.linkRight"
              checked={linked}
              onChange={(event) => {
                setLinked(event.currentTarget.checked);
              }}
            />
            <span>{t("filters.lane.link")}</span>
          </label>
          <p data-testid="filters.lane.status" className="text-xs text-muted">
            {linked ? t("filters.lane.linked") : t("filters.lane.separate")}
          </p>
        </>
      ) : null}
    </div>
  );

  return (
    <FilterLabPanel
      settings={settings}
      onSettingsChange={updateSettings}
      design={panelDesign}
      designBusy={designBusy}
      designError={designError}
      onApply={(scope) => {
        void applyFilter(scope);
      }}
      applyBusy={applyBusy}
      applyError={applyError}
      applied={applied}
      exportAvailable={processed !== null && processed.label === PROCESSED_LABEL}
      onExportWav={() => {
        const filtered = useSessionStore.getState().processed;
        if (filtered === null || filtered.label !== PROCESSED_LABEL) {
          return;
        }
        downloadWav(filtered.channels, filtered.sampleRateHz, "avalab-filters.wav");
      }}
      channelControls={channelControls}
    />
  );
}
