import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AiJobStatus } from "./useAiJob";

type Modules = {
  readonly ClassificationView: typeof import("./classificationTab").ClassificationView;
  readonly classificationRunDisabled: typeof import("./classificationTab").classificationRunDisabled;
  readonly readClassificationResult: typeof import("./classificationTab").readClassificationResult;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [tab, i18n] = await Promise.all([import("./classificationTab"), import("../../i18n")]);
  modules = { ...tab, t: i18n.default.t.bind(i18n.default) };
});

const classified = {
  kind: "classification",
  labels: [
    { label: "Music", probability: 0.81 },
    { label: "Singing", probability: 0.42 },
    { label: "Speech", probability: 0.17 },
  ],
  stats: {
    model_id: "MIT/ast-finetuned-audioset-10-10-0.4593",
    duration_s: 15,
    analyzed_s: 10,
    window_s: 10,
    window_count: 2,
    top_k: 3,
  },
};

function view(
  patch: Partial<Parameters<Modules["ClassificationView"]>[0]> = {},
): Parameters<Modules["ClassificationView"]>[0] {
  return {
    backendOnline: true,
    modelState: "available",
    modelId: "MIT/ast-finetuned-audioset-10-10-0.4593",
    hasSource: true,
    result: null,
    status: "idle" as AiJobStatus,
    progress: 0,
    errorKey: null,
    demoErrorKey: null,
    demoLoading: false,
    excerptSeconds: 15,
    onLoadDemo: () => {},
    onRun: () => {},
    onCancel: () => {},
    ...patch,
  };
}

describe("AudioSet classification", () => {
  it("parses ranked labels, clamps scores and reads window stats", () => {
    const parsed = modules.readClassificationResult(classified);
    expect(parsed).toEqual({
      labels: [
        { label: "Music", probability: 0.81 },
        { label: "Singing", probability: 0.42 },
        { label: "Speech", probability: 0.17 },
      ],
      modelId: "MIT/ast-finetuned-audioset-10-10-0.4593",
      analyzedS: 10,
      windowS: 10,
      windowCount: 2,
    });
    expect(
      modules.readClassificationResult({
        ...classified,
        labels: [{ label: "Music", probability: 4 }, { label: "Broken" }],
      })?.labels,
    ).toEqual([{ label: "Music", probability: 1 }]);
  });

  it("rejects other result kinds and malformed label arrays", () => {
    expect(modules.readClassificationResult({ kind: "audio", result_audio_id: "x" })).toBeNull();
    expect(modules.readClassificationResult({ kind: "classification" })).toBeNull();
    expect(modules.readClassificationResult({ ...classified, labels: [] })?.labels).toEqual([]);
  });

  it("disables Run offline, without a source, without the model, or while busy", () => {
    expect(
      modules.classificationRunDisabled({
        backendOnline: true,
        modelState: "available",
        hasSource: true,
        status: "idle",
      }),
    ).toBe(false);
    expect(
      modules.classificationRunDisabled({
        backendOnline: false,
        modelState: "available",
        hasSource: true,
        status: "idle",
      }),
    ).toBe(true);
    expect(
      modules.classificationRunDisabled({
        backendOnline: true,
        modelState: "missing",
        hasSource: true,
        status: "idle",
      }),
    ).toBe(true);
    expect(
      modules.classificationRunDisabled({
        backendOnline: true,
        modelState: "available",
        hasSource: false,
        status: "idle",
      }),
    ).toBe(true);
    expect(
      modules.classificationRunDisabled({
        backendOnline: true,
        modelState: "available",
        hasSource: true,
        status: "running",
      }),
    ).toBe(true);
  });

  it("renders ranked labels with percentages and the window line", () => {
    const markup = renderToStaticMarkup(
      <modules.ClassificationView
        {...view({
          result: modules.readClassificationResult(classified),
          status: "done",
          progress: 1,
        })}
      />,
    );

    expect(markup).toContain('data-testid="ai.classification.list"');
    expect(markup).toContain("Music");
    expect(markup).toContain(modules.t("ai.classification.labelProbability", { percent: "81.0" }));
    expect(markup).toContain(
      modules.t("ai.classification.windows", { seconds: "10.0", count: "2", window: "10.0" }),
    );
    expect(markup).toContain(modules.t("ai.caption.approximation"));
  });

  it("shows the empty-label message and progress while running", () => {
    const markup = renderToStaticMarkup(
      <modules.ClassificationView
        {...view({
          result: modules.readClassificationResult({ ...classified, labels: [] }),
          status: "running",
          progress: 0.42,
        })}
      />,
    );

    expect(markup).toContain(modules.t("ai.classification.empty"));
    expect(markup).toContain(modules.t("ai.job.running", { percent: 42 }));
    expect(markup).toContain('data-testid="ai.cancel"');
  });
});
