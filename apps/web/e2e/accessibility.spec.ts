/**
 * Wave 6 Plan 05 Task 3 — accessibility gates on the static preview.
 *
 * The app has no accounts and no server dependency for these tools, so the
 * specs run against the built `vite preview` bundle with the API absent.
 * They check native control names, canvas summaries, keyboard focus, the
 * shortcut dialog focus contract, reduced motion, the colorblind-safe
 * spectrogram colormap, and the dark/light token contrast ratios.
 */
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

type Tool = {
  readonly path: string;
  readonly fa: RegExp;
  readonly en: RegExp;
};

const TOOLS: readonly Tool[] = [
  { path: "/tools/spectrogram", fa: /طیف‌نگاره/, en: /Spectrogram/ },
  { path: "/tools/fftview", fa: /نمای فوریه/, en: /FFT View/ },
  { path: "/tools/filters", fa: /طراحی فیلتر/, en: /Filter design/ },
  { path: "/tools/generator", fa: /مولد سیگنال/, en: /Generator/ },
  { path: "/tools/speed", fa: /سرعت و جهت/, en: /Speed and direction/ },
  { path: "/tools/sampling", fa: /نمونه‌برداری/, en: /Sampling/ },
  { path: "/tools/extent", fa: /گستردگی/, en: /Signal extent/ },
  { path: "/tools/reverb", fa: /پژواک/, en: /Reverb/ },
  { path: "/tools/spectrum-edit", fa: /ویرایشگر طیف/, en: /Spectrum editor/ },
  { path: "/tools/codec-lab", fa: /فشرده‌سازی/, en: /Compression lab/ },
  { path: "/tools/metrics", fa: /سنجه‌های کیفیت/, en: /Quality metrics/ },
  { path: "/tools/psychoacoustics", fa: /روان‌شنوایی/, en: /Psychoacoustics/ },
  { path: "/tools/pipeline", fa: /خط لوله/, en: /Pipeline/ },
  { path: "/tools/ai", fa: /هوش مصنوعی/, en: /AI lab/ },
];

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

async function loadSpeech(page: Page): Promise<void> {
  await expect(page.getByTestId("input.demo.load.speech")).toBeVisible();
  await page.getByTestId("input.demo.load.speech").click();
  await expect(page.getByTestId("player.playToggle")).toBeEnabled();
}

async function visit(page: Page, path: string, locale: "fa" | "en"): Promise<void> {
  const tool = TOOLS.find((entry) => entry.path === path);
  const name = tool?.[locale];
  if (name === undefined) {
    throw new Error(`unknown tool ${path}`);
  }
  await page.locator("nav").getByRole("link", { name }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.locator("main")).toBeVisible();
}

async function expectNamedControls(page: Page): Promise<void> {
  const problems = await page.locator("main").evaluate((main) => {
    const labelText = (element: HTMLElement): string => {
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy !== null) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (text !== "") {
          return text;
        }
      }
      const ariaLabel = element.getAttribute("aria-label")?.trim();
      if (ariaLabel !== undefined && ariaLabel !== "") {
        return ariaLabel;
      }
      if (element.id !== "") {
        const label = main.querySelector<HTMLLabelElement>(
          `label[for="${CSS.escape(element.id)}"]`,
        );
        const text = label?.textContent?.trim();
        if (text !== undefined && text !== "") {
          return text;
        }
      }
      const enclosing = element.closest("label")?.textContent?.trim();
      if (enclosing !== undefined && enclosing !== "") {
        return enclosing;
      }
      if (element instanceof HTMLButtonElement) {
        const text = element.textContent?.trim();
        if (text !== undefined && text !== "") {
          return text;
        }
      }
      return element.getAttribute("title")?.trim() ?? "";
    };

    const controls = Array.from(
      main.querySelectorAll<HTMLElement>("button, input, select, textarea"),
    );
    return controls
      .filter((element) => {
        if (element.getAttribute("aria-hidden") === "true") {
          return false;
        }
        if (element.getClientRects().length === 0) {
          return false;
        }
        if (element instanceof HTMLInputElement && element.type === "hidden") {
          return false;
        }
        return !(element as HTMLButtonElement).disabled && labelText(element) === "";
      })
      .map((element) => {
        const tag = element.tagName.toLowerCase();
        const type = element.getAttribute("type") ?? "";
        const id = element.getAttribute("data-testid") ?? element.getAttribute("name") ?? "";
        return `${tag}${type === "" ? "" : `[${type}]`}${id === "" ? "" : `#${id}`}`;
      });
  });
  expect(problems).toEqual([]);
}

async function expectDescribedCanvases(page: Page): Promise<void> {
  const problems = await page.locator("main").evaluate((main) =>
    Array.from(main.querySelectorAll<HTMLCanvasElement>("canvas"))
      .filter((canvas) => canvas.getClientRects().length > 0)
      .filter((canvas) => canvas.getAttribute("aria-hidden") !== "true")
      .filter((canvas) => {
        if (canvas.closest('[role="img"][aria-label], [role="img"][aria-labelledby]') !== null) {
          return false;
        }
        const label = canvas.getAttribute("aria-label")?.trim() ?? "";
        const labelledBy = canvas.getAttribute("aria-labelledby");
        return label === "" && labelledBy === null;
      })
      .map((canvas) => canvas.dataset.testid ?? canvas.className),
  );
  expect(problems).toEqual([]);
}

