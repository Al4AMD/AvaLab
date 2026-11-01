/**
 * F09 spectrum editor e2e (Wave-3 Plan 05 Task 3): the chirp demo drives the
 * worker op, the 65,536-sample cap notice shows, a band edit and a preset
 * round-trip through the URL, flipping Hermitian off reveals the complex
 * output warning, and the edited result installs into the processed lane.
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

async function loadChirp(page: Page): Promise<void> {
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("spectrumEdit.meta.fftLength")).toBeVisible({
    timeout: 20_000,
  });
}

test("Persian (default): edits, presets, Hermitian toggle, playback and URL restore", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  // The explicit full-file range is longer than the analysis cap.
  await page.goto("/tools/spectrum-edit?from=0&to=999999");
  await loadChirp(page);

  // The chirp is longer than the analysis cap.
  await expect(page.getByTestId("spectrumEdit.cap")).toBeVisible();
  await expectCanvasPainted(page.getByTestId("spectrumEdit.chart.re").locator("canvas").first());
  await expectCanvasPainted(page.getByTestId("spectrumEdit.chart.phase").locator("canvas").first());

  // Band edit: magnitude zero from 500 Hz to 2 kHz.
  await page.getByTestId("spectrumEdit.add").click();
  await expect(page).toHaveURL(/ed=/);
  await expect(page.getByTestId("spectrumEdit.edit.item")).toBeVisible();
  await expect(page.getByTestId("spectrumEdit.edit.item")).toContainText("[");

  // A preset replaces the edit list.
  await page.getByTestId("spectrumEdit.preset.zeroIm").click();
  await expect(page.getByTestId("spectrumEdit.edit.item")).toHaveCount(1);

  // Hermitian off: warning plus a non-zero imaginary-energy readout.
  await page.getByTestId("spectrumEdit.control.hermitian").uncheck();
  await expect(page).toHaveURL(/h=0/);
  await expect(page.getByTestId("spectrumEdit.warning.hermitian")).toBeVisible();
  await expect(page.getByTestId("spectrumEdit.meta.imaginaryRatio")).not.toHaveText("0.000e+0");

  await page.getByTestId("spectrumEdit.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await loadChirp(page);
  await expect(page.getByTestId("spectrumEdit.control.hermitian")).not.toBeChecked();
  await expect(page.getByTestId("spectrumEdit.edit.item")).toBeVisible();

  expect(errors).toEqual([]);
});

test("English (LTR): the spectrum editor renders with zero console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/spectrum-edit");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await loadChirp(page);
  await page.getByTestId("spectrumEdit.preset.magnitudeOnly").click();
  await expect(page.getByTestId("spectrumEdit.edit.item")).toBeVisible();
  await expectCanvasPainted(
    page.getByTestId("spectrumEdit.chart.magnitude").locator("canvas").first(),
  );
  expect(errors).toEqual([]);
});
