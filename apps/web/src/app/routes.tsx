import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createBrowserRouter, type RouteObject, redirect } from "react-router";
import { AiLabView } from "../features/ai/aiLabView";
import { CodecLabView } from "../features/codecLab/codecLabView";
import { ExperimentsView } from "../features/education/experimentsView";
import { ExtentView } from "../features/extent/extentView";
import { FftView } from "../features/fftview/fftView";
import { FilterLabView } from "../features/filters/filterLabView";
import { GeneratorView } from "../features/generator/generatorView";
import { MetricsView } from "../features/metrics/metricsView";
import { PsychoacousticsView } from "../features/psychoacoustics/psychoacousticsView";
import { ReverbView } from "../features/reverb/reverbView";
import { SamplingView } from "../features/sampling/samplingView";
import { SpectrogramView } from "../features/spectrogram/spectrogramView";
import { SpectrumEditView } from "../features/spectrumEdit/spectrumEditView";
import { SpeedView } from "../features/speed/speedView";
import { WaveformView } from "../features/waveform/waveformView";
import { useSessionStore } from "../session/store";
import { AppLayout } from "./layout";

const PipelineView = lazy(() => import("../features/pipeline/pipelineView"));

export const TOOL_IDS = [
  "waveform",
  "spectrogram",
  "fftview",
  "filters",
  "generator",
  "speed",
  "sampling",
  "extent",
  "reverb",
  "spectrum-edit",
  "codec-lab",
  "metrics",
  "psychoacoustics",
  "pipeline",
  "ai",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export function toolPath(toolId: ToolId): string {
  return `/tools/${toolId}`;
}

/**
 * Plumbing probe for the DSP worker RPC (Plan 01 Tasks 2–3): renders the
 * echoed diagnostics-ping payload byte length from the SESSION STORE. Ruling
 * R23: the store is the sole view-tree RPC caller — this stub fires the
 * store's guarded `sessionTroubleshootingPing` action on mount (StrictMode
 * double-mount is a no-op under the action's pending/done guard) and reads
 * `diagnostics.pingByteLength` back. No i18n copy: raw technical readout
 * (Latin digits, LTR); the stub body copy stays unchanged.
 */
function WaveformStubPing() {
  const pingByteLength = useSessionStore((state) => state.diagnostics.pingByteLength);
  const sessionTroubleshootingPing = useSessionStore((state) => state.sessionTroubleshootingPing);

  useEffect(() => {
    sessionTroubleshootingPing();
  }, [sessionTroubleshootingPing]);

  if (pingByteLength === null) {
    return null;
  }
  return (
    <span data-testid="waveform.stub.ping" dir="ltr" className="text-xs text-muted">
      {pingByteLength}
    </span>
  );
}

/** Lazy F15 chunk; the fallback keeps the title visible while the canvas code loads. */
function PipelineRoute() {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">{t("tool.pipeline.title")}</h2>
          <p className="text-sm text-muted">{t("pipeline.loading")}</p>
        </div>
      }
    >
      <PipelineView />
    </Suspense>
  );
}

/** Data-router route table (spec §2.1/§2.5): layout shell + / redirect + /tools/<id>. */
export const appRoutes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      {
        index: true,
        // Loader redirect (not <Navigate>) so the redirect happens in the data
        // layer — testable without a DOM render and works on first paint.
        loader: () => redirect(toolPath("waveform")),
      },
      { path: "experiments", element: <ExperimentsView /> },
      {
        path: "tools/waveform",
        element: (
          <>
            <WaveformStubPing />
            <WaveformView />
          </>
        ),
      },
      { path: "tools/spectrogram", element: <SpectrogramView /> },
      { path: "tools/fftview", element: <FftView /> },
      { path: "tools/filters", element: <FilterLabView /> },
      { path: "tools/generator", element: <GeneratorView /> },
      { path: "tools/speed", element: <SpeedView /> },
      { path: "tools/sampling", element: <SamplingView /> },
      { path: "tools/extent", element: <ExtentView /> },
      { path: "tools/reverb", element: <ReverbView /> },
      { path: "tools/spectrum-edit", element: <SpectrumEditView /> },
      { path: "tools/codec-lab", element: <CodecLabView /> },
      { path: "tools/metrics", element: <MetricsView /> },
      { path: "tools/psychoacoustics", element: <PsychoacousticsView /> },
      { path: "tools/pipeline", element: <PipelineRoute /> },
      { path: "tools/ai", element: <AiLabView /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
