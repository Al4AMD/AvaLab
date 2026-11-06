/**
 * F18 last-used settings e2e (Wave-6 Plan 03 Task 7): a changed tool setting
 * survives a navigation back to the clean tool URL, because the URL is empty
 * and the tool reads its namespaced localStorage value. The generator, speed,
 * reverb and codec lab cover form, preset, number and select controls in both
 * locales. Reloading the query-bearing URL would mask storage, so each test
 * navigates to the same route without a query string.
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
  await expect(page.getByTestId("input.demo.card.chirp")).toBeVisible();
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
  await expect(page.getByTestId("player.playToggle")).toBeEnabled();
}

async function storedValue(page: Page, key: string): Promise<string | null> {
  return page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
}

test("Persian: generator waveform survives the clean-URL reload", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/generator");
  await expect(page.getByTestId("generator.preview.canvas")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("generator.control.waveform").selectOption("chirp");
  await page.getByTestId("generator.control.duration").fill("1.5");
  await expect(page).toHaveURL(/w=chirp/);
  await expect.poll(() => storedValue(page, "avalab.generator.last")).toContain("w=chirp");

  await page.goto("/tools/generator");
  await expect(page.getByTestId("generator.preview.canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("generator.control.waveform")).toHaveValue("chirp");
  await expect(page.getByTestId("generator.control.duration")).toHaveValue("1.5");
  expect(errors).toEqual([]);
});

test("Persian: speed preset survives the clean-URL reload", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/speed");
  await loadChirp(page);
  await page.getByTestId("speed.preset.2").click();
  await expect(page).toHaveURL(/sp=2/);
  await expect.poll(() => storedValue(page, "avalab.speed.last")).toContain("sp=2");

  await page.goto("/tools/speed");
  await loadChirp(page);
  await expect(page.getByTestId("speed.preset.2")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("English (LTR): reverb RT60 survives the clean-URL reload", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/reverb");
  await loadChirp(page);
  await page.getByTestId("reverb.control.rt60").fill("2.5");
  await expect(page).toHaveURL(/rt=2.5/);
  await expect.poll(() => storedValue(page, "avalab.reverb.last")).toContain("rt=2.5");

  await page.goto("/tools/reverb");
  await loadChirp(page);
  await expect(page.getByTestId("reverb.control.rt60")).toHaveValue("2.5");
  expect(errors).toEqual([]);
});

test("English (LTR): codec and MDCT bitrate survive the clean-URL reload", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/codec-lab");
  await loadChirp(page);
  await page.getByTestId("codecLab.control.codec").selectOption("mdct");
  await page.getByTestId("codecLab.control.bitrate").selectOption("64");
  await expect(page).toHaveURL(/c=mdct/);
  await expect.poll(() => storedValue(page, "avalab.codec-lab.last")).toContain("mbr=64");

  await page.goto("/tools/codec-lab");
  await loadChirp(page);
  await expect(page.getByTestId("codecLab.control.codec")).toHaveValue("mdct");
  await expect(page.getByTestId("codecLab.control.bitrate")).toHaveValue("64");
  expect(errors).toEqual([]);
});
