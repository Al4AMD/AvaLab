/**
 * F04 browser codec lab e2e (Wave-4 Plan 01 Task 4): the demo chirp drives the
 * real worker op, RLE proves bit-exactness, MDCT exposes sparsity, the
 * histogram paints, the decoded result installs into the processed A/B lane,
 * and "Use selection" writes the waveform selection into the URL. Both
 * locales, zero console errors.
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
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
}

test("Persian (default): RLE is bit-exact, MDCT is lossy, and the result plays", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/codec-lab");
  await loadChirp(page);

  await page.getByTestId("codecLab.encode").click();
  await expect(page.getByTestId("codecLab.stat.bitExact")).toHaveText(/✓/, { timeout: 20_000 });
  await expect(page.getByTestId("codecLab.stat.ratio")).toBeVisible();
  await expect(page.getByTestId("codecLab.stat.snr")).toHaveText(/dB/);
  await expectCanvasPainted(page.getByTestId("codecLab.histogram"));

  await page.getByTestId("codecLab.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("codecLab.control.codec").selectOption("mdct");
  await expect(page).toHaveURL(/c=mdct/);
  await page.getByTestId("codecLab.control.bitrate").selectOption("64");
  await expect(page).toHaveURL(/mbr=64/);
  await page.getByTestId("codecLab.encode").click();
  await expect(page.getByTestId("codecLab.stat.bitExact")).not.toHaveText(/✓/, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("codecLab.mdct.sparsity")).toHaveText(/%/);
  await expect(page.getByTestId("codecLab.stale")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("Persian: Use selection copies the waveform selection into from/to", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/waveform");
  await page.getByTestId("input.demo.load.pinkNoise").click();
  const detail = page.getByTestId("waveform.detail.canvas");
  await expect(detail).toBeVisible({ timeout: 15_000 });
  const box = await detail.boundingBox();
  if (box === null) {
    throw new Error("detail canvas has no box");
  }
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("waveform.selection.value")).toHaveText(/[0-9]/);

  await page.locator('a[href="/tools/codec-lab"]').click();
  await expect(page).toHaveURL(/\/tools\/codec-lab$/);
  await expect(page.getByTestId("codecLab.control.codec")).toBeVisible();
  await page.getByTestId("codecLab.useSelection").click();
  await expect(page).toHaveURL(/[?&]from=[0-9]+/);
  await expect(page).toHaveURL(/[?&]to=[0-9]+/);
  await expect(page.getByTestId("codecLab.range")).toHaveText(/[0-9]/);

  expect(errors).toEqual([]);
});

test("Persian: real codecs are disabled with an offline hint when no backend is served", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/codec-lab");
  await loadChirp(page);

  await expect(page.getByTestId("codecLab.real")).toBeVisible();
  await expect(page.getByTestId("codecLab.real.offline")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("codecLab.real.encode")).toBeDisabled();
  await expect(page.getByTestId("codecLab.real.codec")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("English (LTR): the codec lab encodes with zero console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/codec-lab");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await loadChirp(page);
  await page.getByTestId("codecLab.control.codec").selectOption("huffman");
  await page.getByTestId("codecLab.encode").click();
  await expect(page.getByTestId("codecLab.stat.bitExact")).toHaveText(/Yes/, { timeout: 20_000 });
  await expect(page.getByTestId("codecLab.stat.entropy")).toHaveText(/bit\/symbol/);
  expect(errors).toEqual([]);
});
