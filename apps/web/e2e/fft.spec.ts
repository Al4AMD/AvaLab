/**
 * Fourier view e2e (F08, Wave 2 Plan 04 Task 1) on the backend-absent static
 * preview harness: a demo clip loads through the offline lane, the real
 * worker computes the single-frame spectrum, and uPlot draws both charts.
 * Also proves the URL codec survives a reload (share-by-URL groundwork).
 */
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

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

test("Persian (default): the spectrum charts paint, controls update, and the URL restores them", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/fftview");
  await page.getByTestId("input.demo.load.chirp").click();

  await expect(page.getByTestId("fftview.chart.magnitude")).toBeVisible();
  await expect(page.getByTestId("fftview.chart.phase")).toBeVisible();
  await expect(page.getByTestId("fftview.chart.windows")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("fftview.meta.bins")).not.toHaveText("0");
  // A finite display floor keeps uPlot's y-range valid; before the fix the
  // -Infinity bins blanked every series and only the legend stayed visible.
  const drawnWindowColors = await page
    .getByTestId("fftview.chart.windows")
    .locator("canvas")
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext("2d");
      if (context === null) {
        return 0;
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const strokes = ["148,163,184", "56,189,248", "245,158,11", "167,139,250", "52,211,153"];
      return strokes.filter((stroke) => {
        const [red, green, blue] = stroke.split(",").map(Number);
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            pixels[index] === red &&
            pixels[index + 1] === green &&
            pixels[index + 2] === blue &&
            (pixels[index + 3] ?? 0) > 200
          ) {
            return true;
          }
        }
        return false;
      }).length;
    });
  expect(drawnWindowColors).toBeGreaterThanOrEqual(3);
  // The chirp demo is longer than the 65 536-sample analysis cap.
  await expect(page.getByTestId("fftview.capNotice")).toBeVisible();
  // Measured Hann side lobe is the textbook ≈ −31.5 dB, visible in the
  // persistent table (not only in the uPlot hover legend).
  await expect(page.getByTestId("fftview.windowCompare.table")).toBeVisible();
  await expect(page.getByTestId("fftview.windowCompare.hann")).toContainText("dB");

  await page.getByTestId("fftview.magnitude.linear").click();
  await expect(page.getByTestId("fftview.magnitude.linear")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("fftview.phase.unwrapped").click();
  await expect(page.getByTestId("fftview.phase.visible")).toContainText("بین از آستانه");
  await page.getByTestId("fftview.control.phaseMask").fill("0");
  await expect(page.getByTestId("fftview.phase.visible")).toContainText("هیچ بینی");
  await page.getByTestId("fftview.control.windowFamily").selectOption("blackman");
  await expect(page).toHaveURL(/w=blackman/);

  await page.reload();
  // The source is session-only; the URL still carries the settings.
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("fftview.control.windowFamily")).toHaveValue("blackman");
  await expect(page.getByTestId("fftview.magnitude.linear")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toEqual([]);
});

test("English (LTR): the Fourier view renders with zero console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/fftview");
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("fftview.chart.magnitude")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  expect(errors).toEqual([]);
});