async function expectTabbableControls(page: Page): Promise<void> {
  const problems = await page.locator("main").evaluate((main) =>
    Array.from(
      main.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, a[href], [role='slider']",
      ),
    )
      .filter((element) => element.getClientRects().length > 0)
      .filter((element) => {
        const disabled =
          element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
        if (disabled) {
          return false;
        }
        return element.tabIndex < 0;
      })
      .map((element) => element.tagName.toLowerCase()),
  );
  expect(problems).toEqual([]);
}

async function expectKeyboardFocus(page: Page): Promise<void> {
  const first = page
    .locator("main")
    .locator("button, input, select, textarea, [tabindex='0']")
    .first();
  await expect(first).toBeVisible();
  await first.focus();
  await expect(first).toBeFocused();
  const before = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? "",
    testId:
      document.activeElement instanceof HTMLElement
        ? (document.activeElement.dataset.testid ?? document.activeElement.dataset.testId ?? "")
        : "",
  }));
  await page.keyboard.press("Tab");
  const after = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? "",
    testId:
      document.activeElement instanceof HTMLElement
        ? (document.activeElement.dataset.testid ?? document.activeElement.dataset.testId ?? "")
        : "",
  }));
  expect(after).not.toEqual(before);

  const ring = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) {
      return { outline: "", shadow: "" };
    }
    const style = getComputedStyle(active);
    return { outline: style.outlineStyle, shadow: style.boxShadow };
  });
  expect(ring.outline !== "none" || ring.shadow !== "none").toBe(true);
}

async function readTokenContrast(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("no 2d context");
    }
    const variable = (name: string): string =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const rgb = (color: string): [number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#000";
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0].map((value) => value / 255) as [
        number,
        number,
        number,
      ];
    };
    const luminance = (color: string): number => {
      const [red = 0, green = 0, blue = 0] = rgb(color).map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const ratio = (foreground: string, background: string): number => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
    };

    const tokens = {
      bg: variable("--color-bg"),
      surface: variable("--color-surface"),
      text: variable("--color-text"),
      muted: variable("--color-muted"),
      accent: variable("--color-accent"),
    };
    return {
      "text/bg": ratio(tokens.text, tokens.bg),
      "text/surface": ratio(tokens.text, tokens.surface),
      "muted/bg": ratio(tokens.muted, tokens.bg),
      "muted/surface": ratio(tokens.muted, tokens.surface),
      "accent/bg": ratio(tokens.accent, tokens.bg),
      "accent/surface": ratio(tokens.accent, tokens.surface),
      "bg/accent": ratio(tokens.bg, tokens.accent),
    };
  });
}

test("Persian: every tool exposes named controls, described canvases, and keyboard focus", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await page.goto("/tools/waveform");
  await loadSpeech(page);

  for (const tool of TOOLS) {
    await visit(page, tool.path, "fa");
    await expectNamedControls(page);
    await expectDescribedCanvases(page);
    await expectTabbableControls(page);
  }

  await visit(page, "/tools/generator", "fa");
  await expectKeyboardFocus(page);

  expect(errors).toEqual([]);
});

test("English: the same control and canvas gates stay clean", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/waveform");
  await loadSpeech(page);

  for (const tool of TOOLS) {
    await visit(page, tool.path, "en");
    await expectNamedControls(page);
    await expectDescribedCanvases(page);
    await expectTabbableControls(page);
  }

  await visit(page, "/tools/generator", "en");
  await expectKeyboardFocus(page);

  expect(errors).toEqual([]);
});

test("shortcut dialog traps focus and returns it to the help button", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/waveform");
  const help = page.getByTestId("shortcuts.helpButton");
  await help.focus();
  await help.click();

  const dialog = page.getByTestId("shortcuts.dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("shortcuts.close")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("shortcuts.close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(help).toBeFocused();

  expect(errors).toEqual([]);
});

test("reduced motion removes transitions and the colorblind-safe colormap exists", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tools/waveform");
  const help = page.getByTestId("shortcuts.helpButton");
  await expect
    .poll(async () => help.evaluate((element) => getComputedStyle(element).transitionDuration))
    .toMatch(/^(0s|0\.00001s|1e-05s)$/);
  await loadSpeech(page);

  await visit(page, "/tools/spectrogram", "fa");
  const colormap = page.getByTestId("spectrogram.control.colormap");
  await expect(colormap).toBeVisible();
  const options = await colormap
    .locator("option")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("value") ?? node.textContent ?? ""),
    );
  expect(options.join(" ")).toMatch(/viridisCB|سیویدیس|cividis/i);

  expect(errors).toEqual([]);
});

test("dark and light tokens meet 4.5:1 for body and muted text", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/waveform");

  for (const theme of ["dark", "light"] as const) {
    await page.getByTestId("theme.select").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const ratios = await readTokenContrast(page);
    for (const [pair, ratio] of Object.entries(ratios)) {
      expect(ratio, `${theme} ${pair}`).toBeGreaterThanOrEqual(4.5);
    }
  }

  expect(errors).toEqual([]);
});
