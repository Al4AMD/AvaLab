/**
 * F08 benchmark/butterfly e2e: the worker runs the fft.js comparison, the
 * butterfly view steps through the radix-2 schedule, and every flow stays
 * console-clean. Both locales.
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
  await page.goto("/tools/fftview");
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("fftview.chart.magnitude")).toBeVisible({ timeout: 20_000 });
}

test("Persian (default): benchmark table and butterfly steps run in the worker", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await loadChirp(page);

  await expect(page.getByTestId("fftview.butterfly.values")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("fftview.butterfly.step")).toHaveText("1/12");
  await page.getByTestId("fftview.butterfly.next").click();
  await expect(page.getByTestId("fftview.butterfly.step")).toHaveText("2/12");
  await page.getByTestId("fftview.butterfly.size").selectOption("16");
  await expect(page.getByTestId("fftview.butterfly.step")).toHaveText("1/32", {
    timeout: 20_000,
  });

  await page.getByTestId("fftview.benchmark.run").click();
  await expect(page.getByTestId("fftview.benchmark.row.16384")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId("fftview.benchmark.row.256")).toContainText("ms");
  await expect(page.getByTestId("fftview.benchmark.row.256")).toContainText("×");
  expect(errors).toEqual([]);
});

test("English (LTR): benchmark and butterfly panels render with zero console errors", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await loadChirp(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("fftview.benchmark.run")).toBeVisible();
  await expect(page.getByTestId("fftview.butterfly.values")).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
