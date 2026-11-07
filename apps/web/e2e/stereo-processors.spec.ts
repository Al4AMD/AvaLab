/**
 * D-056 Phase 2 stereo processors e2e: filters, the spectrum editor and the
 * toy codec lab use the bundled stereo demo through the real worker/store
 * path. Both-lane output must stay installable for playback and console-clean.
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

async function loadStereo(page: Page): Promise<void> {
  await page.getByTestId("input.demo.load.stereo").click();
  await expect(page.getByTestId("player.channels")).toHaveText("2 کانال");
}

test("filters both: link mirrors the right lane and the stereo result applies", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/filters?ch=both");
  await loadStereo(page);

  await expect(page.getByTestId("filters.lane.left")).toBeVisible();
  await expect(page.getByTestId("filters.lane.right")).toBeVisible();
  await expect(page.getByTestId("filters.linkRight")).toBeChecked();
  await expect(page.getByTestId("filters.lane.status")).toContainText("پیروی");

  await expect(page.getByTestId("filters.apply.selection")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("filters.apply.selection").click();
  await expect(page.getByTestId("filters.apply.done")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("spectrum editor both: lane buttons, zeroIm preset and stereo playback", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/spectrum-edit?ch=both");
  await loadStereo(page);

  await expect(page.getByTestId("spectrumEdit.lane.left")).toBeVisible();
  await expect(page.getByTestId("spectrumEdit.lane.right")).toBeVisible();
  await expect(page.getByTestId("spectrumEdit.meta.fftLength")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("spectrumEdit.preset.zeroIm").click();
  await expect(page.getByTestId("spectrumEdit.edit.item")).toBeVisible();
  await page.getByTestId("spectrumEdit.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player.channels")).toHaveText("2 کانال");
  expect(errors).toEqual([]);
});

test("codec lab both: independent lanes encode, aggregate stats show and playback works", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/codec-lab?ch=both");
  await loadStereo(page);

  await expect(page.getByTestId("codecLab.lane.left")).toBeVisible();
  await expect(page.getByTestId("codecLab.lane.right")).toBeVisible();
  await expect(page.getByTestId("codecLab.linkRight")).toBeChecked();

  await page.getByTestId("codecLab.encode").click();
  await expect(page.getByTestId("codecLab.stats.aggregate")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("codecLab.aggregate.bitExact")).toHaveText(/✓/);
  await expect(page.getByTestId("codecLab.toy.mode")).toContainText("هر دو کانال");
  await expect(page.getByTestId("codecLab.stats.lane.left")).toBeVisible();
  await expect(page.getByTestId("codecLab.stats.lane.right")).toBeVisible();

  await page.getByTestId("codecLab.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player.channels")).toHaveText("2 کانال");
  expect(errors).toEqual([]);
});
