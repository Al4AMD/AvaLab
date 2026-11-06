/**
 * F09 freehand-curve e2e: two canvas points build a curve, Apply stores it in
 * the URL, the worker re-runs the edit, and the link survives reload. Both
 * locales, zero console errors.
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
  await expect(page.getByTestId("spectrumEdit.meta.fftLength")).toBeVisible({
    timeout: 20_000,
  });
}

async function addTwoPoints(page: Page): Promise<void> {
  const canvas = page.getByTestId("spectrumEdit.curve.canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("curve canvas has no layout box");
  }
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.6);
  await expect(page.getByTestId("spectrumEdit.curve.count")).toContainText("1");
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.3);
  await expect(page.getByTestId("spectrumEdit.curve.count")).toContainText("2");
}

test("Persian (default): draw, apply, undo and restore a curve from the URL", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/spectrum-edit");
  await loadChirp(page);
  await addTwoPoints(page);

  await page.getByTestId("spectrumEdit.curve.apply").click();
  await expect(page).toHaveURL(/cv=/);
  await expect(page.getByTestId("spectrumEdit.curve.clear")).toBeEnabled();

  await page.reload();
  await loadChirp(page);
  await expect(page.getByTestId("spectrumEdit.curve.clear")).toBeEnabled();

  await page.getByTestId("spectrumEdit.curve.clear").click();
  await expect(page).not.toHaveURL(/cv=/);
  expect(errors).toEqual([]);
});

test("English (LTR): curve editor renders and undo removes a point", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/spectrum-edit");
  await loadChirp(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await addTwoPoints(page);
  await page.getByTestId("spectrumEdit.curve.undo").click();
  await expect(page.getByTestId("spectrumEdit.curve.count")).toContainText("1");
  expect(errors).toEqual([]);
});
