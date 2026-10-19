/**
 * Wave 0 smoke tests for the shell: i18n + RTL, language toggle,
 * offline health state and absence of raw error strings.
 *
 * The e2e environment intentionally runs WITHOUT the API: `vite preview`
 * serves only the static build, so the health widget must degrade to the
 * translated offline state. Every test collects console errors and page
 * errors and fails on any of them (no filtering).
 */
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

const PERSIAN_TITLE = "آوالب";
const ENGLISH_TITLE = "AvaLab";

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

test("loads in Persian RTL by default with no console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page).toHaveTitle(PERSIAN_TITLE);
  await expect(page.getByRole("heading", { name: PERSIAN_TITLE })).toBeVisible();
  await expect(page.getByText(/۶۰ دقیقه/)).toBeVisible();

  expect(errors).toEqual([]);
});

test("language toggle switches to English LTR and back to Persian RTL", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");

  await page.getByRole("button", { name: "تغییر زبان" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: ENGLISH_TITLE })).toBeVisible();

  await page.getByRole("button", { name: "Switch language" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.getByRole("heading", { name: PERSIAN_TITLE })).toBeVisible();

  expect(errors).toEqual([]);
});

test("persisted English preference is applied on boot with no console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page).toHaveTitle(ENGLISH_TITLE);
  await expect(page.getByRole("heading", { name: ENGLISH_TITLE })).toBeVisible();

  expect(errors).toEqual([]);
});

test("API offline state is translated and no raw error text reaches the page", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");

  // No API in the e2e environment: the health widget must show the
  // translated offline state with its detail line.
  await expect(page.getByText("سرور در دسترس نیست")).toBeVisible();
  await expect(page.getByText("ابزارهای سمت مرورگر بدون سرور هم کار می‌کنند")).toBeVisible();

  const bodyText = await page.locator("body").innerText();
  for (const raw of ["Fetch", "fetch", "TypeError", "NetworkError", "SyntaxError"]) {
    expect(bodyText).not.toContain(raw);
  }

  expect(errors).toEqual([]);
});
