/**
 * Header action for the F16 lab report. It snapshots the current tool view
 * (visible controls and canvases), measures metrics for the current processed
 * lane, and downloads a standalone printable HTML report. All work starts
 * from the explicit click; no background export runs.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import { useSessionStore } from "../../session/store";
import { channelLabel } from "../channels/channelLabels";
import { formatMetric } from "../metrics/metrics";
import { selectMetricsLanes } from "../metrics/metricsLanes";
import { measureQualityMetrics } from "../metrics/qualityMetricsWorker";
import { type TheoryToolId, TOOL_THEORY } from "../theory/theoryContent";
import {
  buildLabReportHtml,
  collectCanvasFigures,
  collectPageParameters,
  downloadLabReportHtml,
  type LabReportMetric,
  type LabReportParameter,
} from "./labReport";

type RouteTool = {
  readonly id: TheoryToolId | null;
  readonly titleKey: string;
};

const ROUTE_TOOLS: Record<string, RouteTool> = {
  "/tools/waveform": { id: "waveform", titleKey: "tool.waveform.title" },
  "/tools/spectrogram": { id: "spectrogram", titleKey: "tool.spectrogram.title" },
  "/tools/fftview": { id: "fftview", titleKey: "tool.fftview.title" },
  "/tools/filters": { id: "filters", titleKey: "tool.filters.title" },
  "/tools/generator": { id: "generator", titleKey: "tool.generator.title" },
  "/tools/speed": { id: "speed", titleKey: "tool.speed.title" },
  "/tools/sampling": { id: "sampling", titleKey: "tool.sampling.title" },
  "/tools/extent": { id: "extent", titleKey: "tool.extent.title" },
  "/tools/reverb": { id: "reverb", titleKey: "tool.reverb.title" },
  "/tools/spectrum-edit": { id: "spectrum-edit", titleKey: "tool.spectrumEdit.title" },
  "/tools/codec-lab": { id: "codec-lab", titleKey: "tool.codecLab.title" },
  "/tools/metrics": { id: "metrics", titleKey: "tool.metrics.title" },
  "/tools/psychoacoustics": { id: "psychoacoustics", titleKey: "tool.psychoacoustics.title" },
  "/tools/pipeline": { id: "pipeline", titleKey: "tool.pipeline.title" },
  "/tools/ai": { id: null, titleKey: "tool.ai.title" },
  "/experiments": { id: null, titleKey: "nav.experiments" },
};

export function LabReportButton() {
  const { t, i18n } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function exportReport(): Promise<void> {
    const state = useSessionStore.getState();
    if (state.original === null) {
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const tool = ROUTE_TOOLS[window.location.pathname];
      const toolTitle = tool === undefined ? t("report.toolFallback") : t(tool.titleKey);
      const scope = document.querySelector("main") ?? document.body;
      const parameters: readonly LabReportParameter[] = collectPageParameters(scope);
      const figures = collectCanvasFigures(scope, 8, (index) =>
        t("report.labels.figure", { index }),
      );
      const metricRows: LabReportMetric[] = [];
      let metricNote: string | null = null;
      if (state.processed === null) {
        metricNote = t("metrics.missing");
      } else {
        const mode =
          state.original.channels.length > 1 &&
          state.processed.channels.length === state.original.channels.length
            ? "both"
            : "mono";
        const selection = selectMetricsLanes(state.original, state.processed, mode);
        if (!selection.ok) {
          metricNote =
            selection.problem === "rateMismatch"
              ? t("metrics.mismatch.rate")
              : selection.problem === "lengthMismatch"
                ? t("metrics.mismatch.length")
                : selection.problem === "channelsMismatch"
                  ? t("metrics.mismatch.channels")
                  : t("metrics.missing");
        } else {
          try {
            for (const lane of selection.lanes) {
              const metrics = await measureQualityMetrics(
                lane.reference,
                lane.test,
                state.original.sampleRateHz,
              );
              const group = channelLabel(t, lane.id);
              metricRows.push(
                { group, label: t("metrics.label.mse"), value: formatMetric(metrics.mse, 6) },
                {
                  group,
                  label: t("metrics.label.snr"),
                  value: `${formatMetric(metrics.snrDb)} dB`,
                },
                {
                  group,
                  label: t("metrics.label.segmentalSnr"),
                  value: `${formatMetric(metrics.segmentalSnrDb)} dB`,
                },
                {
                  group,
                  label: t("metrics.label.psnr"),
                  value: `${formatMetric(metrics.psnrDb)} dB`,
                },
                {
                  group,
                  label: t("metrics.label.samples"),
                  value: String(metrics.sampleCount),
                },
              );
            }
          } catch {
            metricNote = t("report.metricsFailed");
          }
        }
      }
      const theoryEntry = tool === undefined || tool.id === null ? null : TOOL_THEORY[tool.id];
      const theory =
        theoryEntry === null
          ? null
          : {
              title: t(theoryEntry.titleKey),
              sections: theoryEntry.sections.map((section) => ({
                heading: t(section.headingKey),
                body: t(section.bodyKey),
                ...(section.formula === undefined ? {} : { formula: section.formula }),
              })),
            };
      const source = state.original;
      const html = buildLabReportHtml({
        title: t("report.title"),
        toolTitle,
        generatedAt: `${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
        url: window.location.href,
        lang: i18n.language.startsWith("fa") ? "fa" : "en",
        dir: document.documentElement.getAttribute("dir") === "rtl" ? "rtl" : "ltr",
        source: {
          name: source.name,
          durationS: source.samples.length / source.sampleRateHz,
          sampleRateHz: source.sampleRateHz,
          channelCount: source.channels.length,
          processedLabel: state.processed?.label ?? null,
          processedDurationS:
            state.processed === null
              ? null
              : state.processed.samples.length / state.processed.sampleRateHz,
        },
        parameters,
        metrics: metricRows,
        metricNote,
        figures,
        labels: {
          source: t("report.labels.source"),
          parameters: t("report.labels.parameters"),
          setting: t("report.labels.setting"),
          value: t("report.labels.value"),
          metrics: t("report.labels.metrics"),
          lane: t("report.labels.lane"),
          metric: t("report.labels.metric"),
          figures: t("report.labels.figures"),
          notice: t("report.labels.notice"),
          print: t("report.labels.print"),
          name: t("report.labels.name"),
          duration: t("report.labels.duration"),
          sampleRate: t("report.labels.sampleRate"),
          channels: t("report.labels.channels"),
          processedLane: t("report.labels.processedLane"),
          processedDuration: t("report.labels.processedDuration"),
          figure: t("report.labels.figure"),
        },
        theory,
      });
      downloadLabReportHtml(html, `avalab-lab-report-${Date.now()}.html`);
    } catch (error) {
      console.error("Lab report export failed", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      data-testid="report.download"
      disabled={original === null || busy}
      title={
        original === null
          ? t("report.needSource")
          : failed
            ? t("report.failed")
            : t("report.button")
      }
      aria-label={t("report.button")}
      onClick={() => {
        void exportReport();
      }}
    >
      {busy ? t("report.busy") : t("report.button")}
    </Button>
  );
}
