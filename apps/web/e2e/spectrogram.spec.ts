/**
 * Spectrogram e2e (F02, Wave 2 Plan 03 Task 3) on the backend-absent
 * static-preview harness: a demo clip loads through the real offline lane,
 * the spectrogram op runs in the real worker, and the canvas paints real
 * pixels. Pixel assertions read the backing store with `getImageData` and
 * poll (the worker result + rAF paint land after the clip load resolves).
 *
 * The first-tiles perf gate is recorded as a Playwright annotation (no
 * fixture for a 5-minute source exists yet; Plan 04's generator lands it).
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

/** Cheap pixel signature: FNV-1a over stride-sampled RGB bytes. */
async function spectrogramSignature(page: Page): Promise<number> {
  return page.getByTestId("spectrogram.canvas").evaluate((element) => {
    const node = element as HTMLCanvasElement;
    const context = node.getContext("2d");
    if (context === null) {
      return 0;
    }
    const pixels = context.getImageData(0, 0, node.width, node.height).data;
    let hash = 0x811c9dc5;
    for (let index = 0; index < pixels.length; index += 97) {
      hash ^= pixels[index] ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  });
}

async function expectSpectrogramPainted(page: Page, testId = "spectrogram.canvas"): Promise<void> {
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

test("Persian (default): a demo clip paints the spectrogram and controls re-derive", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/spectrogram");
  await expect(page.getByTestId("input.demo.load.chirp")).toBeVisible();

  const clickedAt = Date.now();
  await page.getByTestId("input.demo.load.chirp").click();
  await expectSpectrogramPainted(page);
  const loadMs = Date.now() - clickedAt;
  test.info().annotations.push({
    type: "load-to-first-tiles-ms",
    description: String(loadMs),
  });
  expect(loadMs).toBeLessThan(3000);
  const firstSignature = await spectrogramSignature(page);

  // Window family change re-derives through the worker.
  await page.getByTestId("spectrogram.control.windowFamily").selectOption("blackman");
  await expectSpectrogramPainted(page);
  await expect.poll(() => spectrogramSignature(page)).not.toBe(firstSignature);
  const blackmanSignature = await spectrogramSignature(page);

  // Window length change re-derives too.
  await page.getByTestId("spectrogram.control.windowLength").selectOption("2048");
  await expectSpectrogramPainted(page);
  await expect.poll(() => spectrogramSignature(page)).not.toBe(blackmanSignature);
  const lengthSignature = await spectrogramSignature(page);

  // Log frequency axis repaints the same map with a different y mapping.
  await page.getByTestId("spectrogram.axis.log").click();
  await expectSpectrogramPainted(page);
  await expect.poll(() => spectrogramSignature(page)).not.toBe(lengthSignature);

  // Rapid parameter changes: last write wins, no error state.
  const windowLength = page.getByTestId("spectrogram.control.windowLength");
  await windowLength.selectOption("2048");
  await windowLength.selectOption("512");
  await windowLength.selectOption("4096");
  await expectSpectrogramPainted(page);
  await expect(page.getByTestId("spectrogram.error")).toHaveCount(0);
  await expect(page.getByTestId("spectrogram.meta.decimation")).toBeVisible();

  expect(errors).toEqual([]);
});

test("English (persisted preference): spectrogram paints with zero console errors", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/spectrogram");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByTestId("input.demo.load.pinkNoise").click();
  await expectSpectrogramPainted(page);
  expect(errors).toEqual([]);
});

test("general before/after comparison paints the processed spectrogram", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/speed");
  await page.getByTestId("input.demo.load.chirp").click();
  await page.getByTestId("speed.preset.2").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("link", { name: "طیف‌نگاره (Spectrogram)" }).click();
  await expect(page).toHaveURL(/\/tools\/spectrogram/);
  await expect(page.getByTestId("spectrogram.compare.toggle")).toBeChecked();
  await expectSpectrogramPainted(page);
  await expectSpectrogramPainted(page, "spectrogram.canvas.processed");
  await expect(page.getByTestId("spectrogram.compare.processed")).toBeVisible();
  await expect(page.getByTestId("spectrogram.compare.missing")).toHaveCount(0);

  await page.getByTestId("spectrogram.compare.toggle").uncheck();
  await expect(page.getByTestId("spectrogram.canvas.processed")).toHaveCount(0);
  await expectSpectrogramPainted(page);
  await page.getByTestId("spectrogram.compare.toggle").check();
  await expectSpectrogramPainted(page, "spectrogram.canvas.processed");
  expect(errors).toEqual([]);
});
