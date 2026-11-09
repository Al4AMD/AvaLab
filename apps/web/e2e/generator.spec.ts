/**
 * Signal generator e2e (F12, Wave 2 Plan 04 Task 3): the generator works
 * with NO source loaded, the worker op paints the preview, and "load as
 * source" routes through the store so the waveform tool shows the generated
 * signal. Both locales, zero console errors.
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

test("Persian (default): generate a chirp, load it as the session source", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/generator");
  await expect(page.getByTestId("generator.preview.canvas")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("generator.control.waveform").selectOption("chirp");
  await expect(page.getByTestId("generator.control.chirpFrom")).toBeVisible();
  await page.getByTestId("generator.control.duration").fill("1");
  await expect(page.getByTestId("generator.meta.samples")).toHaveText("48000");
  await expect(page).toHaveURL(/w=chirp/);

  await page.getByTestId("generator.load").click();
  await expect(page).toHaveURL(/\/tools\/waveform$/);
  await expect(page.getByTestId("waveform.readout")).toContainText("1.000 s");
  expect(errors).toEqual([]);
});

test("Persian (default): impulse train controls sync to the URL and load as source", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/generator");
  await expect(page.getByTestId("generator.preview.canvas")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("generator.control.waveform").selectOption("impulse");
  await page.getByTestId("generator.control.eventStart").fill("0.25");
  await page.getByTestId("generator.control.eventCount").fill("4");
  await page.getByTestId("generator.control.eventInterval").fill("0.5");
  await expect(page).toHaveURL(/w=impulse/);
  await expect(page).toHaveURL(/evt=0.25/);
  await expect(page).toHaveURL(/evn=4/);
  await expect(page).toHaveURL(/evg=0.5/);

  await page.getByTestId("generator.load").click();
  await expect(page).toHaveURL(/\/tools\/waveform$/);
  await expect(page.getByTestId("waveform.readout")).toContainText("2.000 s");
  expect(errors).toEqual([]);
});

test("English (LTR): the generator preview paints with zero console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/generator");
  await expect(page.getByTestId("generator.preview.canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  expect(errors).toEqual([]);
});
