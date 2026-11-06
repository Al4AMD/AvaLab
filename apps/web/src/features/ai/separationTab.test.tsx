import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { SetProcessedResult } from "../../session/store";
import type { AiModelState } from "./aiClient";
import type { AiJobStatus } from "./useAiJob";

type Modules = {
  readonly SeparationView: typeof import("./separationTab").SeparationView;
  readonly installStemAudio: typeof import("./separationTab").installStemAudio;
  readonly readSeparationResult: typeof import("./separationTab").readSeparationResult;
  readonly separationRunDisabled: typeof import("./separationTab").separationRunDisabled;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [tab, i18n] = await Promise.all([import("./separationTab"), import("../../i18n")]);
  modules = { ...tab, t: i18n.default.t.bind(i18n.default) };
});

const STEMS = [
  { name: "drums", audioId: "a-1", sampleRateHz: 48_000, durationS: 15 },
  { name: "bass", audioId: "a-2", sampleRateHz: 48_000, durationS: 15 },
  { name: "other", audioId: "a-3", sampleRateHz: 48_000, durationS: 15 },
  { name: "vocals", audioId: "a-4", sampleRateHz: 48_000, durationS: 15 },
] as const;

function view(
  patch: Partial<Parameters<Modules["SeparationView"]>[0]> = {},
): Parameters<Modules["SeparationView"]>[0] {
  return {
    backendOnline: true,
    modelState: "available" as AiModelState,
    modelId: "adefossez/HTDemucs",
    hasSource: true,
    stems: [],
    selectedStem: null,
    status: "idle" as AiJobStatus,
    progress: 0,
    errorKey: null,
    demoErrorKey: null,
    demoLoading: false,
    excerptSeconds: 15,
    onLoadDemo: () => {},
    onRun: () => {},
    onCancel: () => {},
    onPlayStem: () => {},
    ...patch,
  };
}

describe("separation tab", () => {
  it("reads four stems in the fixed backend order", () => {
    const info = modules.readSeparationResult({
      kind: "stems",
      stems: [...STEMS].reverse().map((stem) => ({
        name: stem.name,
        result_audio_id: stem.audioId,
        sample_rate_hz: stem.sampleRateHz,
        duration_s: stem.durationS,
      })),
      stats: { model_id: "adefossez/HTDemucs" },
    });

    expect(info?.modelId).toBe("adefossez/HTDemucs");
    expect(info?.stems.map((stem) => stem.name)).toEqual(["drums", "bass", "other", "vocals"]);
    expect(info?.stems[0]?.audioId).toBe("a-1");
  });

  it("renders four playable stem rows", () => {
    const markup = renderToStaticMarkup(<modules.SeparationView {...view({ stems: STEMS })} />);

    for (const stem of STEMS) {
      expect(markup).toContain(modules.t(`ai.separation.stems.${stem.name}`));
      expect(markup).toContain(`data-testid="ai.separation.play.${stem.name}"`);
    }
    expect(markup).toContain(modules.t("ai.separation.eta"));
  });

  it("installs a selected stem as the processed playback source", async () => {
    const calls: Array<{
      samples: Float32Array;
      rate: number;
      label: string;
      options: unknown;
    }> = [];
    const setProcessed = (
      samples: Float32Array,
      rate: number,
      label: string,
      options?: { sourceHash?: string; sourceStartSample?: number },
    ): SetProcessedResult => {
      calls.push({ samples, rate, label, options });
      return { ok: true };
    };
    const samples = new Float32Array([0.25, -0.25]);

    await modules.installStemAudio({
      name: "vocals",
      audioId: "a-4",
      sourceHash: "abc123",
      sourceStartSample: 0,
      fetchAudio: async () => ({ samples, sampleRateHz: 48_000 }),
      setProcessed,
    });

    expect(calls).toEqual([
      {
        samples,
        rate: 48_000,
        label: "separated-vocals",
        options: { sourceHash: "abc123", sourceStartSample: 0 },
      },
    ]);
  });

  it("disables Run when the model is missing and explains why", () => {
    const markup = renderToStaticMarkup(
      <modules.SeparationView {...view({ modelState: "missing" })} />,
    );

    expect(
      modules.separationRunDisabled({
        backendOnline: true,
        modelState: "missing",
        hasSource: true,
        status: "idle",
      }),
    ).toBe(true);
    expect(markup).toContain(modules.t("ai.separation.modelMissing"));
    expect(markup).toContain('data-testid="ai.run"');
  });

  it("shows a translated error row", () => {
    const markup = renderToStaticMarkup(
      <modules.SeparationView {...view({ status: "error", errorKey: "ai.error.ml_failed" })} />,
    );

    expect(markup).toContain(modules.t("ai.error.ml_failed"));
    expect(markup).toContain('data-testid="ai.separation.error"');
  });

  it("shows progress and cancel while a job runs", () => {
    const markup = renderToStaticMarkup(
      <modules.SeparationView {...view({ status: "running", progress: 0.4 })} />,
    );

    expect(markup).toContain(modules.t("ai.job.running", { percent: 40 }));
    expect(markup).toContain('data-testid="ai.separation.progress"');
    expect(markup).toContain('data-testid="ai.cancel"');
  });
});
