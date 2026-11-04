/**
 * F11 filter design lab e2e (Wave-5 Plan 04 Task 5): the chirp demo drives the
 * worker design op, every analysis panel paints finite data, parameter edits
 * round-trip through the URL, invalid cutoffs are rejected, and the applied
 * result installs into the processed A/B lane. Both locales, zero console
 * errors. Axis runs stay LTR in both directions.
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

async function loadChirp(page: Page): Promise<void> {
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("filters.result.stability")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("filters.control.sampleRate")).toContainText("48");
}

async function expectFinitePlots(page: Page): Promise<void> {
  for (const testId of [
    "filters.plot.magnitude",
    "filters.plot.phase",
    "filters.plot.groupDelay",
    "filters.plot.impulse",
    "filters.plot.step",
    "filters.poleZero",
  ]) {
    const plot = page.getByTestId(testId);
    await expect(plot).toBeVisible();
    const markup = await plot.evaluate((element) => element.outerHTML);
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(
      await plot.evaluate((element) => element.closest("figure")?.getAttribute("dir") ?? null),
    ).toBe("ltr");
  }
}

test("Persian (default): design, plot, edit, validate, and apply", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/filters");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await loadChirp(page);

  // Default Butterworth low-pass: stable, with delay and all six panels.
  await expect(page.getByTestId("filters.result.stability")).toContainText("پایدار");
  await expect(page.getByTestId("filters.result.delay")).toContainText("samples");
  await expectFinitePlots(page);

  // Kind/band edits serialize to the URL and re-design in the worker.
  await page.getByTestId("filters.control.kind").selectOption("fir");
  await expect(page).toHaveURL(/k=fir/);
  await expect(page.getByTestId("filters.control.taps")).toHaveValue("101");
  await page.getByTestId("filters.control.taps").fill("33");
  await expect(page).toHaveURL(/t=33/);
  await page.getByTestId("filters.control.band").selectOption("bandpass");
  await expect(page).toHaveURL(/bd=bandpass/);
  await expect(page.getByTestId("filters.control.cutoff2")).toBeVisible();
  await page.getByTestId("filters.control.cutoff2").fill("12000");
  await expect(page).toHaveURL(/c2=12000/);
  await expectFinitePlots(page);

  // Out-of-Nyquist cutoff is rejected and disables both apply actions.
  await page.getByTestId("filters.control.cutoff").fill("30000");
  await expect(page.getByTestId("filters.error.invalid")).toBeVisible();
  await expect(page.getByTestId("filters.apply.selection")).toHaveCount(0);
  await expect(page.getByTestId("filters.apply.all")).toHaveCount(0);
  await page.getByTestId("filters.control.cutoff").fill("4000");
  await expect(page.getByTestId("filters.error.invalid")).toHaveCount(0);

  // Apply-to-selection installs the filtered excerpt into the processed lane.
  await expect(page.getByTestId("filters.apply.selection")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("filters.apply.selection").click();
  await expect(page.getByTestId("filters.apply.done")).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/as=selection/);
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");

  expect(errors).toEqual([]);
});

test("English (LTR): design, apply-to-all, and LTR technical axes", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/filters");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await loadChirp(page);

  await expect(page.getByTestId("filters.result.stability")).toContainText("Stable");
  await expectFinitePlots(page);

  await page.getByTestId("filters.control.kind").selectOption("biquad");
  await expect(page).toHaveURL(/k=biquad/);
  await page.getByTestId("filters.control.band").selectOption("peaking");
  await expect(page).toHaveURL(/bd=peaking/);
  await expect(page.getByTestId("filters.control.gain")).toBeVisible();
  await expectFinitePlots(page);

  await expect(page.getByTestId("filters.apply.all")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("filters.apply.all").click();
  await expect(page.getByTestId("filters.apply.done")).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/as=all/);

  expect(errors).toEqual([]);
});
