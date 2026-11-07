/**
 * F13 psychoacoustics e2e (Wave-6 Plan 01 Task 7): static curves render
 * without audio, a loaded demo produces a measured threshold overlay, and
 * the codec-lab link opens the masking-aware MDCT with honest bit accounting.
 * Both locales, zero console errors.
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

async function loadChirpFromWaveform(page: Page): Promise<void> {
  await page.goto("/tools/waveform");
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
}

test("Persian: static curves render and a demo adds the measured threshold", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/psychoacoustics");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("psychoacoustics.chart.ath")).toBeVisible();
  await expect(page.getByTestId("psychoacoustics.chart.spreading")).toBeVisible();
  await expect(page.getByTestId("theory.panel")).toContainText("آستانه");

  await loadChirpFromWaveform(page);
  await page.locator('a[href="/tools/psychoacoustics"]').click();
  await expect(page).toHaveURL(/\/tools\/psychoacoustics/);
  await expect(page.getByTestId("psychoacoustics.chart.threshold")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("psychoacoustics.chart.bands")).toBeVisible();

  await page.getByTestId("psychoacoustics.link.codecLab").click();
  await expect(page).toHaveURL(/c=mdct/);
  await expect(page).toHaveURL(/pm=1/);
  await expect(page).toHaveURL(/rspl=94/);
  await page.getByTestId("codecLab.encode").click();
  await expect(page.getByTestId("codecLab.mdct.maskedShare")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("codecLab.mdct.totalBitrate")).toHaveText(/kbps/);

  expect(errors).toEqual([]);
});

test("English (LTR): the tool opens and renders its controls", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/psychoacoustics");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("psychoacoustics.control.referenceSpl")).toHaveValue("94");
  await expect(page.getByTestId("psychoacoustics.chart.ath")).toBeVisible();
  await expect(page.getByTestId("theory.panel")).toContainText("threshold");
  expect(errors).toEqual([]);
});
