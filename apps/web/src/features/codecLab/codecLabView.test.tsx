import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { CodecLabMdctBand } from "../../session/ops";
import { CODEC_LAB_DEFAULT_SETTINGS, type CodecLabSettings } from "./codecLabState";

type Modules = {
  readonly CodecLabPsychoControls: typeof import("./codecLabView").CodecLabPsychoControls;
  readonly MdctBandChart: typeof import("./codecLabView").MdctBandChart;
  readonly realPlayback: typeof import("./codecLabView").realPlayback;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

const SETTINGS: CodecLabSettings = {
  ...CODEC_LAB_DEFAULT_SETTINGS,
  codec: "mdct",
  startSample: 0,
  endSample: 24_000,
};

const BANDS: CodecLabMdctBand[] = Array.from({ length: 25 }, (_, index) => ({
  lowHz: index * 800,
  highHz: (index + 1) * 800,
  thresholdDb: 30 + index,
  smrDb: 20 - index * 0.5,
  step: 0.01 * (index + 1),
}));

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [view, i18n] = await Promise.all([import("./codecLabView"), import("../../i18n")]);
  modules = { ...view, t: i18n.default.t.bind(i18n.default) };
});

describe("codec lab psychoacoustic controls", () => {
  it("shows the legacy label when masking is off", () => {
    const markup = renderToStaticMarkup(
      <modules.CodecLabPsychoControls
        settings={{ ...SETTINGS, mdctPsychoacoustic: false }}
        onChange={() => {}}
      />,
    );
    expect(markup).toContain(modules.t("codecLab.mdct.legacy"));
    expect(markup).not.toContain(modules.t("codecLab.mdct.psychoOn"));
    expect(markup).toContain('data-testid="codecLab.control.psycho"');
    expect(markup).toContain('data-testid="codecLab.control.referenceSpl"');
  });

  it("shows the masking-aware label when the checkbox is on", () => {
    const markup = renderToStaticMarkup(
      <modules.CodecLabPsychoControls settings={SETTINGS} onChange={() => {}} />,
    );
    expect(markup).toContain(modules.t("codecLab.mdct.psychoOn"));
    expect(markup).not.toContain(modules.t("codecLab.mdct.legacy"));
  });
});

describe("MDCT band chart", () => {
  it("renders threshold and SMR series without non-finite text", () => {
    const markup = renderToStaticMarkup(<modules.MdctBandChart bands={BANDS} />);
    expect(markup).toContain('data-testid="codecLab.psycho.bandChart"');
    expect(markup).toContain('data-testid="codecLab.psycho.thresholdChart"');
    expect(markup).toContain('data-testid="codecLab.psycho.smrChart"');
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
  });
});

describe("real-codec playback payload", () => {
  it("installs both lanes and offsets the reference start by the excerpt start", () => {
    const left = new Float32Array([0.1, 0.2]);
    const right = new Float32Array([0.3, 0.4]);
    const playback = modules.realPlayback(
      {
        reference: new Float32Array(2),
        decoded: new Float32Array(2),
        channels: [left, right],
        stats: {
          resultAudioId: "id",
          sizeBytes: 1,
          bitrateKbps: 1,
          encodeMs: 1,
          codecDelaySamples: 0,
          referenceStartSample: 37,
          alignedSampleCount: 2,
          durationSeconds: 1,
          sampleRateHz: 48_000,
          channels: 2,
          bitExact: true,
          lossless: true,
        },
      },
      { ...SETTINGS, startSample: 100, endSample: 102 },
    );

    expect(playback.channels).toHaveLength(2);
    expect(playback.channels[0]).toBe(left);
    expect(playback.channels[1]).toBe(right);
    expect(playback.channels).not.toBe([left, right]);
    expect(playback.sourceStartSample).toBe(137);
  });
});
