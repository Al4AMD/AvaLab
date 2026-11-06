import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AiJobStatus } from "./useAiJob";

type Modules = {
  readonly PitchBeatView: typeof import("./pitchBeatTab").PitchBeatView;
  readonly pitchBeatRunDisabled: typeof import("./pitchBeatTab").pitchBeatRunDisabled;
  readonly readPitchBeatResult: typeof import("./pitchBeatTab").readPitchBeatResult;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [tab, i18n] = await Promise.all([import("./pitchBeatTab"), import("../../i18n")]);
  modules = { ...tab, t: i18n.default.t.bind(i18n.default) };
});

const pitch = {
  kind: "analysis",
  analysis: {
    analysis_kind: "pitch",
    times_s: [0, 0.5, 1],
    f0_hz: [220, 222.5, null],
    voiced_probability: [0.9, 0.8, 0.1],
  },
  stats: { median_f0_hz: 221.25, voiced_fraction: 2 / 3 },
};

const beat = {
  kind: "analysis",
  analysis: {
    analysis_kind: "beat",
    tempo_bpm: 120,
    beat_times_s: [0, 0.5, 1, 1.5],
  },
  stats: {},
};

function view(
  patch: Partial<Parameters<Modules["PitchBeatView"]>[0]> = {},
): Parameters<Modules["PitchBeatView"]>[0] {
  return {
    backendOnline: true,
    task: "pitch",
    hasSource: true,
    status: "idle" as AiJobStatus,
    progress: 0,
    errorKey: null,
    analysis: null,
    excerptSeconds: 10,
    onTaskChange: () => {},
    onRun: () => {},
    onCancel: () => {},
    ...patch,
  };
}

describe("pitch/beat analysis", () => {
  it("parses pitch arrays and stats without a model result", () => {
    const parsed = modules.readPitchBeatResult(pitch);
    expect(parsed).toEqual({
      analysisKind: "pitch",
      timesSeconds: [0, 0.5, 1],
      f0Hz: [220, 222.5, null],
      voicedProbability: [0.9, 0.8, 0.1],
      medianF0Hz: 221.25,
      voicedFraction: 2 / 3,
    });
  });

  it("rejects mismatched pitch arrays and non-analysis payloads", () => {
    expect(modules.readPitchBeatResult({ kind: "audio", result_audio_id: "x" })).toBeNull();
    expect(
      modules.readPitchBeatResult({
        ...pitch,
        analysis: { ...pitch.analysis, f0_hz: [220] },
      }),
    ).toBeNull();
  });

  it("parses beat tempo and sorted times", () => {
    expect(modules.readPitchBeatResult(beat)).toEqual({
      analysisKind: "beat",
      tempoBpm: 120,
      beatTimesSeconds: [0, 0.5, 1, 1.5],
    });
  });

  it("disables Run offline, without a source, or while busy", () => {
    expect(
      modules.pitchBeatRunDisabled({ backendOnline: true, hasSource: true, busy: false }),
    ).toBe(false);
    expect(
      modules.pitchBeatRunDisabled({ backendOnline: false, hasSource: true, busy: false }),
    ).toBe(true);
    expect(
      modules.pitchBeatRunDisabled({ backendOnline: true, hasSource: false, busy: false }),
    ).toBe(true);
    expect(modules.pitchBeatRunDisabled({ backendOnline: true, hasSource: true, busy: true })).toBe(
      true,
    );
  });

  it("renders the F0 stats and canvas without a model banner", () => {
    const markup = renderToStaticMarkup(
      <modules.PitchBeatView
        {...view({ analysis: modules.readPitchBeatResult(pitch), status: "done", progress: 1 })}
      />,
    );

    expect(markup).toContain(modules.t("ai.pitchBeat.pitchResult"));
    expect(markup).toContain(modules.t("ai.pitchBeat.hzValue", { hz: "221.25" }));
    expect(markup).toContain('data-testid="ai.pitchBeat.pitchCanvas"');
    expect(markup).not.toContain('data-testid="ai.models.banner"');
  });

  it("renders tempo and beat times for a beat result", () => {
    const markup = renderToStaticMarkup(
      <modules.PitchBeatView
        {...view({
          task: "beat",
          analysis: modules.readPitchBeatResult(beat),
          status: "done",
          progress: 1,
        })}
      />,
    );

    expect(markup).toContain(modules.t("ai.pitchBeat.bpmValue", { bpm: "120.00" }));
    expect(markup).toContain('data-testid="ai.pitchBeat.beatList"');
    expect(markup).toContain(modules.t("ai.pitchBeat.timeValue", { seconds: "0.500" }));
  });

  it("shows progress and a cancel control while running", () => {
    const markup = renderToStaticMarkup(
      <modules.PitchBeatView {...view({ status: "running", progress: 0.42 })} />,
    );

    expect(markup).toContain(modules.t("ai.job.running", { percent: 42 }));
    expect(markup).toContain('data-testid="ai.cancel"');
  });
});
