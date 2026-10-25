import { useTranslation } from "react-i18next";
import { createBrowserRouter, type RouteObject, redirect } from "react-router";

import { AppLayout } from "./layout";

export const TOOL_IDS = ["waveform", "spectrogram", "fftview", "generator"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export function toolPath(toolId: ToolId): string {
  return `/tools/${toolId}`;
}

/**
 * Stub body shown until each tool view lands later in this wave (Plan 02–05).
 * Keys are referenced as literal t() calls (not t(`tool.${id}`)) so the i18n
 * key checker sees every key without widening the dynamic allowlist.
 */
function ToolStub({ tool }: { tool: ToolId }) {
  const { t } = useTranslation();
  const titles: Record<ToolId, string> = {
    waveform: t("tool.waveform.title"),
    spectrogram: t("tool.spectrogram.title"),
    fftview: t("tool.fftview.title"),
    generator: t("tool.generator.title"),
  };
  const stubTexts: Record<ToolId, string> = {
    waveform: t("tool.waveform.stub"),
    spectrogram: t("tool.spectrogram.stub"),
    fftview: t("tool.fftview.stub"),
    generator: t("tool.generator.stub"),
  };
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-2xl font-semibold">{titles[tool]}</h2>
      <p className="text-sm text-muted">{stubTexts[tool]}</p>
    </section>
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
      { path: "tools/waveform", element: <ToolStub tool="waveform" /> },
      { path: "tools/spectrogram", element: <ToolStub tool="spectrogram" /> },
      { path: "tools/fftview", element: <ToolStub tool="fftview" /> },
      { path: "tools/generator", element: <ToolStub tool="generator" /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
