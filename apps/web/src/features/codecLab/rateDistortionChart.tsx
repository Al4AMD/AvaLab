/**
 * F05 rate–distortion scatter (Wave-4 Plan 04 Task 2).
 *
 * One point per finite row, no connecting lines: a line between RLE and MP3
 * would imply an interpolation that does not exist. Lossless rows with
 * infinite quality stay in the table, not on the chart.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { ComparisonRow } from "./comparison";
import {
  appendRateDistortionPoints,
  type RateDistortionExtraPoint,
  type RateDistortionQuality,
  rateDistortionPoints,
} from "./comparisonRunner";

const CHART_HEIGHT_PX = 240;
const POINT_COLORS = ["#8bd3c7", "#f59e0b", "#93c5fd", "#f472b6", "#a3e635", "#c4b5fd"];

export function RateDistortionChart({
  rows,
  heightPx = CHART_HEIGHT_PX,
  quality = "snrDb",
  extraPoints = [],
}: {
  readonly rows: readonly ComparisonRow[];
  readonly heightPx?: number;
  readonly quality?: RateDistortionQuality;
  readonly extraPoints?: readonly RateDistortionExtraPoint[];
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(1);
  const points = appendRateDistortionPoints(
    rateDistortionPoints(rows, quality),
    extraPoints,
    quality,
  );

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
    if (host === null || points.labels.length === 0) {
      return;
    }
    const values = quality === "psnrDb" ? points.psnrDb : points.snrDb;
    const data: uPlot.AlignedData = [
      points.bitrateKbps,
      ...points.labels.map((_, seriesIndex) =>
        points.bitrateKbps.map((_bitrate, pointIndex) =>
          pointIndex === seriesIndex ? (values[pointIndex] ?? null) : null,
        ),
      ),
    ] as uPlot.AlignedData;
    const options: uPlot.Options = {
      width: widthPx,
      height: heightPx,
      padding: [8, 12, 8, 8],
      legend: { show: true },
      cursor: { show: false },
      scales: { x: { time: false } },
      series: [
        {},
        ...points.labels.map((labelKey, index) => ({
          label: t(labelKey),
          stroke: POINT_COLORS[index % POINT_COLORS.length],
          width: 0,
          points: {
            show: true,
            size: 7,
            fill: POINT_COLORS[index % POINT_COLORS.length],
            stroke: POINT_COLORS[index % POINT_COLORS.length],
          },
        })),
      ],
      axes: [
        {
          label: t("codecLab.comparison.chart.x"),
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.18)" },
          ticks: { stroke: "rgba(148,163,184,0.35)" },
          font: "10px ui-monospace, monospace",
        },
        {
          label:
            quality === "psnrDb"
              ? t("codecLab.comparison.chart.yPsnr")
              : t("codecLab.comparison.chart.ySnr"),
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.18)" },
          ticks: { stroke: "rgba(148,163,184,0.35)" },
          font: "10px ui-monospace, monospace",
          size: 56,
          values: (_self, splits) => splits.map((value) => `${value.toFixed(0)} dB`),
        },
      ],
    };
    const plot = new uPlot(options, data, host);
    return () => {
      plot.destroy();
    };
  }, [heightPx, points, quality, t, widthPx]);

  return points.labels.length === 0 ? (
    <p data-testid="codecLab.comparison.chart.empty" className="text-xs text-muted">
      {t("codecLab.comparison.chart.empty")}
    </p>
  ) : (
    <div
      ref={hostRef}
      dir="ltr"
      role="img"
      aria-label={t("codecLab.comparison.chart.aria")}
      data-testid="codecLab.comparison.chart"
    />
  );
}
