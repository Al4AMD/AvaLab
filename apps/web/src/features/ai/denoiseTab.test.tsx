import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { SetProcessedResult } from "../../session/store";
import type { AiModelState } from "./aiClient";
import type { AiJobStatus } from "./useAiJob";

type Modules = {
  readonly DenoiseView: typeof import("./denoiseTab").DenoiseView;
  readonly denoiseRunDisabled: typeof import("./denoiseTab").denoiseRunDisabled;
  readonly installDenoiseAudio: typeof import("./denoiseTab").installDenoiseAudio;
  readonly readDenoiseResult: typeof import("./denoiseTab").readDenoiseResult;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [tab, i18n] = await Promise.all([import("./denoiseTab"), import("../../i18n")]);
  modules = { ...tab, t: i18n.default.t.bind(i18n.default) };
});

function view(
  patch: Partial<Parameters<Modules["DenoiseView"]>[0]> = {},
): Parameters<Modules["DenoiseView"]>[0] {
  return {
    backendOnline: true,
    modelState: "available" as AiModelState,
    modelId: "Ceva-IP/DPDFNet",
    hasSource: true,
    hasProcessed: false,
    playbackMode: "original",
    status: "idle" as AiJobStatus,
    progress: 0,
    errorKey: null,
    demoErrorKey: null,
    demoLoading: false,
    rmsInDb: null,
    rmsOutDb: null,
    excerptSeconds: 19.6,
    onLoadDemo: () => {},
    onRun: () => {},
    onCancel: () => {},
    onPlayOriginal: () => {},
    onPlayDenoised: () => {},
    ...patch,
  };
}

describe("denoise tab", () => {
  it("disables Run when the model is missing and explains why", () => {
    const markup = renderToStaticMarkup(
      <modules.DenoiseView {...view({ modelState: "missing" })} />,
    );

    expect(modules.denoiseRunDisabled(view({ modelState: "missing" }))).toBe(true);
    expect(markup).toContain(modules.t("ai.denoise.modelMissing"));
    expect(markup).toContain('data-testid="ai.run"');
  });

  it("renders progress while a job runs", () => {
    const markup = renderToStaticMarkup(
      <modules.DenoiseView {...view({ status: "running", progress: 0.42 })} />,
    );

    expect(markup).toContain(modules.t("ai.job.running", { percent: 42 }));
    expect(markup).toContain('data-testid="ai.denoise.progress"');
    expect(markup).toContain(modules.t("ai.cancel"));
    expect(markup).toContain('data-testid="ai.cancel"');
  });

  it("marks the denoised A/B lane as pressed only when it exists", () => {
    const markup = renderToStaticMarkup(
      <modules.DenoiseView
        {...view({ hasProcessed: true, playbackMode: "processed", status: "done", progress: 1 })}
      />,
    );

    expect(markup).toContain(modules.t("ai.denoise.ab.denoised"));
    expect(markup).toContain('aria-pressed="true"');
  });

  it("installs a decoded result as the processed lane", async () => {
    const calls: Array<{ samples: Float32Array; rate: number; label: string }> = [];
    const setProcessed = (
      samples: Float32Array,
      rate: number,
      label: string,
    ): SetProcessedResult => {
      calls.push({ samples, rate, label });
      return { ok: true };
    };
    const samples = new Float32Array([0.1, -0.1]);

    const installed = await modules.installDenoiseAudio({
      audioId: "result-1",
      label: "denoise",
      fetchAudio: async () => ({ samples, sampleRateHz: 48_000 }),
      setProcessed,
    });

    expect(installed.sampleRateHz).toBe(48_000);
    expect(calls).toEqual([{ samples, rate: 48_000, label: "denoise" }]);
  });

  it("reads the result id and RMS stats defensively", () => {
    expect(
      modules.readDenoiseResult({
        result_audio_id: "result-1",
        stats: { model_id: "Ceva-IP/DPDFNet", rms_in_db: -18.2, rms_out_db: -24.8 },
      }),
    ).toEqual({
      audioId: "result-1",
      modelId: "Ceva-IP/DPDFNet",
      rmsInDb: -18.2,
      rmsOutDb: -24.8,
    });
    expect(modules.readDenoiseResult({ stats: {} })).toBeNull();
  });
});
