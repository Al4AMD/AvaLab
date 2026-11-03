import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Modules = {
  readonly ExperimentsView: typeof import("./experimentsView").ExperimentsView;
  readonly EXPERIMENTS: typeof import("./experiments").EXPERIMENTS;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [view, data, i18n] = await Promise.all([
    import("./experimentsView"),
    import("./experiments"),
    import("../../i18n"),
  ]);
  modules = { ...view, ...data, t: i18n.default.t.bind(i18n.default) };
});

describe("experiments view", () => {
  it("renders the title, intro, and one card per experiment", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <modules.ExperimentsView />
      </MemoryRouter>,
    );

    expect(markup).toContain(modules.t("experiments.title"));
    expect(markup).toContain(modules.t("experiments.intro"));
    for (const experiment of modules.EXPERIMENTS) {
      expect(markup).toContain(`data-testid="experiments.card.${experiment.id}"`);
      expect(markup).toContain(modules.t(experiment.titleKey));
      expect(markup).toContain(modules.t(experiment.goalKey));
    }
  });

  it("renders every step with its instruction, observation, and link", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <modules.ExperimentsView />
      </MemoryRouter>,
    ).replaceAll("&amp;", "&");

    for (const experiment of modules.EXPERIMENTS) {
      experiment.steps.forEach((step, index) => {
        expect(markup).toContain(`data-testid="experiments.step.${experiment.id}.${index}"`);
        expect(markup).toContain(modules.t(step.instructionKey));
        expect(markup).toContain(modules.t(step.observationKey));
        if (step.link !== undefined) {
          expect(markup).toContain(`href="${step.link.path}?${step.link.search}"`);
        }
      });
    }
  });

  it("never renders raw i18n keys", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <modules.ExperimentsView />
      </MemoryRouter>,
    );
    expect(markup).not.toContain("experiments.title");
    expect(markup).not.toContain(".instruction");
    expect(markup).not.toContain(".observation");
  });
});
