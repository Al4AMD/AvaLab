/**
 * F18 theme e2e (Wave-6 Plan 03 Task 5): the header select applies
 * `data-theme`, persists the explicit choice across reload, and returns to
 * system mode. Both locales, zero console errors.
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

test("Persian: light theme persists across reload and system mode is restored", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const select = page.getByTestId("theme.select");
  await expect(select).toHaveValue("system");

  await select.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await select.selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(select).toHaveValue("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await select.selectOption("system");
  await expect(select).toHaveValue("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^(dark|light)$/);

  expect(errors).toEqual([]);
});

test("English (LTR): the same theme cycle is console-clean", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  const select = page.getByTestId("theme.select");
  await select.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await select.selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(select).toHaveValue("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await select.selectOption("system");
  await expect(select).toHaveValue("system");

  expect(errors).toEqual([]);
});
