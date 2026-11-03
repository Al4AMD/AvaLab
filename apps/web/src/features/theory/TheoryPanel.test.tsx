import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Modules = {
  readonly Formula: typeof import("./Formula").Formula;
  readonly TheoryPanel: typeof import("./TheoryPanel").TheoryPanel;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [formula, panel, i18n] = await Promise.all([
    import("./Formula"),
    import("./TheoryPanel"),
    import("../../i18n"),
  ]);
  modules = { ...formula, ...panel, t: i18n.default.t.bind(i18n.default) };
});

describe("formula", () => {
  it("renders KaTeX in an LTR wrapper", () => {
    const markup = renderToStaticMarkup(<modules.Formula tex="a^2 + b^2 = c^2" />);

    expect(markup).toContain('dir="ltr"');
    expect(markup).toContain('class="katex"');
    expect(markup).not.toContain("katex-display");
  });

  it("renders display formulas as a block", () => {
    const markup = renderToStaticMarkup(<modules.Formula tex="H(z) = B(z)/A(z)" display />);

    expect(markup).toContain('dir="ltr"');
    expect(markup).toContain("katex-display");
  });

  it("throws on invalid TeX instead of rendering an error node", () => {
    expect(() => renderToStaticMarkup(<modules.Formula tex="\\frac{" />)).toThrow();
  });
});

describe("theory panel", () => {
  it("renders the title, section headings, bodies, and formulas", () => {
    const markup = renderToStaticMarkup(
      <modules.TheoryPanel
        titleKey="theory.title"
        sections={[
          {
            headingKey: "filters.controls.kind",
            bodyKey: "filters.controls.cutoff",
            formula: "H(z) = B(z)/A(z)",
          },
          {
            headingKey: "filters.controls.band",
            bodyKey: "filters.controls.order",
            bulletKeys: ["filters.controls.window", "filters.controls.taps"],
          },
        ]}
      />,
    );

    expect(markup).toContain("<details");
    expect(markup).toContain("<summary");
    expect(markup).toContain(modules.t("theory.title"));
    expect(markup).toContain(modules.t("filters.controls.kind"));
    expect(markup).toContain(modules.t("filters.controls.cutoff"));
    expect(markup).toContain(modules.t("filters.controls.band"));
    expect(markup).toContain(modules.t("filters.controls.order"));
    expect(markup).toContain("<ul");
    expect(markup).toContain(modules.t("filters.controls.window"));
    expect(markup).toContain(modules.t("filters.controls.taps"));
    expect(markup).toContain('dir="ltr"');
    expect(markup).toContain("katex-display");
  });
});
