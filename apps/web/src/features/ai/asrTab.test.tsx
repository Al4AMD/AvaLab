import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AiModelState } from "./aiClient";
import type { AiJobStatus } from "./useAiJob";

type Modules = {
  readonly AsrView: typeof import("./asrTab").AsrView;
  readonly asrRunDisabled: typeof import("./asrTab").asrRunDisabled;
  readonly fetchReferenceTranscript: typeof import("./asrTab").fetchReferenceTranscript;
  readonly readAsrResult: typeof import("./asrTab").readAsrResult;
  readonly usesReferenceTranscript: typeof import("./asrTab").usesReferenceTranscript;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [tab, i18n] = await Promise.all([import("./asrTab"), import("../../i18n")]);
  modules = { ...tab, t: i18n.default.t.bind(i18n.default) };
});

function view(
  patch: Partial<Parameters<Modules["AsrView"]>[0]> = {},
): Parameters<Modules["AsrView"]>[0] {
  return {
    backendOnline: true,
    modelState: "available" as AiModelState,
    modelId: "Systran/faster-whisper-medium",
    hasSource: true,
    transcript: null,
    segments: [],
    language: null,
    referenceStatus: "idle",
    referenceText: null,
    wer: null,
    status: "idle" as AiJobStatus,
    progress: 0,
    errorKey: null,
    demoErrorKey: null,
    demoLoading: false,
    excerptSeconds: 19.6,
    onLoadDemo: () => {},
    onRun: () => {},
    onCancel: () => {},
    ...patch,
  };
}

describe("asr tab", () => {
  it("uses the bundled reference only for the speech demo", () => {
    expect(modules.usesReferenceTranscript({ sourceKind: "demoClip", demoId: "speech" })).toBe(
      true,
    );
    expect(modules.usesReferenceTranscript({ sourceKind: "demoClip", demoId: "speechNoisy" })).toBe(
      false,
    );
    expect(
      modules.usesReferenceTranscript({
        sourceKind: "ingested",
        demoId: undefined,
      }),
    ).toBe(false);
    expect(modules.usesReferenceTranscript(null)).toBe(false);
  });

  it("does not treat an uploaded file with the demo name as the demo", () => {
    expect(
      modules.usesReferenceTranscript({
        sourceKind: "ingested",
        demoId: undefined,
      }),
    ).toBe(false);
  });

  it("reads the transcript, language and timestamped segments", () => {
    const info = modules.readAsrResult({
      kind: "transcript",
      text: "Hello world.",
      language: "en",
      segments: [
        { start_s: 0, end_s: 1.2, text: "Hello" },
        { start_s: 1.2, end_s: 2.4, text: "world." },
      ],
      stats: { model_id: "Systran/faster-whisper-medium" },
    });

    expect(info).toEqual({
      text: "Hello world.",
      language: "en",
      modelId: "Systran/faster-whisper-medium",
      segments: [
        { startS: 0, endS: 1.2, text: "Hello" },
        { startS: 1.2, endS: 2.4, text: "world." },
      ],
    });
  });

  it("renders the transcript and each segment", () => {
    const markup = renderToStaticMarkup(
      <modules.AsrView
        {...view({
          transcript: "Hello world.",
          language: "en",
          segments: [
            { startS: 0, endS: 1.2, text: "Hello" },
            { startS: 1.2, endS: 2.4, text: "world." },
          ],
        })}
      />,
    );

    expect(markup).toContain("Hello world.");
    expect(markup).toContain('data-testid="ai.asr.segment.0"');
    expect(markup).toContain('data-testid="ai.asr.segment.1"');
    expect(markup).toContain("world.");
  });

  it("fetches the bundled reference transcript", async () => {
    const calls: string[] = [];
    const text = await modules.fetchReferenceTranscript(async (url) => {
      calls.push(url);
      return new Response("the reference text", { status: 200 });
    });

    expect(text).toBe("the reference text");
    expect(calls).toEqual(["/demo/speech-kathleen-19s.txt"]);
  });

  it("shows WER when a non-empty reference is available", () => {
    const markup = renderToStaticMarkup(
      <modules.AsrView
        {...view({
          transcript: "hello world",
          referenceStatus: "ready",
          referenceText: "hello word",
          wer: 0.5,
        })}
      />,
    );

    expect(markup).toContain(modules.t("ai.asr.wer", { percent: "50.0" }));
    expect(markup).toContain('data-testid="ai.asr.wer"');
  });

  it("warns when the reference is missing or empty", () => {
    const missing = renderToStaticMarkup(
      <modules.AsrView {...view({ transcript: "hello", referenceStatus: "missing" })} />,
    );
    const empty = renderToStaticMarkup(
      <modules.AsrView {...view({ transcript: "hello", referenceStatus: "empty" })} />,
    );

    expect(missing).toContain(modules.t("ai.asr.referenceMissing"));
    expect(empty).toContain(modules.t("ai.asr.referenceEmpty"));
    expect(empty).not.toContain('data-testid="ai.asr.wer"');
  });

  it("disables Run when the model is missing and explains why", () => {
    const markup = renderToStaticMarkup(<modules.AsrView {...view({ modelState: "missing" })} />);

    expect(
      modules.asrRunDisabled({
        backendOnline: true,
        modelState: "missing",
        hasSource: true,
        status: "idle",
      }),
    ).toBe(true);
    expect(markup).toContain(modules.t("ai.asr.modelMissing"));
    expect(markup).toContain('data-testid="ai.run"');
  });
});
