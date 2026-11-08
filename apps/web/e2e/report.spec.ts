/**
 * F16 lab-report e2e: run a tool, export the standalone HTML report, and
 * verify it carries the current tool, source, measured metrics, rendered
 * figures and theory without console errors. The report is downloaded, not
 * opened in the page, so this checks the actual file a student receives.
 */
import { readFile } from "node:fs/promises";

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

test("Persian: the lab report downloads with parameters, metrics, figures and theory", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/speed");
  await expect(page.getByTestId("report.download")).toBeDisabled();
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("report.download")).toBeEnabled();
  await page.getByTestId("speed.preset.2").click();
  await expect(page.getByTestId("speed.result.waveform")).toBeVisible();

  const downloading = page.waitForEvent("download");
  await page.getByTestId("report.download").click();
  const download = await downloading;
  const path = await download.path();
  expect(path).not.toBeNull();
  const html = await readFile(path as string, "utf8");

  expect(html).toContain('<html lang="fa" dir="rtl">');
  expect(html).toContain("گزارش آزمایش آوالب");
  expect(html).toContain("سرعت و جهت");
  expect(html).toContain("/tools/speed");
  expect(html).toContain("sp=2");
  expect(html).toContain("<h2>سنجه‌ها</h2>");
  expect(html).toContain('src="data:image/png;base64,');
  expect(html).toContain('id="avalab-print"');
  expect(errors).toEqual([]);
});
