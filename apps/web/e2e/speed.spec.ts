/**
 * Speed and direction e2e (F06, Wave-3 Plan 01 Task 4): the demo clip loads
 * through the offline lane, the worker computes the speed transform and the
 * result spectrogram, and the processed lane auto-activates in the A/B dock.
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

async function expectCanvasPainted(page: Page, testId: string): Promise<void> {
  const canvas = page.getByTestId(testId);
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

test("Persian (default): 2x resample processes, paints, and activates the A/B lane", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/speed");
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);

  await page.getByTestId("speed.preset.2").click();
  await expect(page).toHaveURL(/sp=2/);
  await expectCanvasPainted(page, "speed.result.waveform");
  await expectCanvasPainted(page, "speed.result.spectrogram");
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("speed.result.actualSpeed")).toHaveText("×2.00");
  await expect(page.getByTestId("speed.result.duration")).toHaveText("2.500 s");
  await expect(page.getByTestId("speed.control.semitones")).toBeDisabled();

  await page.getByTestId("speed.control.reverse").click();
  await expect(page.getByTestId("speed.control.reverse")).toBeChecked();
  await expect(page).toHaveURL(/rv=1/);
  await expect(page.getByTestId("speed.result.waveform")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Persian: time-stretch 2x halves duration and +12 semitones keeps it", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/speed");
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);

  await page.getByTestId("speed.control.mode").selectOption("timeStretch");
  await expect(page).toHaveURL(/m=timeStretch/);
  await page.getByTestId("speed.preset.2").click();
  await expect(page.getByTestId("speed.result.duration")).toHaveText("2.500 s");
  await expect(page.getByTestId("speed.control.semitones")).toBeEnabled();

  await page.getByTestId("speed.preset.1").click();
  await expect(page.getByTestId("speed.result.duration")).toHaveText("5.000 s");
  await page.getByTestId("speed.control.semitones").fill("12");
  await expect(page).toHaveURL(/[?&]p=12/);
  await expect(page.getByTestId("speed.result.duration")).toHaveText("5.000 s");
  await expect(page.getByTestId("speed.result.waveform")).toBeVisible();
  expect(errors).toEqual([]);
});

test("English (LTR): the speed lab renders with zero console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/speed");
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
  await page.getByTestId("speed.preset.2").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expectCanvasPainted(page, "speed.result.spectrogram");

  await page.getByTestId("speed.control.mode").selectOption("timeStretch");
  await page.getByTestId("speed.preset.1").click();
  await expect(page.getByTestId("speed.result.duration")).toHaveText("5.000 s");
  await page.getByTestId("speed.control.semitones").fill("12");
  await expect(page).toHaveURL(/[?&]p=12/);
  await expect(page.getByTestId("speed.result.duration")).toHaveText("5.000 s");
  expect(errors).toEqual([]);
});
