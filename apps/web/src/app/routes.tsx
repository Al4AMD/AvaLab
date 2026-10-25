import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createBrowserRouter, type RouteObject, redirect } from "react-router";
import { useSessionStore } from "../session/store";
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
      {
        path: "tools/waveform",
        element: (
          <>
            <WaveformStubPing />
            <ToolStub tool="waveform" />
          </>
        ),
      },
      { path: "tools/spectrogram", element: <ToolStub tool="spectrogram" /> },
      { path: "tools/fftview", element: <ToolStub tool="fftview" /> },
      { path: "tools/generator", element: <ToolStub tool="generator" /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
