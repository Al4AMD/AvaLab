/**
 * Freehand curve surface for F09. The x axis is the one-sided FFT bin index,
 * the y axis is the selected component's current value. Pointer input only
 * edits point lists; all DSP stays in the worker. Charts remain LTR.
 */
import type { SpectrumCurvePoint, SpectrumCurveTarget } from "@avalab/dsp";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { addCurvePoint, moveCurvePoint } from "./curveState";

const HEIGHT_PX = 180;
const PADDING_PX = 10;
const HIT_RADIUS_PX = 10;
const ACCENT = "#38bdf8";
const COMMITTED = "#f59e0b";
const SPECTRUM = "rgba(148,163,184,0.55)";
const GRID = "rgba(148,163,184,0.18)";

type CurveCanvasProps = {
  readonly binCount: number;
  readonly values: Float64Array;
  readonly target: SpectrumCurveTarget;
  readonly points: readonly SpectrumCurvePoint[];
  readonly committed: readonly SpectrumCurvePoint[];
  readonly onChange: (points: readonly SpectrumCurvePoint[]) => void;
};

function finiteRange(
  values: Float64Array,
  points: readonly SpectrumCurvePoint[],
  target: SpectrumCurveTarget,
): { readonly min: number; readonly max: number } {
  if (target === "phase") {
    return { min: -Math.PI, max: Math.PI };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  for (const point of points) {
    min = Math.min(min, point.value);
    max = Math.max(max, point.value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: -1, max: 1 };
  }
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  const pad = (max - min) * 0.1;
  return { min: min - pad, max: max + pad };
}

export function CurveCanvas({
  binCount,
  values,
  target,
  points,
  committed,
  onChange,
}: CurveCanvasProps): React.ReactElement {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragBinRef = useRef<number | null>(null);
  const [widthPx, setWidthPx] = useState(480);
  const [hover, setHover] = useState<{ readonly bin: number; readonly value: number } | null>(null);

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

  const range = useMemo(() => finiteRange(values, points, target), [values, points, target]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    canvas.width = Math.max(1, Math.round(widthPx * dpr));
    canvas.height = Math.max(1, Math.round(HEIGHT_PX * dpr));
    const context = canvas.getContext("2d");
    if (context === null) {
      return;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, widthPx, HEIGHT_PX);
    const plotWidth = Math.max(1, widthPx - PADDING_PX * 2);
    const plotHeight = HEIGHT_PX - PADDING_PX * 2;
    const xForBin = (bin: number): number =>
      PADDING_PX + (binCount <= 1 ? 0 : (bin / (binCount - 1)) * plotWidth);
    const yForValue = (value: number): number =>
      PADDING_PX + plotHeight - ((value - range.min) / (range.max - range.min)) * plotHeight;

    context.strokeStyle = GRID;
    context.lineWidth = 1;
    for (let line = 0; line <= 4; line += 1) {
      const y = PADDING_PX + (plotHeight * line) / 4;
      context.beginPath();
      context.moveTo(PADDING_PX, y);
      context.lineTo(PADDING_PX + plotWidth, y);
      context.stroke();
    }

    if (values.length > 1) {
      context.strokeStyle = SPECTRUM;
      context.lineWidth = 1;
      context.beginPath();
      const stride = Math.max(1, Math.floor(values.length / plotWidth));
      for (let bin = 0; bin < values.length; bin += stride) {
        const x = xForBin(bin);
        const y = yForValue(values[bin] ?? 0);
        if (bin === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.stroke();
    }

    const drawPoints = (entries: readonly SpectrumCurvePoint[], color: string): void => {
      if (entries.length === 0) {
        return;
      }
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = 1.5;
      context.beginPath();
      entries.forEach((point, index) => {
        const x = xForBin(point.bin);
        const y = yForValue(point.value);
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.stroke();
      for (const point of entries) {
        context.beginPath();
        context.arc(xForBin(point.bin), yForValue(point.value), 2.5, 0, Math.PI * 2);
        context.fill();
      }
    };
    drawPoints(committed, COMMITTED);
    drawPoints(points, ACCENT);
  }, [widthPx, values, points, committed, binCount, range]);

  function eventPoint(event: React.PointerEvent<HTMLCanvasElement>): SpectrumCurvePoint {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
    const plotWidth = Math.max(1, rect.width - PADDING_PX * 2);
    const plotHeight = HEIGHT_PX - PADDING_PX * 2;
    const bin = Math.max(
      0,
      Math.min(binCount - 1, Math.round(((x - PADDING_PX) / plotWidth) * (binCount - 1))),
    );
    const ratio = 1 - (y - PADDING_PX) / plotHeight;
    const value = range.min + ratio * (range.max - range.min);
    return { bin, value };
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    const point = eventPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const plotWidth = Math.max(
      1,
      event.currentTarget.getBoundingClientRect().width - PADDING_PX * 2,
    );
    const binsToPx = binCount <= 1 ? 0 : plotWidth / (binCount - 1);
    const nearest = points.reduce<{ index: number; distance: number }>(
      (best, entry, index) => {
        const distance = Math.abs(entry.bin - point.bin) * binsToPx;
        return distance < best.distance ? { index, distance } : best;
      },
      { index: -1, distance: Number.POSITIVE_INFINITY },
    );
    if (nearest.index >= 0 && nearest.distance <= HIT_RADIUS_PX) {
      const existing = points[nearest.index];
      if (existing !== undefined) {
        dragBinRef.current = existing.bin;
        onChange(moveCurvePoint(points, nearest.index, { bin: existing.bin, value: point.value }));
        setHover({ bin: existing.bin, value: point.value });
        return;
      }
    }
    dragBinRef.current = point.bin;
    onChange(addCurvePoint(points, point));
    setHover(point);
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    const point = eventPoint(event);
    setHover(point);
    const dragBin = dragBinRef.current;
    if (dragBin === null) {
      return;
    }
    const index = points.findIndex((entry) => entry.bin === dragBin);
    if (index >= 0) {
      onChange(moveCurvePoint(points, index, { bin: dragBin, value: point.value }));
    }
  }

  function endDrag(event: React.PointerEvent<HTMLCanvasElement>): void {
    dragBinRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div ref={hostRef} className="min-w-0">
        <canvas
          ref={canvasRef}
          dir="ltr"
          role="img"
          aria-label={t("spectrumEdit.curve.title")}
          data-testid="spectrumEdit.curve.canvas"
          className="block w-full touch-none rounded border border-surface"
          style={{ height: HEIGHT_PX }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={(event) => {
            if (dragBinRef.current === null) {
              setHover(null);
            } else {
              endDrag(event);
            }
          }}
        />
      </div>
      <p className="text-xs text-muted" data-testid="spectrumEdit.curve.readout">
        {hover === null
          ? t("spectrumEdit.curve.hint")
          : t("spectrumEdit.curve.readout", {
              bin: hover.bin,
              value: hover.value.toPrecision(4),
            })}
      </p>
    </div>
  );
}
