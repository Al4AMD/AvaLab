import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createBrowserRouter, type RouteObject, redirect } from "react-router";
import { dspWorkerRpc } from "../session/rpc";
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
 * Plumbing probe for the DSP worker RPC (Plan 01 Task 2): fires one
 * `sessionPing` on mount and shows the echoed payload byte length. StrictMode
 * double-mount exercises the supersede path — the first call resolves
 * `{cancelled: true}`, the second renders. No i18n copy: this is a raw
 * technical readout (Latin digits, LTR); the stub body copy stays unchanged.
 */
function WaveformStubPing() {
  const [pingByteLength, setPingByteLength] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const bytes = new Uint8Array(4);
    dspWorkerRpc
      .call(
        "sessionPing",
        { count: 1 },
        { buffer: bytes.buffer, byteOffset: 0, byteLength: bytes.byteLength },
      )
      .then(
        (outcome) => {
          if (!mounted || !("payload" in outcome) || outcome.payload === undefined) {
            return; // cancelled, or the worker echoed without a payload
          }
          setPingByteLength(outcome.payload.byteLength);
        },
        (error: unknown) => {
          // Worker unavailable (build anomaly, worker host restriction): the
          // stub keeps its plain body; surfaced in the console as a warning.
          console.warn("avalab waveform stub: sessionPing failed", error);
        },
      );
    return () => {
      mounted = false;
    };
  }, []);

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
