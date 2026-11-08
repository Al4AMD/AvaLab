/**
 * D-056 Phase 2/3 stereo processors e2e: filters, the spectrum editor, the toy
 * codec lab, sampling, speed and signal extent use the bundled stereo demo
 * through the real worker/store path. Both-lane output must stay installable
 * for playback and console-clean.
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

test("sampling both: independent lane bit depth, per-lane metrics and stereo playback", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/sampling?ch=both");
  await loadStereo(page);

  await expect(page.getByTestId("sampling.lane.left")).toBeVisible();
  await expect(page.getByTestId("sampling.lane.right")).toBeVisible();
  await expect(page.getByTestId("sampling.linkRight")).toBeChecked({ timeout: 20_000 });
  await expect(page.getByTestId("sampling.metrics.lanes")).toBeVisible();
  await expect(page.getByTestId("sampling.metrics.lane.left")).toBeVisible();
  await expect(page.getByTestId("sampling.metrics.lane.right")).toBeVisible();

  await page.getByTestId("sampling.play.processed").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player.channels")).toHaveText("2 کانال");
  expect(errors).toEqual([]);
});

test("speed both: link mirrors reverse, per-lane durations show and playback works", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/speed?ch=both");
  await loadStereo(page);

  await expect(page.getByTestId("speed.lane.left")).toBeVisible();
  await expect(page.getByTestId("speed.lane.right")).toBeVisible();
  await expect(page.getByTestId("speed.linkRight")).toBeChecked();
  await expect(page.getByTestId("speed.lane.status")).toContainText("پیروی");
  await expect(page.getByTestId("speed.result.lanes")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("speed.result.lane.left")).toBeVisible();
  await expect(page.getByTestId("speed.result.lane.right")).toBeVisible();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player.channels")).toHaveText("2 کانال");
  expect(errors).toEqual([]);
});

test("extent both: shared operation parameters produce per-lane stats and stereo playback", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/extent?ch=both");
  await loadStereo(page);

  await expect(page.getByTestId("extent.lane.gridNote")).toBeVisible();
  await expect(page.getByTestId("extent.metrics.lanes")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("extent.metrics.lane.left")).toBeVisible();
  await expect(page.getByTestId("extent.metrics.lane.right")).toBeVisible();

  await page.getByTestId("extent.control.operation").selectOption("reverse");
  await expect(page.getByTestId("extent.metrics.lane.left")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("extent.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player.channels")).toHaveText("2 کانال");
  expect(errors).toEqual([]);
});

test("reverb both: four-path stereo result installs two processed channels", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/reverb?ch=both");
  await loadStereo(page);

  await expect(page.getByTestId("reverb.stereo.note")).toBeVisible();
  await expect(page.getByTestId("reverb.metric.channels")).toHaveText("2", { timeout: 30_000 });
  await expect(page.getByTestId("reverb.result.waveform")).toBeVisible();
  await page.getByTestId("reverb.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player.channels")).toHaveText("2 کانال");
  expect(errors).toEqual([]);
});

test("pipeline both: the same graph runs per lane, combines outputs and installs stereo", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/pipeline?ch=both");
  await loadStereo(page);

  await page.getByTestId("pipeline.run").click();
  await expect(page.getByTestId("pipeline.stage.output-1")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("pipeline.result.lanes")).toBeVisible();
  await expect(page.getByTestId("pipeline.runError")).toHaveCount(0);

  await page.getByTestId("pipeline.output.install").click();
  await expect(page.getByTestId("pipeline.installed")).toBeVisible();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player.channels")).toHaveText("2 کانال");
  expect(errors).toEqual([]);
});
