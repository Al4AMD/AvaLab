import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { PsychoacousticBand } from "../../session/ops";
import { PSYCHOACOUSTICS_DEFAULT_SETTINGS } from "./psychoacousticsState";

type Modules = {
  readonly PsychoacousticsView: typeof import("./psychoacousticsView").PsychoacousticsView;
  readonly PsychoacousticsAnalysisPanel: typeof import("./psychoacousticsView").PsychoacousticsAnalysisPanel;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

const BANDS: PsychoacousticBand[] = Array.from({ length: 25 }, (_, index) => ({
  lowHz: index * 800,
  highHz: (index + 1) * 800,
  levelDb: 50 - index,
  thresholdDb: 25 - index * 0.3,
  smrDb: 25 - index * 0.7,
}));

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [view, i18n] = await Promise.all([import("./psychoacousticsView"), import("../../i18n")]);
  modules = { ...view, t: i18n.default.t.bind(i18n.default) };
});

describe("psychoacoustics view", () => {
  it("renders the no-audio ATH shell and theory panel", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/tools/psychoacoustics"]}>
        <modules.PsychoacousticsView />
      </MemoryRouter>,
    );
    expect(markup).toContain(modules.t("tool.psychoacoustics.title"));
    expect(markup).toContain('data-testid="psychoacoustics.chart.ath"');
    expect(markup).toContain('data-testid="psychoacoustics.chart.spreading"');
    expect(markup).toContain('data-testid="psychoacoustics.noSource"');
    expect(markup).toContain(modules.t("psychoacoustics.theory.title"));
    expect(markup).toContain(modules.t("psychoacoustics.theory.ath.heading"));
    expect(markup).not.toContain("psychoacoustics.theory.");
  });

  it("renders measured bands with a visible threshold overlay", () => {
    const markup = renderToStaticMarkup(
      <modules.PsychoacousticsAnalysisPanel
        bands={BANDS}
        frameCount={4}
        status="ready"
        settings={PSYCHOACOUSTICS_DEFAULT_SETTINGS}
      />,
    );
    expect(markup).toContain('data-testid="psychoacoustics.chart.bands"');
    expect(markup).toContain('data-testid="psychoacoustics.chart.level"');
    expect(markup).toContain('data-testid="psychoacoustics.chart.threshold"');
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
  });

  it("hides the threshold overlay when disabled", () => {
    const markup = renderToStaticMarkup(
      <modules.PsychoacousticsAnalysisPanel
        bands={BANDS}
        frameCount={4}
        status="ready"
        settings={{ ...PSYCHOACOUSTICS_DEFAULT_SETTINGS, showThreshold: false }}
      />,
    );
    expect(markup).toContain('data-testid="psychoacoustics.chart.level"');
    expect(markup).not.toContain('data-testid="psychoacoustics.chart.threshold"');
  });
});
