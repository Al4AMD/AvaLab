import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Modules = {
  readonly ChannelPicker: typeof import("./ChannelPicker").ChannelPicker;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [picker, i18n] = await Promise.all([import("./ChannelPicker"), import("../../i18n")]);
  modules = { ChannelPicker: picker.ChannelPicker, t: i18n.default.t.bind(i18n.default) };
});

describe("ChannelPicker", () => {
  it("renders nothing for a mono source", () => {
    const markup = renderToStaticMarkup(
      <modules.ChannelPicker mode="mono" modes={["mono"]} onChange={() => {}} />,
    );
    expect(markup).toBe("");
  });

  it("renders the single-panel choices and marks the selected one", () => {
    const markup = renderToStaticMarkup(
      <modules.ChannelPicker mode="right" modes={["mono", "left", "right"]} onChange={() => {}} />,
    );
    expect(markup).toContain('data-testid="channel.picker"');
    expect(markup).toContain(modules.t("channel.label"));
    expect(markup).toContain(modules.t("channel.mono"));
    expect(markup).toContain(modules.t("channel.left"));
    expect(markup).toContain(modules.t("channel.right"));
    expect(markup).not.toContain(modules.t("channel.both"));
    expect(markup).toMatch(
      /<button[^>]*aria-pressed="true"[^>]*data-testid="channel\.mode\.right"/,
    );
    expect(markup).toMatch(
      /<button[^>]*aria-pressed="false"[^>]*data-testid="channel\.mode\.left"/,
    );
    expect(markup).toContain(modules.t("channel.note"));
  });

  it("offers the stacked choice when the tool supports both", () => {
    const markup = renderToStaticMarkup(
      <modules.ChannelPicker
        mode="both"
        modes={["mono", "left", "right", "both"]}
        onChange={() => {}}
      />,
    );
    expect((markup.match(/data-testid="channel\.mode\./g) ?? []).length).toBe(4);
    expect(markup).toMatch(/<button[^>]*aria-pressed="true"[^>]*data-testid="channel\.mode\.both"/);
  });
});
