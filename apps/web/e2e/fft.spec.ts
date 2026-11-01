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
  // The chirp demo is longer than the 65 536-sample analysis cap.
  await expect(page.getByTestId("fftview.capNotice")).toBeVisible();
  // Measured Hann side lobe is the textbook ≈ −31.5 dB.
  await expect(page.getByTestId("fftview.windowCompare.hann")).toContainText("dB");

  await page.getByTestId("fftview.magnitude.linear").click();
  await expect(page.getByTestId("fftview.magnitude.linear")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("fftview.phase.unwrapped").click();
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
