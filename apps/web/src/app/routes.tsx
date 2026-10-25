import { useEffect, useState } from "react";
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

/** Bucket width of the stub's waveform-overview plumbing probe (Plan 03
 * paints this envelope; the count only proves the pipeline here). */
const WAVEFORM_STUB_BUCKET_COUNT = 32;
/** Probe size: far under every loadSource cap; deterministic sine + LCG
 * noise (test-doubles shape, NOT @avalab/dsp math — no main-thread DSP). */
const WAVEFORM_STUB_PROBE_SAMPLES = 2048;

/**
 * Deterministic demo probe for the waveform stub: plain Math.sin + LCG fill.
 * Kept inline so the view tree imports no dsp module (AGENTS §9); the WORKER
 * does the real bucketing through `waveformOverview`.
 */
function waveformProbeSamples(sampleCount: number): Float32Array {
  let state = 0x183f2b;
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    samples[index] =
      Math.sin((2 * Math.PI * 440 * index) / 48000) * 0.4 + ((state % 2001) - 1000) / 100000;
  }
  return samples;
}

/**
 * Plumbing probe for the waveform overview op (Plan 01 Task 4): loads a
 * deterministic demo probe ONCE (guarded: never clobbers a session source)
 * and fires the store's `deriveWithSource("waveformOverview", …)` — the
 * worker buckets the samples and the readout renders the returned bucket
 * count. No canvas yet (Plan 03); no i18n copy: raw technical readout
 * (Latin digits, LTR); the stub body copy stays unchanged. Rejections
 * (worker unavailable, noSource) render nothing and never surface as
 * unhandled console rejections.
 */
function WaveformStubOverview() {
  const derived = useSessionStore((state) => state.derived);
  const [overviewKey, setOverviewKey] = useState<string | null>(null);

  useEffect(() => {
    const before = useSessionStore.getState();
    if (before.original === null) {
      const load = before.loadSource(
        waveformProbeSamples(WAVEFORM_STUB_PROBE_SAMPLES),
        48_000,
        "waveform-stub-probe.wav",
        "demoClip",
      );
      if (!load.ok) {
        return; // unreachable for the built-in probe; stay silent by contract
      }
    }
    const state = useSessionStore.getState();
    const original = state.original;
    if (original === null) {
      return;
    }
    const ticket = state.deriveWithSource("waveformOverview", {
      bucketCount: WAVEFORM_STUB_BUCKET_COUNT,
      sampleRateHz: original.sampleRateHz,
    });
    setOverviewKey(ticket.key);
    // Store failures are the readout's to ignore (stub): swallow typedly.
    ticket.outcome.catch(() => undefined);
  }, []);

  const entry = overviewKey === null ? undefined : derived.get(overviewKey);
  if (entry === undefined) {
    return null;
  }
  // DerivedEntry.result is unknown by contract; the overview result's shape
  // is pinned by the op table (WaveformOverviewResult).
  const payload = (entry.result as { payload?: { buffer: ArrayBuffer; byteLength: number } })
    .payload;
  if (payload === undefined) {
    return null;
  }
  const bucketCount = payload.byteLength / 8; // 2 Float32 values per bucket
  if (!Number.isInteger(bucketCount)) {
    return null;
  }
  return (
    <span data-testid="waveform.stub.overview" dir="ltr" className="text-xs text-muted">
      {bucketCount}
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
            <WaveformStubOverview />
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
