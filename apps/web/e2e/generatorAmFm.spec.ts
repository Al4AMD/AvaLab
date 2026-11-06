/**
 * F12 AM/FM and Fourier-series e2e: tabs switch panels, worker previews paint,
 * the harmonic slider reaches its URL-bound maximum, and both locales stay
 * console-clean.
 */
import { type ConsoleMessage, expect, type Locator, type Page, test } from "@playwright/test";

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

async function expectCanvasPainted(canvas: Locator): Promise<void> {
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () =>
      canvas.evaluate((element) => {
        const canvasElement = element as HTMLCanvasElement;
        const ctx = canvasElement.getContext("2d");
        if (ctx === null) {
          return false;
        }
        const pixels = ctx.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
        return pixels.some((value) => value !== 0);
      }),
    )
    .toBe(true);
}

test("Persian (default): AM/FM and Fourier panels render worker previews", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/generator");

  await page.getByTestId("generator.tab.amFm").click();
  await expect(page.getByTestId("generator.amFm.am")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("generator.amFm.fm").click();
  await expect(page).toHaveURL(/w=fm/);
  await expect(page.getByTestId("generator.control.frequencyDeviation")).toBeVisible();
  await page.getByTestId("generator.control.frequencyDeviation").fill("1200");
  await expectCanvasPainted(page.getByTestId("generator.preview.canvas"));

  await page.getByTestId("generator.tab.fourier").click();
  await expectCanvasPainted(page.getByTestId("generator.fourier.preview.partial"));
  await expectCanvasPainted(page.getByTestId("generator.fourier.preview.ideal"));
  const harmonics = page.getByTestId("generator.control.fourierHarmonics");
  await harmonics.focus();
  await page.keyboard.press("End");
  await expect(page).toHaveURL(/fh=200/);
  await expect(page.getByTestId("generator.fourier.overshoot")).toContainText("%");
  expect(errors).toEqual([]);
});

test("English (LTR): generator tabs and Fourier panel render without console errors", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/generator");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByTestId("generator.tab.fourier").click();
  await expect(page.getByTestId("generator.control.fourierKind")).toBeVisible();
  await expectCanvasPainted(page.getByTestId("generator.fourier.preview.partial"));
  expect(errors).toEqual([]);
});
