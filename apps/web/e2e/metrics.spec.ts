/**
 * F05 metrics e2e (Wave-4 Plan 03 Task 4): the hand-written RLE result installs
 * the processed lane, and `/tools/metrics` measures the aligned pair. RLE is
 * bit-exact inside the 16-bit PCM grid, so the comparison against the float
 * source still shows finite quantization error.
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

async function installCodecLabResult(page: Page): Promise<void> {
  await page.goto("/tools/codec-lab");
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
  await page.getByTestId("codecLab.encode").click();
  await expect(page.getByTestId("codecLab.stat.bitExact")).toHaveText(/✓/, { timeout: 20_000 });
  await page.getByTestId("codecLab.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
}

test("Persian: the metrics lab compares the processed lane and shows the PSNR note", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await installCodecLabResult(page);

  await page.locator('a[href="/tools/metrics"]').click();
  await expect(page).toHaveURL(/\/tools\/metrics$/);
  await expect(page.getByTestId("metrics.value.mse")).toBeVisible();
  await expect(page.getByTestId("metrics.value.snr")).toHaveText(/dB/);
  await expect(page.getByTestId("metrics.value.segmentalSnr")).toHaveText(/dB/);
  await expect(page.getByTestId("metrics.value.psnr")).toHaveText(/dB/);
  await expect(page.getByTestId("metrics.value.samples")).not.toHaveText("—");
  await expect(page.getByTestId("metrics.codecNote")).toBeVisible();
  expect(errors).toEqual([]);
});

test("English (LTR): the metrics lab renders in LTR with zero console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await installCodecLabResult(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  await page.locator('a[href="/tools/metrics"]').click();
  await expect(page.getByTestId("metrics.value.mse")).toBeVisible();
  await expect(page.getByTestId("metrics.value.snr")).toHaveText(/dB/);
  expect(errors).toEqual([]);
});
