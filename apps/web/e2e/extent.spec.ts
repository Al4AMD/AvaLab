/**
 * Signal-extent e2e (F07, Wave-3 Plan 03 Task 3): the demo clip drives the
 * extent worker op, the support readout moves with a shift, truncation widens
 * the bin width, zero-padding paints the before/after spectra, periodic
 * extension repeats the buffer, and the result installs into the processed
 * A/B lane. Both locales, zero console errors.
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
  await expect(page.getByTestId("extent.metric.duration")).toHaveText(/s|ms/, {
    timeout: 15_000,
  });
}

test("Persian (default): shift moves support, truncation widens Δf, periodic extends and plays", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/extent");
  await loadChirp(page);

  const support = page.getByTestId("extent.metric.support");
  const initialSupport = await support.textContent();
  await page.getByTestId("extent.control.operation").selectOption("shift");
  await page.getByTestId("extent.control.shift").fill("1000");
  await expect(page).toHaveURL(/sh=1000/);
  await expect.poll(async () => support.textContent()).not.toBe(initialSupport);

  await page.getByTestId("extent.control.operation").selectOption("zeroPad");
  await page.getByTestId("extent.control.padEnd").fill("48000");
  await expect(page.getByTestId("extent.metric.samples")).toHaveText("288000");
  await expectCanvasPainted(page.getByTestId("extent.spectrum.before").locator("canvas").first());
  await expectCanvasPainted(page.getByTestId("extent.spectrum.after").locator("canvas").first());

  const binWidth = page.getByTestId("extent.metric.deltaF");
  const paddedBinWidth = await binWidth.textContent();
  await page.getByTestId("extent.control.operation").selectOption("truncate");
  await page.getByTestId("extent.control.truncateLength").fill("4800");
  await expect(page.getByTestId("extent.metric.samples")).toHaveText("4800");
  await expect.poll(async () => binWidth.textContent()).not.toBe(paddedBinWidth);

  await page.getByTestId("extent.control.operation").selectOption("periodic");
  await page.getByTestId("extent.control.repetitions").fill("3");
  await expect(page.getByTestId("extent.metric.samples")).toHaveText("720000");
  await expect(page.getByTestId("extent.metric.type")).toContainText(/توان|Power/);

  await page.getByTestId("extent.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");

  expect(errors).toEqual([]);
});

test("English (LTR): the extent lab renders with zero console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/extent");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await loadChirp(page);
  await page.getByTestId("extent.control.operation").selectOption("reverse");
  await expectCanvasPainted(page.getByTestId("extent.waveform.after"));
  await expectCanvasPainted(page.getByTestId("extent.spectrum.after").locator("canvas").first());
  expect(errors).toEqual([]);
});
