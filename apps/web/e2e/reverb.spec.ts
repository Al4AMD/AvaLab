/**
 * F10 reverse + reverb e2e (Wave-3 Plan 04 Task 3): the demo clip drives the
 * reverb worker op, preset changes round-trip through the URL, the result
 * paints a spectrogram and installs into the processed A/B lane, the timing
 * card compares FFT and direct convolution, the step slider walks the
 * convolution partials, and the reverse card shows before/after spectra.
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
  await expect(page.getByTestId("reverb.metric.duration")).toHaveText(/s|ms/, {
    timeout: 20_000,
  });
}

test("Persian (default): reverb presets, timing, convolution steps, reverse and playback", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/reverb");
  await loadChirp(page);

  // Preset change writes the URL and updates the RT60 default.
  await page.getByTestId("reverb.control.ir").selectOption("room");
  await expect(page).toHaveURL(/ir=room/);
  await expect(page.getByTestId("reverb.control.rt60")).toHaveValue("0.5");
  await page.getByTestId("reverb.control.ir").selectOption("hall");
  await expect(page).toHaveURL(/ir=hall/);
  await expect(page.getByTestId("reverb.control.rt60")).toHaveValue("1.8");

  // Result panel: IR + result waveforms, IR spectrum, result spectrogram.
  await expectCanvasPainted(page.getByTestId("reverb.ir.waveform"));
  await expectCanvasPainted(page.getByTestId("reverb.ir.spectrum").locator("canvas").first());
  const resultSpectrogram = page.getByTestId("reverb.result.spectrogram");
  await expectCanvasPainted(resultSpectrogram);
  await expect
    .poll(async () => resultSpectrogram.evaluate((element) => (element as HTMLCanvasElement).width))
    .toBeGreaterThan(300);
  await expect(page.getByTestId("reverb.metric.method")).toBeVisible();

  // Wet mix is serialized and the reverb recomputes.
  await page.getByTestId("reverb.control.wetMix").fill("0.9");
  await expect(page).toHaveURL(/wm=0.9/);
  await expect(page.getByTestId("reverb.metric.duration")).toHaveText(/s|ms/);

  // Timing card: same short excerpt through FFT and direct.
  await page.getByTestId("reverb.timing.measure").click();
  await expect(page.getByTestId("reverb.timing.values")).toContainText(/میلی‌ثانیه|ms/, {
    timeout: 20_000,
  });

  // Flip-and-slide: the slider walks the convolution partials.
  const stepLabel = page.getByText(/جزء مربوط به ضریب/);
  await expect(stepLabel).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("reverb.steps.slider").evaluate((element) => {
    const input = element as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, "2");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(stepLabel).toContainText("3 از 6");
  await expectCanvasPainted(page.getByTestId("reverb.steps.chart").locator("canvas").first());

  // Reverse card: before/after magnitude and phase charts.
  await expectCanvasPainted(
    page.getByTestId("reverb.reverse.beforeMagnitude").locator("canvas").first(),
  );
  await expectCanvasPainted(
    page.getByTestId("reverb.reverse.afterPhase").locator("canvas").first(),
  );

  await page.getByTestId("reverb.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");

  expect(errors).toEqual([]);
});

test("English (LTR): the reverb lab renders with zero console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/reverb");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await loadChirp(page);
  await page.getByTestId("reverb.control.ir").selectOption("telephone");
  await expect(page).toHaveURL(/ir=telephone/);
  await expectCanvasPainted(page.getByTestId("reverb.result.spectrogram"));
  await expect(page.getByTestId("reverb.reverse.note")).toBeVisible();
  expect(errors).toEqual([]);
});
