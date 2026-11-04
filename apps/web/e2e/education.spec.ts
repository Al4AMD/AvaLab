/**
 * F16 teaching-layer e2e (Wave-5 Plan 05 Task 7): guided experiments and
 * their real lab links, theory panels with LTR formulas, demo share links
 * that boot exactly one clip, and user-triggered WAV/PNG exports. Both
 * locales run with zero console errors.
 */
import { readFile } from "node:fs/promises";
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

const DEMO_CHIRP_FILE = "chirp-log-100to8000hz-5s.wav";

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error: Error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

async function expectLtrFormula(panel: ReturnType<Page["getByTestId"]>): Promise<void> {
  await panel.locator("summary").click();
  const formula = panel.locator(".katex").first();
  await expect(formula).toBeVisible();
  expect(await formula.evaluate((element) => element.closest('[dir="ltr"]') !== null)).toBe(true);
}

test("Persian: experiments, filter theory, demo share boot, and WAV export", async ({
  page,
  context,
}) => {
  const errors = watchForErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/experiments");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: /آزمایش‌های هدایت‌شده/ })).toBeVisible();

  for (const id of ["filters", "superres", "asr-codec"]) {
    const card = page.getByTestId(`experiments.card.${id}`);
    await expect(card).toBeVisible();
    await expect(card.getByRole("link").first()).toHaveAttribute("href", /\/tools\//);
  }
  await expect(page.getByTestId("experiments.card.filters").getByRole("link")).toHaveCount(4);
  await expect(page.getByTestId("experiments.card.superres").getByRole("link")).toHaveCount(3);
  await expect(page.getByTestId("experiments.card.asr-codec").getByRole("link")).toHaveCount(4);

  await page
    .getByTestId("experiments.card.filters")
    .getByRole("link", { name: "باز کردن آزمایشگاه" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/tools\/filters\?/);
  await expect(page.getByTestId("input.demo.share.chirp")).toBeVisible();

  const demoRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(DEMO_CHIRP_FILE)) {
      demoRequests.push(request.url());
    }
  });
  await page.getByTestId("input.demo.share.chirp").click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("demo=chirp");
  const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(sharedUrl).toContain("/tools/filters?");
  expect(sharedUrl).toContain("k=fir");
  expect(sharedUrl).toContain("t=101");
  expect(sharedUrl).not.toContain("samples");

  await page.goto(sharedUrl);
  await expect(page.getByTestId("filters.result.stability")).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/demo=chirp/);
  expect(demoRequests).toHaveLength(1);
  await expect(page.getByTestId("input.demo.share.chirp")).toHaveCount(0);
  await expect(page.getByTestId("filters.control.kind")).toHaveValue("fir");
  await expect(page.getByTestId("filters.control.taps")).toHaveValue("101");

  const theory = page.getByTestId("theory.panel").first();
  await expect(theory.locator("summary")).toHaveText("نظریه و آنچه باید مشاهده کرد");
  await expectLtrFormula(theory);

  await expect(page.getByTestId("filters.apply.selection")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("filters.apply.selection").click();
  await expect(page.getByTestId("filters.apply.done")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("filters.export.wav")).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("filters.export.wav").click(),
  ]);
  expect(download.suggestedFilename()).toBe("avalab-filters.wav");
  const downloadPath = await download.path();
  if (downloadPath === null) {
    throw new Error("WAV download has no path");
  }
  const bytes = await readFile(downloadPath);
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
  expect(bytes.readUInt32LE(24)).toBe(48_000);
  expect(bytes.readUInt16LE(34)).toBe(16);
  expect(bytes.length).toBeGreaterThan(44);

  expect(errors).toEqual([]);
});

test("Persian: rate-distortion chart PNG export is a real PNG", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/codec-lab");
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);

  await page.getByTestId("codecLab.comparison.run").click();
  await expect(page.getByTestId("codecLab.comparison.progress")).toHaveText("8/8", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("codecLab.comparison.chart").locator("canvas")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("codecLab.comparison.chart.export").click(),
  ]);
  expect(download.suggestedFilename()).toBe("avalab-rate-distortion.png");
  const downloadPath = await download.path();
  if (downloadPath === null) {
    throw new Error("PNG download has no path");
  }
  const bytes = await readFile(downloadPath);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.length).toBeGreaterThan(8);

  expect(errors).toEqual([]);
});

test("English: experiments, LTR theory, and all five AI theory panels", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/experiments");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Guided experiments" })).toBeVisible();
  await expect(page.getByTestId("experiments.card.asr-codec")).toBeVisible();

  await page
    .getByTestId("experiments.card.filters")
    .getByRole("link", { name: "Open the lab" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/tools\/filters\?/);
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("filters.result.stability")).toBeVisible({ timeout: 20_000 });
  const filterTheory = page.getByTestId("theory.panel").first();
  await expect(filterTheory.locator("summary")).toHaveText("Theory and what to observe");
  await expectLtrFormula(filterTheory);

  await page.goto("/tools/ai");
  const expected: Record<string, RegExp> = {
    denoise: /Denoising: learned spectral suppression/,
    superres: /Super-resolution: bandwidth extension/,
    separation: /Source separation: masks and reconstruction/,
    asr: /Automatic speech recognition and WER/,
    "neural-codec": /Neural codec: RVQ and rate–distortion/,
  };
  for (const [task, title] of Object.entries(expected)) {
    await page.getByTestId(`ai.tab.${task}`).click();
    const panel = page.getByTestId("theory.panel");
    await expect(panel).toBeVisible();
    await panel.locator("summary").click();
    await expect(panel).toContainText(title);
    expect(
      await panel
        .locator(".katex")
        .first()
        .evaluate((element) => element.closest('[dir="ltr"]') !== null),
    ).toBe(true);
    await panel.locator("summary").click();
  }

  expect(errors).toEqual([]);
});
