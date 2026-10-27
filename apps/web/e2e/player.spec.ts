/**
 * Dock-player e2e (F02, Wave-2 Plan 02 Task 4) on the backend-absent static
 * `vite preview` harness (same as demo/smoke): a demo card loads through
 * the REAL offline lane, the dock's controls arm, and one real play cycle
 * runs through the dock — the `mm:ss` readout advances to the first second
 * (real Web Audio clock), pausing pins it, and the page is console-clean in
 * both locales (both run — cheap here, the marker of Review Focus 5).
 *
 * The no-source posture of the dock (disabled controls + hint) is asserted
 * BEFORE the clip load. The >1 s sample-level timing is deliberately loose:
 * decodeAudioData resamples to the device rate (documented offline-lane
 * variance), so only second-granular `mm:ss` figures are used, never magic
 * numbers. The Persian spec also probes the ±5 s seek buttons (mouse +
 * keyboard Enter) against the pinned head.
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

async function loadPinkNoise(page: Page): Promise<void> {
  await expect(page.getByTestId("input.demo.card.pinkNoise")).toBeVisible();
  await page.getByTestId("input.demo.load.pinkNoise").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
}

test("Persian (default): dock arms after a demo load, play advances the readout, pause pins it", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/tools\/waveform$/);

  // No source yet: the honest hint + disabled transport controls.
  await expect(page.getByTestId("player.empty")).toBeVisible();
  await expect(page.getByTestId("player.playToggle")).toBeDisabled();

  await loadPinkNoise(page);

  // Now armed: hint gone, play available, readout at the start, the lane
  // badge names the loaded lane (the T2 carry that Task 4 owns).
  await expect(page.getByTestId("player.empty")).toHaveCount(0);
  await expect(page.getByTestId("player.lane")).toContainText("کلیپ نمونه");
  const toggle = page.getByTestId("player.playToggle");
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("player.time")).toContainText("00:00");

  // Play: the head reaches the first displayed second (real audio clock).
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player.time")).toContainText("00:01", { timeout: 4_000 });

  // Pause: the pressed state flips and the displayed second holds.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const pausedLabel = await page.getByTestId("player.time").textContent();
  await page.waitForTimeout(1_200);
  const stillPaused = await page.getByTestId("player.time").textContent();
  expect(stillPaused).toBe(pausedLabel);

  // ±5 s seek from the pinned head (paused < 00:05 → back clamps to the
  // start; forward lands at ~5 s — second-granular ties stay loose).
  const time = page.getByTestId("player.time");
  await page.getByTestId("player.back5").click();
  await expect(time).toContainText("00:00");
  // Native operability probe: keyboard focus + Enter drives the forward seek.
  await page.getByTestId("player.forward5").focus();
  await page.keyboard.press("Enter");
  await expect(time).toContainText("00:05", { timeout: 4_000 });
  expect(errors).toEqual([]);
});

test("English (persisted preference): the same play cycle, zero console errors", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("player.playToggle")).toBeDisabled();

  await loadPinkNoise(page);

  const toggle = page.getByTestId("player.playToggle");
  await expect(toggle).toBeEnabled();
  await expect(toggle).toContainText("Play");
  await expect(page.getByTestId("player.lane")).toContainText("Demo clip");
  await toggle.click();
  await expect(page.getByTestId("player.time")).toContainText("00:01", { timeout: 4_000 });
  await toggle.click();
  await expect(toggle).toContainText("Play"); // paused → "Play" label again
  const pausedLabel = await page.getByTestId("player.time").textContent();
  await page.waitForTimeout(1_200);
  const stillPaused = await page.getByTestId("player.time").textContent();
  expect(stillPaused).toBe(pausedLabel);
  expect(errors).toEqual([]);
});
