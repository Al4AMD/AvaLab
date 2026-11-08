/**
 * D-056 Phase 1 channel foundation e2e: the bundled stereo demo drives the
 * waveform (mono/left/right/both), spectrogram and FFT lane pickers through
 * the real worker/store path. `ch` is URL-backed, and lane switches must not
 * leave stale canvases or console errors.
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

async function expectCanvasPainted(page: Page, testId: string): Promise<void> {
  const canvas = page.getByTestId(testId);
  await expect(canvas).toBeVisible();
  await expect
    .poll(
      async () =>
        canvas.evaluate((element) => {
          const node = element as HTMLCanvasElement;
          if (node.width === 0 || node.height === 0) {
            return 0;
          }
          const context = node.getContext("2d");
          if (context === null) {
            return -1;
          }
          const pixels = context.getImageData(0, 0, node.width, node.height).data;
          let alphaSum = 0;
          for (let index = 3; index < pixels.length; index += 4) {
            alphaSum += pixels[index] ?? 0;
          }
          return alphaSum;
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
}

test("waveform both paints two lanes, right switches URL and keeps one panel", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/waveform?ch=both");
  await expect(page.getByTestId("input.demo.load.stereo")).toBeVisible();
  await page.getByTestId("input.demo.load.stereo").click();

  await expect(page.getByTestId("waveform.lane.left")).toBeVisible();
  await expect(page.getByTestId("waveform.lane.right")).toBeVisible();
  await expectCanvasPainted(page, "waveform.overview.canvas");
  await expectCanvasPainted(page, "waveform.overview.canvas.right");

  await page.getByTestId("channel.mode.right").click();
  await expect(page).toHaveURL(/ch=right/);
  await expect(page.getByTestId("channel.mode.right")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("waveform.overview.canvas.right")).toHaveCount(0);
  await expectCanvasPainted(page, "waveform.overview.canvas");
  await expectCanvasPainted(page, "waveform.detail.canvas");
  expect(errors).toEqual([]);
});

test("spectrogram right shows the right lane label and paints", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/spectrogram?ch=right");
  await page.getByTestId("input.demo.load.stereo").click();
  await expect(page.getByTestId("spectrogram.meta.channel")).toHaveText(/راست/);
  await expectCanvasPainted(page, "spectrogram.canvas");
  expect(errors).toEqual([]);
});

test("FFT left keeps the URL-backed left lane and paints charts", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/fftview?ch=left");
  await page.getByTestId("input.demo.load.stereo").click();
  await expect(page.getByTestId("channel.mode.left")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("fftview.chart.magnitude")).toBeVisible();
  await expect(page.getByTestId("fftview.meta.channel")).toHaveText(/چپ/);
  await expect(page.getByTestId("fftview.meta.bins")).not.toHaveText("0");
  expect(errors).toEqual([]);
});
