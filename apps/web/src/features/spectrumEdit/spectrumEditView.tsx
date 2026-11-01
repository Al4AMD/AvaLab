/**
 * F09 spectrum editor (Wave-3 Plan 05 Task 3): band edits on Re/Im/magnitude/
 * phase of one rectangular-window frame, Hermitian ON/OFF, presets, and
 * playback of the IFFT result through the processed lane.
 *
 * The store owns every worker call (R23); this view only unpacks the packed
 * Float64 payload `[samples | re | im | mag | phase]`. Charts are uPlot and
 * stay LTR (AGENTS §6). The 200 ms debounce matches the other Wave-3 labs.
 */

import type { SpectrumEdit, SpectrumEditMode, SpectrumEditTarget } from "@avalab/dsp";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { Button } from "../../components/ui/button";
import { formatHz, formatS } from "../../lib/format";
import { FFT_MAX_LENGTH, type SpectrumEditResult } from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import {
  binsFromHz,
  presetEdits,
  SPECTRUM_EDIT_MODES,
  SPECTRUM_EDIT_PRESETS,
  SPECTRUM_EDIT_TARGETS,
  type SpectrumEditPreset,
  type SpectrumEditSettings,
  spectrumEditSettingsFromSearch,
  spectrumEditSettingsToSearch,
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
  const settings = useMemo(
    () =>
      spectrumEditSettingsFromSearch(
        `?${searchParams.toString()}`,
        {
          sampleCount: original?.samples.length ?? 0,
          sampleRateHz: original?.sampleRateHz ?? 1,
        },
        selection,
      ),
    [searchParams, original, selection],
  );
  const [result, setResult] = useState<SpectrumEditViewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [bandStartHz, setBandStartHz] = useState(500);
  const [bandEndHz, setBandEndHz] = useState(2000);
  const [target, setTarget] = useState<SpectrumEditTarget>("mag");
  const [mode, setMode] = useState<SpectrumEditMode>("zero");
  const [value, setValue] = useState(0);
  const generationRef = useRef(0);

  function updateSettings(patch: Partial<SpectrumEditSettings>): void {
    const next = { ...settings, ...patch };
    const params = new URLSearchParams(searchParams);
    for (const [key, entry] of new URLSearchParams(spectrumEditSettingsToSearch(next))) {
      params.set(key, entry);
    }
    setSearchParams(params, { replace: true });
  }

  const rangeStart = Math.max(0, Math.min(settings.startSample, original?.samples.length ?? 0));
  const rangeEnd = Math.max(
    rangeStart,
    Math.min(settings.endSample, original?.samples.length ?? 0),
  );
  const analysisStart = rangeStart;
  const analysisEnd = Math.min(rangeEnd, rangeStart + FFT_MAX_LENGTH);

  const params = useMemo(
    () => ({
      sampleRateHz: original?.sampleRateHz ?? 0,
      startSample: rangeStart,
      endSample: rangeEnd,
      edits: settings.edits,
      hermitian: settings.hermitian,
    }),
    [original, rangeStart, rangeEnd, settings.edits, settings.hermitian],
  );

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setFailed(false);
    if (original === null || analysisEnd <= analysisStart) {
      setResult(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    let ticketKey: string | null = null;
    const timer = window.setTimeout(() => {
      const ticket = useSessionStore
        .getState()
        .deriveWithSourceSlice("spectrumEdit", params, analysisStart, analysisEnd);
      ticketKey = ticket.key;
      ticket.outcome.then(
        (outcome) => {
          if (generationRef.current !== generation || "cancelled" in outcome) {
            return;
          }
          const unpacked = unpackResult(outcome);
          if (unpacked === null) {
            setResult(null);
            setBusy(false);
            setFailed(true);
            return;
          }
          setResult(unpacked);
          setBusy(false);
        },
        () => {
          if (generationRef.current === generation) {
            setResult(null);
            setBusy(false);
            setFailed(true);
          }
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      if (ticketKey !== null) {
        useSessionStore.getState().cancel(ticketKey);
      }
    };
  }, [original, params, analysisStart, analysisEnd]);

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

  function playResult(): void {
    if (result === null) {
      return;
    }
    const installed = useSessionStore
      .getState()
      .setProcessed(result.samples.slice(), result.meta.sampleRateHz, "spectrumEdit");
    setFailed(!installed.ok);
  }

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{t("tool.spectrumEdit.title")}</h2>
        <UploadEmptyState />
      </section>
    );
  }

  const numberFormatter = (entry: number): string => entry.toPrecision(3);
  const phaseFormatter = (entry: number): string => `${entry.toFixed(2)} rad`;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">{t("tool.spectrumEdit.title")}</h2>

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
    </section>
  );
}
