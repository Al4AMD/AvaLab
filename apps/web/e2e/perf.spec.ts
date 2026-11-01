/**
 * F02 performance gates (Wave 2 Plan 03 Task 4): click → painted-canvas
 * latency on the bundled demo clips, measured on the backend-absent static
 * preview. The backend is not involved anywhere in these two paths (offline
 * decode lane → real worker op → canvas paint), so these run instead of
 * skipping; the Wave-0 harness contract only skips tests that need the API.
 *
 * The paint proof is the same alpha-sum poll used by waveform.spec.ts and
 * spectrogram.spec.ts: a blank backing store has alpha 0, a painted canvas
 * does not. Timing starts at the demo-clip click and ends when the poll
 * first observes painted pixels; Playwright's poll interval (≈100 ms) is
 * part of the measurement, so the gates keep AGENTS §9's generous headroom.
 */
import { expect, type Page, test } from "@playwright/test";

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

test("waveform overview first paint stays under 1000 ms", async ({ page }) => {
  await page.goto("/tools/waveform");
  const load = page.getByTestId("input.demo.load.pinkNoise");
  await expect(load).toBeVisible();

  const clickedAt = Date.now();
  await load.click();
  await expectCanvasPainted(page, "waveform.overview.canvas");
  const firstPaintMs = Date.now() - clickedAt;

  test.info().annotations.push({
    type: "overview-first-paint-ms",
    description: String(firstPaintMs),
  });
  console.log(`[perf] overview-first-paint ${firstPaintMs} ms (gate < 1000 ms)`);
  expect(firstPaintMs).toBeLessThan(1000);
});

test("spectrogram first tiles stay under 3000 ms", async ({ page }) => {
  await page.goto("/tools/spectrogram");
  const load = page.getByTestId("input.demo.load.chirp");
  await expect(load).toBeVisible();

  const clickedAt = Date.now();
  await load.click();
  await expectCanvasPainted(page, "spectrogram.canvas");
  const firstTilesMs = Date.now() - clickedAt;

  test.info().annotations.push({
    type: "spectrogram-first-tiles-ms",
    description: String(firstTilesMs),
  });
  console.log(`[perf] spectrogram-first-tiles ${firstTilesMs} ms (gate < 3000 ms)`);
  expect(firstTilesMs).toBeLessThan(3000);
});
