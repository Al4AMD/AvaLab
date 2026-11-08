import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { FilterDesignResult } from "../../session/ops";
import type { FilterSettings } from "./filterState";

type Modules = {
  readonly FilterLabPanel: typeof import("./filterLabView").FilterLabPanel;
  readonly filterApplyParams: typeof import("./filterLabView").filterApplyParams;
  readonly filterApplyRange: typeof import("./filterLabView").filterApplyRange;
  readonly filterDesignParams: typeof import("./filterLabView").filterDesignParams;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

const SETTINGS: FilterSettings = {
  kind: "butterworth",
  band: "lowpass",
  cutoffHz: 4_000,
  cutoff2Hz: 8_000,
  order: 4,
  taps: 101,
  window: "hamming",
  rippleDb: 0.5,
  q: Math.SQRT1_2,
  gainDb: 0,
  sampleRateHz: 48_000,
  applyScope: "selection",
};

function designFixture(overrides: Partial<FilterDesignResult> = {}): FilterDesignResult {
  const frequenciesHz = Array.from({ length: 512 }, (_, index) => (index / 511) * 24_000);
  const magnitudeDb = frequenciesHz.map((frequency) => (frequency < 4_000 ? 0 : -60));
  return {
    b: [0.5, 0.5],
    a: [1],
    frequenciesHz,
    magnitudeDb,
    phaseRad: frequenciesHz.map((frequency) => -frequency / 10_000),
    groupDelaySamples: frequenciesHz.map(() => 4),
    impulse: Array.from({ length: 256 }, (_, index) => (index < 2 ? 0.5 : 0)),
    step: Array.from({ length: 256 }, () => 1),
    poles: [],
    zeros: [{ re: -1, im: 0 }],
    stable: true,
    delaySamples: 4,
    ...overrides,
  };
}

function panelProps(
  overrides: Partial<Parameters<Modules["FilterLabPanel"]>[0]> = {},
): Parameters<Modules["FilterLabPanel"]>[0] {
  return {
    settings: SETTINGS,
    onSettingsChange: () => {},
    design: designFixture(),
    designBusy: false,
    designError: null,
    onApply: () => {},
    applyBusy: false,
    applyError: null,
    applied: null,
    ...overrides,
  };
}

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [view, i18n] = await Promise.all([import("./filterLabView"), import("../../i18n")]);
  modules = { ...view, t: i18n.default.t.bind(i18n.default) };
});

describe("filter lab view", () => {
  it("renders design and apply controls", () => {
    const markup = renderToStaticMarkup(<modules.FilterLabPanel {...panelProps()} />);

    for (const testId of [
      "filters.control.kind",
      "filters.control.band",
      "filters.control.cutoff",
      "filters.control.order",
      "filters.apply.selection",
      "filters.apply.all",
    ]) {
      expect(markup).toContain(`data-testid="${testId}"`);
    }
    expect(markup).toContain(modules.t("filters.controls.kind"));
    expect(markup).toContain(modules.t("filters.controls.cutoff"));
  });

  it("offers WAV export only after a filtered result is installed", () => {
    const disabled = renderToStaticMarkup(<modules.FilterLabPanel {...panelProps()} />);
    expect(disabled).toMatch(/data-testid="filters\.export\.wav"[^>]*disabled/);

    const enabled = renderToStaticMarkup(
      <modules.FilterLabPanel {...panelProps({ exportAvailable: true, onExportWav: () => {} })} />,
    );
    expect(enabled).toContain(modules.t("filters.export.wav"));
    expect(enabled).toMatch(/data-testid="filters\.export\.wav"/);
    expect(enabled).not.toMatch(/data-testid="filters\.export\.wav"[^>]*disabled/);
  });

  it("flags an invalid cutoff and disables both apply buttons", () => {
    const markup = renderToStaticMarkup(
      <modules.FilterLabPanel
        {...panelProps({ settings: { ...SETTINGS, sampleRateHz: 44_100, cutoffHz: 30_000 } })}
      />,
    );

    expect(markup).toContain(modules.t("filters.error.invalid"));
    expect(markup).toMatch(/data-testid="filters\.apply\.selection"[^>]*disabled/);
    expect(markup).toMatch(/data-testid="filters\.apply\.all"[^>]*disabled/);
  });

  it("warns about an unstable design and blocks apply", () => {
    const markup = renderToStaticMarkup(
      <modules.FilterLabPanel {...panelProps({ design: designFixture({ stable: false }) })} />,
    );

    expect(markup).toContain(modules.t("filters.unstableWarning"));
    expect(markup).toMatch(/data-testid="filters\.apply\.selection"[^>]*disabled/);
  });

  it("renders finite plot data for every analysis panel", () => {
    const markup = renderToStaticMarkup(<modules.FilterLabPanel {...panelProps()} />);

    for (const testId of [
      "filters.plot.magnitude",
      "filters.plot.phase",
      "filters.plot.groupDelay",
      "filters.plot.impulse",
      "filters.plot.step",
      "filters.poleZero",
    ]) {
      expect(markup).toContain(`data-testid="${testId}"`);
    }
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
  });

  it("renders optional channel controls above the panel grid", () => {
    const markup = renderToStaticMarkup(
      <modules.FilterLabPanel
        {...panelProps({
          channelControls: <span data-testid="filters.channelControls">channels</span>,
        })}
      />,
    );

    expect(markup).toContain('data-testid="filters.channelControls"');
  });

  it("renders the right-lane delay only when both lanes were processed", () => {
    const single = renderToStaticMarkup(
      <modules.FilterLabPanel
        {...panelProps({
          applied: { startSample: 0, endSample: 100, delaySamples: 4 },
        })}
      />,
    );
    expect(single).not.toContain('data-testid="filters.result.delayRight"');

    const both = renderToStaticMarkup(
      <modules.FilterLabPanel
        {...panelProps({
          applied: {
            startSample: 0,
            endSample: 100,
            delaySamples: 4,
            rightDelaySamples: 9,
          },
        })}
      />,
    );
    expect(both).toContain('data-testid="filters.result.delayRight"');
    expect(both).toContain("9");
  });

  it("builds the exact design, apply, and range parameters", () => {
    const design = designFixture();
    expect(modules.filterDesignParams(SETTINGS)).toEqual({
      kind: "butterworth",
      band: "lowpass",
      cutoffHz: 4_000,
      cutoff2Hz: 8_000,
      order: 4,
      taps: 101,
      window: "hamming",
      rippleDb: 0.5,
      q: Math.SQRT1_2,
      gainDb: 0,
      sampleRateHz: 48_000,
    });
    expect(modules.filterApplyParams(SETTINGS, design)).toEqual({
      b: [0.5, 0.5],
      a: [1],
      fir: false,
      sampleRateHz: 48_000,
      compensateDelay: true,
    });
    expect(
      modules.filterApplyRange("all", { startSample: 10, endSample: 20 }, 2_400_000, 48_000),
    ).toEqual({ startSample: 0, endSample: 2_400_000 });
    expect(
      modules.filterApplyRange(
        "selection",
        { startSample: 0, endSample: 2_400_000 },
        2_400_000,
        48_000,
      ),
    ).toEqual({ startSample: 0, endSample: 1_440_000 });
    expect(
      modules.filterApplyRange(
        "selection",
        { startSample: 100, endSample: 200 },
        2_400_000,
        48_000,
      ),
    ).toEqual({ startSample: 100, endSample: 200 });
  });
});
