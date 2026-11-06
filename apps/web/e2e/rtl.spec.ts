/**
 * Wave 6 Plan 05 Task 4 — RTL and responsive gates.
 *
 * AGENTS §6: the shell mirrors with logical properties, but plots, axes,
 * formulas, and technical readouts stay LTR in both locales. This spec checks
 * the shell mirror, LTR readout wrappers, horizontal overflow at desktop,
 * tablet, and phone widths, and the player dock at the two narrow widths.
 */
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

type Tool = {
  readonly path: string;
  readonly fa: RegExp;
  readonly en: RegExp;
};

const TOOLS: readonly Tool[] = [
  { path: "/tools/waveform", fa: /شکل‌موج/, en: /Waveform/ },
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
  { path: "/experiments", fa: /آزمایش‌های هدایت‌شده/, en: /Guided experiments/ },
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

async function visit(page: Page, tool: Tool, locale: "fa" | "en"): Promise<void> {
  await page.locator("nav").getByRole("link", { name: tool[locale] }).click();
  await expect(page).toHaveURL(new RegExp(`${tool.path}(\\?.*)?$`));
  await expect(
    page.locator("main h1, main h2").filter({ hasText: tool[locale] }).first(),
  ).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const widest = Math.max(root.scrollWidth, body.scrollWidth);
    return {
      viewport: window.innerWidth,
      width: widest,
      offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => {
          if (element.getClientRects().length === 0) {
            return false;
          }
          const rect = element.getBoundingClientRect();
          return rect.right > window.innerWidth + 1 || rect.left < -1;
        })
        .slice(0, 5)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return `${element.tagName.toLowerCase()}#${element.id}.${element.className}: ${Math.round(rect.left)}..${Math.round(rect.right)}`;
        }),
    };
  });
  expect(
    overflow.width,
    `${label} ${overflow.viewport}px: ${overflow.offenders.join(" | ")}`,
  ).toBeLessThanOrEqual(overflow.viewport + 1);
}

async function expectLtrReadout(page: Page, testId: string): Promise<void> {
  const readout = page.getByTestId(testId).first();
  await expect(readout).toBeVisible();
  const ltr = await readout.evaluate((element) => {
    const closest = element.closest('[dir="ltr"]');
    if (closest !== null) {
      return true;
    }
    const direction = getComputedStyle(element).direction;
    return direction === "ltr";
  });
  expect(ltr, `${testId} must be LTR`).toBe(true);
}

async function expectShellMirror(page: Page, locale: "fa" | "en"): Promise<void> {
  const boxes = await page.evaluate(() => {
    const nav = document.querySelector("nav")?.getBoundingClientRect();
    const main = document.querySelector("main")?.getBoundingClientRect();
    return nav === undefined || main === undefined
      ? null
      : { navX: nav.x, navWidth: nav.width, mainX: main.x, mainWidth: main.width };
  });
  expect(boxes).not.toBeNull();
  if (boxes === null) {
    return;
  }
  expect(boxes.navWidth).toBeGreaterThan(0);
  expect(boxes.mainWidth).toBeGreaterThan(0);
  if (locale === "fa") {
    expect(boxes.navX).toBeGreaterThan(boxes.mainX);
  } else {
    expect(boxes.navX).toBeLessThan(boxes.mainX);
  }
}

async function expectPlayerUsable(page: Page): Promise<void> {
  const player = page.getByRole("region", { name: /نوار پخش|Player/ });
  await expect(player).toBeVisible();
  await player.scrollIntoViewIfNeeded();
  const toggle = page.getByTestId("player.playToggle");
  await expect(toggle).toBeVisible();
  const box = await toggle.boundingBox();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (box !== null && viewport !== null) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }
}

test("Persian shell mirrors the sidebar while plots and readouts stay LTR", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/tools/waveform");
  await loadSpeech(page);
  await expectShellMirror(page, "fa");

  await expectLtrReadout(page, "waveform.readout");
  await visit(page, TOOLS[1] as Tool, "fa");
  await expectLtrReadout(page, "spectrogram.legend.min");
  await visit(page, TOOLS[2] as Tool, "fa");
  await expectLtrReadout(page, "fftview.meta.sampleRate");
  await visit(page, TOOLS[5] as Tool, "fa");
  await expectLtrReadout(page, "speed.result.actualSpeed");
  await visit(page, TOOLS[12] as Tool, "fa");
  const plot = page.locator('main [dir="ltr"]').first();
  await expect(plot).toBeVisible();

  expect(errors).toEqual([]);
});

test("English shell uses the opposite sidebar side and keeps readouts LTR", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/waveform");
  await loadSpeech(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expectShellMirror(page, "en");
  await expectLtrReadout(page, "waveform.readout");

  expect(errors).toEqual([]);
});

test("no tool overflows horizontally at 1280, 768, or 390 px", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchForErrors(page);
  await page.goto("/tools/waveform");
  await loadSpeech(page);

  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tool of TOOLS) {
      await visit(page, tool, "fa");
      await expectNoHorizontalOverflow(page, `${tool.path} fa`);
    }
    await visit(page, TOOLS[0] as Tool, "en");
    await expectNoHorizontalOverflow(page, "/tools/waveform en");
  }

  expect(errors).toEqual([]);
});

test("player dock stays usable at 768 and 390 px", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/waveform");
  await loadSpeech(page);

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expectPlayerUsable(page);
    await page.getByTestId("player.playToggle").click();
    await expect(page.getByTestId("player.playToggle")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("player.playToggle").click();
    await expect(page.getByTestId("player.playToggle")).toHaveAttribute("aria-pressed", "false");
    await expectNoHorizontalOverflow(page, "player fa");
  }

  expect(errors).toEqual([]);
});
