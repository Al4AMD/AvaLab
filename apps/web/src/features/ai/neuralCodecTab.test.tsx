import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AiModelState } from "./aiClient";
import type { AiJobStatus } from "./useAiJob";

type Modules = {
  readonly NeuralCodecView: typeof import("./neuralCodecTab").NeuralCodecView;
  readonly neuralCodecRunDisabled: typeof import("./neuralCodecTab").neuralCodecRunDisabled;
  readonly readNeuralCodecResult: typeof import("./neuralCodecTab").readNeuralCodecResult;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [tab, i18n] = await Promise.all([import("./neuralCodecTab"), import("../../i18n")]);
  modules = { ...tab, t: i18n.default.t.bind(i18n.default) };
});

function view(
  patch: Partial<Parameters<Modules["NeuralCodecView"]>[0]> = {},
): Parameters<Modules["NeuralCodecView"]>[0] {
  return {
    backendOnline: true,
    modelState: "available" as AiModelState,
    modelId: "facebook/encodec_48khz",
    hasSource: true,
    bandwidthKbps: 6,
    result: null,
    snrDb: null,
    decodedReady: false,
    playbackMode: "original",
    status: "idle" as AiJobStatus,
    progress: 0,
    errorKey: null,
    excerptSeconds: 30,
    onBandwidthChange: () => {},
    onRun: () => {},
    onCancel: () => {},
    onPlayOriginal: () => {},
    onPlayDecoded: () => {},
    ...patch,
  };
}

describe("neural codec tab", () => {
  it("reads the estimated stream stats", () => {
    const info = modules.readNeuralCodecResult({
      result_audio_id: "audio-1",
      stats: {
        model_id: "facebook/encodec_48khz",
        bandwidth_kbps: 6,
        estimated_size_bytes: 750,
        estimated_bitrate_kbps: 6,
        duration_s: 1,
      },
    });

    expect(info).toEqual({
      audioId: "audio-1",
      modelId: "facebook/encodec_48khz",
      bandwidthKbps: 6,
      estimatedSizeBytes: 750,
      estimatedBitrateKbps: 6,
      durationS: 1,
    });
  });

  it("renders the bandwidth selector with the five supported targets", () => {
    const markup = renderToStaticMarkup(<modules.NeuralCodecView {...view()} />);

    for (const kbps of ["1.5", "3", "6", "12", "24"]) {
      expect(markup).toContain(`value="${kbps}"`);
    }
    expect(markup).toContain('value="6" selected=""');
  });

  it("shows A/B controls and disables the decoded lane until it is installed", () => {
    const markup = renderToStaticMarkup(
      <modules.NeuralCodecView
        {...view({
          result: {
            audioId: "audio-1",
            modelId: "facebook/encodec_48khz",
            bandwidthKbps: 6,
            estimatedSizeBytes: 750,
            estimatedBitrateKbps: 6,
            durationS: 1,
          },
          snrDb: 12.5,
        })}
      />,
    );

    expect(markup).toContain('data-testid="ai.neuralCodec.ab.original"');
    expect(markup).toContain('data-testid="ai.neuralCodec.ab.decoded"');
    expect(markup).toMatch(/data-testid="ai\.neuralCodec\.ab\.decoded"[^>]*disabled/);
    expect(markup).toContain(modules.t("ai.neuralCodec.stats.snrValue", { db: "12.50" }));
  });

  it("labels the size and bitrate as estimates", () => {
    const markup = renderToStaticMarkup(
      <modules.NeuralCodecView
        {...view({
          result: {
            audioId: "audio-1",
            modelId: "facebook/encodec_48khz",
            bandwidthKbps: 6,
            estimatedSizeBytes: 750,
            estimatedBitrateKbps: 6,
            durationS: 1,
          },
          snrDb: 12.5,
        })}
      />,
    );

    expect(markup).toContain(modules.t("ai.neuralCodec.stats.bitrateValue", { kbps: "6.0" }));
    expect(markup).toContain(modules.t("ai.neuralCodec.stats.sizeValue", { bytes: "750" }));
    expect(markup).toContain(modules.t("ai.neuralCodec.estimatedNote"));
  });

  it("disables Run when the model is missing", () => {
    const markup = renderToStaticMarkup(
      <modules.NeuralCodecView {...view({ modelState: "missing" })} />,
    );

    expect(
      modules.neuralCodecRunDisabled({
        backendOnline: true,
        modelState: "missing",
        hasSource: true,
        status: "idle",
      }),
    ).toBe(true);
    expect(markup).toContain(modules.t("ai.neuralCodec.modelMissing"));
    expect(markup).toContain('data-testid="ai.run"');
  });
});
