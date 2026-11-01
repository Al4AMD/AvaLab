/**
 * Sampling and bit-depth e2e (F03, Wave-3 Plan 02 Task 3): the aliasing card
 * is source-free, the demo clip drives the resample/quantize worker op, the
 * error chart paints, and the residual installs into the processed A/B lane.
 * Both locales, zero console errors.
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
  await expect(canvas).toBeVisible({ timeout: 15_000 });
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

async function loadChirp(page: Page): Promise<void> {
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("sampling.metric.snr")).toHaveText(/dB/, { timeout: 15_000 });
}

test("Persian (default): aliasing is source-free, then 8 kHz with the filter off shows SNR and residual", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/sampling");

  // The aliasing card works before any file is loaded.
  const predicted = page.getByTestId("sampling.alias.predicted");
  await expect(predicted).toBeVisible({ timeout: 15_000 });
  const initialPrediction = await predicted.textContent();
  await page.getByTestId("sampling.alias.targetRate").selectOption("16000");
  await expect.poll(async () => predicted.textContent()).not.toBe(initialPrediction);

  await loadChirp(page);
  await page.getByTestId("sampling.control.targetRate").selectOption("8000");
  await expect(page).toHaveURL(/tr=8000/);
  await page.getByTestId("sampling.control.antiAlias").click();
  await expect(page.getByTestId("sampling.control.antiAlias")).not.toBeChecked();
  await expect(page).toHaveURL(/aa=0/);

  await expectCanvasPainted(page.getByTestId("sampling.result.before"));
  await expectCanvasPainted(page.getByTestId("sampling.result.after"));
  await expectCanvasPainted(page.getByTestId("sampling.error.chart").locator("canvas").first());
  await expect(page.getByTestId("sampling.metric.segmentalSnr")).toHaveText(/dB/);
  await expect(page.getByTestId("sampling.metric.psnr")).toHaveText(/dB/);
  await expect(page.getByTestId("sampling.metric.theorySnr")).toHaveText(/dB/);

  await page.getByTestId("sampling.play.residual").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");

  expect(errors).toEqual([]);
});

test("English (LTR): the sampling lab renders with zero console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/sampling");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await loadChirp(page);
  await page.getByTestId("sampling.control.targetRate").selectOption("8000");
  await expectCanvasPainted(page.getByTestId("sampling.result.after"));
  await expect(page.getByTestId("sampling.metric.snr")).toHaveText(/dB/);
  expect(errors).toEqual([]);
});
