import { generateAm, generateFm } from "@avalab/dsp";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { generateSynth } from "../../session/ops";
import { AmFmPanel } from "./amFmPanel";
import { FourierPanel, GIBBS_THEORETICAL_RATIO } from "./fourierPanel";
import { GENERATOR_DEFAULT_SETTINGS } from "./generatorState";

let t: typeof import("../../i18n").default.t;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const i18n = await import("../../i18n");
  t = i18n.default.t.bind(i18n.default);
});

const noop = (): void => {};

function samplesOf(result: ReturnType<typeof generateSynth>): Float32Array {
  const payload = result.payload;
  if (payload === undefined) {
    throw new Error("missing generateSynth payload");
  }
  return new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
}

describe("F12 AM/FM panel", () => {
  it("renders both modes and warns above an index of 1", () => {
    const markup = renderToStaticMarkup(
      <AmFmPanel
        settings={{ ...GENERATOR_DEFAULT_SETTINGS, waveform: "am", modulationIndex: 1.5 }}
        update={noop}
      />,
    );
    expect(markup).toContain('data-testid="generator.amFm.am"');
    expect(markup).toContain('data-testid="generator.amFm.fm"');
    expect(markup).toContain('data-testid="generator.control.modulationIndex"');
    expect(markup).toContain(t("generator.amFm.overmodulation"));
    expect(markup).not.toContain("NaN");
  });

  it("shows the deviation control in FM mode", () => {
    const markup = renderToStaticMarkup(
      <AmFmPanel settings={{ ...GENERATOR_DEFAULT_SETTINGS, waveform: "fm" }} update={noop} />,
    );
    expect(markup).toContain('data-testid="generator.control.frequencyDeviation"');
    expect(markup).not.toContain('data-testid="generator.control.modulationIndex"');
  });

  it("dispatches AM/FM to the existing dsp generators", () => {
    const spec = {
      sampleRateHz: 8000,
      durationSeconds: 0.25,
      amplitude: 0.6,
      frequencyHz: 300,
      modulationHz: 7,
      previewBucketCount: 0,
    };
    const am = generateSynth({ ...spec, waveform: "am", modulationIndex: 0.5 });
    expect(Array.from(samplesOf(am))).toEqual(
      Array.from(Float32Array.from(generateAm({ ...spec, carrierHz: 300, modulationIndex: 0.5 }))),
    );
    const fm = generateSynth({ ...spec, waveform: "fm", frequencyDeviationHz: 900 });
    expect(Array.from(samplesOf(fm))).toEqual(
      Array.from(
        Float32Array.from(generateFm({ ...spec, carrierHz: 300, frequencyDeviationHz: 900 })),
      ),
    );
  });
});

describe("F12 Fourier-series panel", () => {
  it("renders the harmonic slider, comparison previews and the Gibbs reference", () => {
    const markup = renderToStaticMarkup(
      <FourierPanel settings={GENERATOR_DEFAULT_SETTINGS} update={noop} />,
    );
    expect(markup).toContain('data-testid="generator.control.fourierHarmonics"');
    expect(markup).toContain('max="200"');
    expect(markup).toContain('data-testid="generator.fourier.preview.partial"');
    expect(markup).toContain('data-testid="generator.fourier.preview.ideal"');
    expect(markup).toContain(`${(GIBBS_THEORETICAL_RATIO * 100).toFixed(2)} %`);
    expect(markup).not.toContain("NaN");
  });
});
