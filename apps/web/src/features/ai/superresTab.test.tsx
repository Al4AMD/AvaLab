import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AiModelState } from "./aiClient";
import type { AiJobStatus } from "./useAiJob";

type Modules = {
  readonly SuperresView: typeof import("./superresTab").SuperresView;
  readonly isSupportedLowRateHz: typeof import("./superresTab").isSupportedLowRateHz;
  readonly readSuperresResult: typeof import("./superresTab").readSuperresResult;
  readonly superresRunDisabled: typeof import("./superresTab").superresRunDisabled;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [tab, i18n] = await Promise.all([import("./superresTab"), import("../../i18n")]);
  modules = { ...tab, t: i18n.default.t.bind(i18n.default) };
});

function view(
  patch: Partial<Parameters<Modules["SuperresView"]>[0]> = {},
): Parameters<Modules["SuperresView"]>[0] {
  return {
    backendOnline: true,
    modelState: "available" as AiModelState,
    modelId: "TigreGotico/audiosronnx-lavasr",
    hasSource: true,
    lowRateHz: 8_000,
    path: "lavasr",
    busy: false,
    status: "idle" as AiJobStatus,
    progress: 0,
    errorKey: null,
    demoErrorKey: null,
    demoLoading: false,
    hasBandlimited: false,
    hasRestored: false,
    selectedLane: "original",
    modelInputRateHz: null,
    modelOutputRateHz: null,
    excerptSeconds: 19.6,
    onLoadDemo: () => {},
    onLowRateChange: () => {},
    onPathChange: () => {},
    onRun: () => {},
    onCancel: () => {},
    onPlayOriginal: () => {},
    onPlayBandlimited: () => {},
    onPlayRestored: () => {},
    ...patch,
  };
}

describe("super-resolution tab", () => {
  it("disables LavaSR without a downloaded model and explains why", () => {
    const markup = renderToStaticMarkup(
      <modules.SuperresView {...view({ modelState: "missing" })} />,
    );

    expect(
      modules.superresRunDisabled({
        path: "lavasr",
        backendOnline: true,
        modelState: "missing",
        hasSource: true,
        busy: false,
      }),
    ).toBe(true);
    expect(markup).toContain(modules.t("ai.superres.modelMissing"));
    expect(markup).toContain('data-testid="ai.run"');
  });

  it("keeps the sinc baseline available offline and without a model", () => {
    expect(
      modules.superresRunDisabled({
        path: "sinc",
        backendOnline: false,
        modelState: "missing",
        hasSource: true,
        busy: false,
      }),
    ).toBe(false);

    const markup = renderToStaticMarkup(
      <modules.SuperresView
        {...view({ path: "sinc", backendOnline: false, modelState: "missing" })}
      />,
    );
    expect(markup).not.toContain(modules.t("ai.superres.modelMissing"));
    expect(markup).not.toContain(modules.t("ai.caption.approximation"));
    expect(markup).toContain(modules.t("ai.superres.pathSinc"));
  });

  it("shows the AI caption only for the LavaSR restore path", () => {
    const markup = renderToStaticMarkup(<modules.SuperresView {...view()} />);

    expect(markup).toContain(modules.t("ai.superres.pathLavasr"));
    expect(markup).toContain(modules.t("ai.caption.approximation"));
  });

  it("marks the selected A/B lane as pressed and enables available lanes", () => {
    const markup = renderToStaticMarkup(
      <modules.SuperresView
        {...view({ hasBandlimited: true, hasRestored: true, selectedLane: "bandlimited" })}
      />,
    );

    expect(markup).toContain(modules.t("ai.superres.ab.original"));
    expect(markup).toContain(modules.t("ai.superres.ab.bandlimited"));
    expect(markup).toContain(modules.t("ai.superres.ab.restored"));
    expect(markup).toContain('data-testid="ai.superres.ab.bandlimited" aria-pressed="true"');
    expect(markup).not.toContain('data-testid="ai.superres.ab.restored" aria-pressed="true"');
  });

  it("renders job progress and the model/output rates", () => {
    const markup = renderToStaticMarkup(
      <modules.SuperresView
        {...view({
          status: "running",
          progress: 0.37,
          modelInputRateHz: 0,
          modelOutputRateHz: 48_000,
        })}
      />,
    );

    expect(markup).toContain(modules.t("ai.job.running", { percent: 37 }));
    expect(markup).toContain('data-testid="ai.superres.progress"');
    expect(markup).toContain(modules.t("ai.superres.rates", { input: "8–48", output: "48" }));
  });

  it("accepts only the 8/12/16 kHz band-limit targets", () => {
    expect(modules.isSupportedLowRateHz(8_000)).toBe(true);
    expect(modules.isSupportedLowRateHz(12_000)).toBe(true);
    expect(modules.isSupportedLowRateHz(16_000)).toBe(true);
    expect(modules.isSupportedLowRateHz(11_025)).toBe(false);
    expect(modules.isSupportedLowRateHz(Number.NaN)).toBe(false);
  });

  it("reads the restored audio id and rate stats defensively", () => {
    expect(
      modules.readSuperresResult({
        result_audio_id: "result-2",
        stats: {
          model_id: "TigreGotico/audiosronnx-lavasr",
          input_sample_rate_hz: 0,
          output_sample_rate_hz: 48_000,
        },
      }),
    ).toEqual({
      audioId: "result-2",
      modelId: "TigreGotico/audiosronnx-lavasr",
      inputRateHz: 0,
      outputRateHz: 48_000,
    });
    expect(modules.readSuperresResult({ stats: {} })).toBeNull();
  });
});
