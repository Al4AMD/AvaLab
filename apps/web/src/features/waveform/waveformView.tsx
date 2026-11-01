/**
 * Waveform tool (F02): overview + zoomable detail painted from worker-built
 * min/max envelopes. The view owns only window/selection interaction; DSP
 * stays behind the store's derive lane.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { formatS } from "../../lib/format";
import type { WaveformOverviewResult, WaveformRangeResult } from "../../session/ops";
import { type SessionSource, useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import { WaveformCanvas } from "./canvasWaveform";
import {
  clampWindow,
  panWindow,
  type SampleWindow,
  windowFromSearch,
  windowToSearch,
  zoomWindow,
} from "./interactions";

const OVERVIEW_BUCKET_COUNT = 1200;
const DETAIL_BUCKET_COUNT = 1200;

function useOverview(): { readonly minMax: Float32Array; readonly sampleCount: number } {
  const original = useSessionStore((state) => state.original);
  const derived = useSessionStore((state) => state.derived);
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    if (original === null) {
      setKey(null);
      return;
    }
    const ticket = useSessionStore.getState().deriveWithSource("waveformOverview", {
      bucketCount: OVERVIEW_BUCKET_COUNT,
      sampleRateHz: original.sampleRateHz,
    });
    setKey(ticket.key);
    ticket.outcome.catch(() => undefined);
  }, [original]);

  const entry = key === null ? undefined : derived.get(key);
  return useMemo(() => {
    const result = entry?.result as WaveformOverviewResult | undefined;
    const payload = result?.payload;
    if (result === undefined || payload === undefined) {
      return { minMax: new Float32Array(0), sampleCount: original?.samples.length ?? 0 };
    }
    return {
      minMax: new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
      sampleCount: result.meta.sampleCount,
    };
  }, [entry, original]);
}

function useSliceEnvelope(
  original: SessionSource | null,
  window: SampleWindow,
  skip: boolean,
): { minMax: Float32Array; range: SampleWindow } | null {
  const derived = useSessionStore((state) => state.derived);
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    if (original === null || skip) {
      setKey(null);
      return;
    }
    const ticket = useSessionStore.getState().deriveWithSourceSlice(
      "waveformRange",
      {
        bucketCount: DETAIL_BUCKET_COUNT,
        sampleRateHz: original.sampleRateHz,
        startSample: window.startSample,
        endSample: window.endSample,
      },
      window.startSample,
      window.endSample,
    );
    setKey(ticket.key);
    ticket.outcome.catch(() => undefined);
  }, [original, skip, window.startSample, window.endSample]);

  const entry = key === null ? undefined : derived.get(key);
  return useMemo(() => {
    const result = entry?.result as WaveformRangeResult | undefined;
    const payload = result?.payload;
    if (result === undefined || payload === undefined) {
      return null;
    }
    return {
      minMax: new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
      range: { startSample: result.meta.startSample, endSample: result.meta.endSample },
    };
  }, [entry]);
}

function sampleAt(event: PointerEvent<HTMLCanvasElement>, range: SampleWindow): number {
  const rect = event.currentTarget.getBoundingClientRect();
  const fraction = rect.width <= 0 ? 0 : (event.clientX - rect.left) / rect.width;
  const clamped = Math.max(0, Math.min(1, fraction));
  return Math.round(range.startSample + clamped * (range.endSample - range.startSample));
}

export function WaveformView() {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const setSelection = useSessionStore((state) => state.setSelection);
  const { minMax, sampleCount } = useOverview();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const dragAnchor = useRef<number | null>(null);

  const window =
    original === null
      ? { startSample: 0, endSample: 0 }
      : windowFromSearch(`?${searchParams.toString()}`, sampleCount);
  const isFullWindow = window.startSample === 0 && window.endSample === Math.max(1, sampleCount);
  const slice = useSliceEnvelope(original, window, isFullWindow);
  const detailMinMax = slice?.minMax ?? minMax;
  const detailRange = slice?.range ?? { startSample: 0, endSample: sampleCount };

  function applyWindow(next: SampleWindow): void {
    if (sampleCount <= 0) {
      return;
    }
    const clamped = clampWindow(next, sampleCount);
    const params = new URLSearchParams(searchParams);
    if (clamped.startSample === 0 && clamped.endSample === sampleCount) {
      params.delete("t");
    } else {
      const encoded = windowToSearch(clamped);
      params.set("t", encoded.slice(2));
    }
    setSearchParams(params, { replace: true });
  }

  function zoom(factor: number): void {
    const anchor = Math.round((selection.startSample + selection.endSample) / 2);
    applyWindow(zoomWindow(window, sampleCount, factor, anchor));
  }

  const onDetailPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    const sample = sampleAt(event, detailRange);
    dragAnchor.current = sample;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelection(sample, sample);
  };

  const onDetailPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const sample = sampleAt(event, detailRange);
    setCursorTime(sample / (original?.sampleRateHz ?? 1));
    if (dragAnchor.current !== null) {
      const anchor = dragAnchor.current;
      setSelection(Math.min(anchor, sample), Math.max(anchor, sample));
    }
  };

  const onDetailPointerUp = (event: PointerEvent<HTMLCanvasElement>): void => {
    dragAnchor.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onDetailKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    const span = Math.max(1, selection.endSample - selection.startSample);
    const step = Math.max(1, Math.round(span * 0.1));
    if (event.key === "[") {
      event.preventDefault();
      zoom(2);
    } else if (event.key === "]") {
      event.preventDefault();
      zoom(0.5);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      if (event.shiftKey) {
        setSelection(selection.startSample, Math.max(1, selection.endSample + direction * step));
      } else {
        const start = Math.max(
          0,
          Math.min(sampleCount - span, selection.startSample + direction * step),
        );
        setSelection(start, start + span);
      }
    }
  };

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{t("tool.waveform.title")}</h2>
        <UploadEmptyState />
      </section>
    );
  }

  const durationSeconds = sampleCount / original.sampleRateHz;
  const selectionStartSeconds = selection.startSample / original.sampleRateHz;
  const selectionEndSeconds = selection.endSample / original.sampleRateHz;
  let peak = 0;
  for (const value of minMax) {
    peak = Math.max(peak, Math.abs(value));
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-semibold">{t("tool.waveform.title")}</h2>
        <p dir="ltr" className="font-mono text-xs text-muted">
          {t("waveform.readout", {
            duration: formatS(durationSeconds),
            rateHz: original.sampleRateHz,
            peak: peak.toFixed(3),
          })}
        </p>
      </div>

      <figure className="flex flex-col gap-1">
        <figcaption className="flex items-baseline justify-between gap-2 text-sm text-muted">
          <span>{t("waveform.overview")}</span>
          <span dir="ltr" data-testid="waveform.overview.range" className="font-mono text-xs">
            {formatS(0)} – {formatS(durationSeconds)}
          </span>
        </figcaption>
        <WaveformCanvas
          minMax={minMax}
          sampleRange={{ startSample: 0, endSample: sampleCount }}
          selectionRange={selection}
          heightPx={120}
          testId="waveform.overview.canvas"
          label={t("waveform.overviewAria")}
        />
      </figure>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-surface px-3 py-1 text-sm"
          onClick={() => zoom(0.5)}
          data-testid="waveform.zoom.in"
          aria-label={t("waveform.zoomIn")}
        >
          {t("waveform.zoomIn")}
        </button>
        <button
          type="button"
          className="rounded-md border border-surface px-3 py-1 text-sm"
          onClick={() => zoom(2)}
          data-testid="waveform.zoom.out"
          aria-label={t("waveform.zoomOut")}
        >
          {t("waveform.zoomOut")}
        </button>
        <button
          type="button"
          className="rounded-md border border-surface px-3 py-1 text-sm"
          onClick={() => applyWindow({ startSample: 0, endSample: sampleCount })}
          data-testid="waveform.zoom.reset"
        >
          {t("waveform.resetZoom")}
        </button>
        <button
          type="button"
          className="rounded-md border border-surface px-3 py-1 text-sm"
          onClick={() => applyWindow(panWindow(window, sampleCount, -0.5))}
          aria-label={t("waveform.panLeft")}
        >
          ←
        </button>
        <button
          type="button"
          className="rounded-md border border-surface px-3 py-1 text-sm"
          onClick={() => applyWindow(panWindow(window, sampleCount, 0.5))}
          aria-label={t("waveform.panRight")}
        >
          →
        </button>
        <span className="text-xs text-muted">{t("waveform.hint")}</span>
        {cursorTime !== null ? (
          <span
            dir="ltr"
            data-testid="waveform.hover.time"
            className="ms-auto font-mono text-xs text-muted"
          >
            {formatS(cursorTime)}
          </span>
        ) : null}
      </div>

      <figure className="flex flex-col gap-1">
        <figcaption className="flex items-baseline justify-between gap-2 text-sm text-muted">
          <span>{t("waveform.detail")}</span>
          <span dir="ltr" data-testid="waveform.range.value" className="font-mono text-xs">
            {formatS(detailRange.startSample / original.sampleRateHz)} –{" "}
            {formatS(detailRange.endSample / original.sampleRateHz)}
          </span>
        </figcaption>
        <WaveformCanvas
          minMax={detailMinMax}
          sampleRange={detailRange}
          selectionRange={selection}
          heightPx={220}
          testId="waveform.detail.canvas"
          label={t("waveform.detailAria")}
          interactive
          onPointerDown={onDetailPointerDown}
          onPointerMove={onDetailPointerMove}
          onPointerUp={onDetailPointerUp}
          onKeyDown={onDetailKeyDown}
        />
      </figure>

      <p dir="ltr" data-testid="waveform.selection.value" className="font-mono text-xs text-muted">
        {t("waveform.selectionReadout", {
          start: formatS(selectionStartSeconds),
          end: formatS(selectionEndSeconds),
        })}
      </p>
    </section>
  );
}
