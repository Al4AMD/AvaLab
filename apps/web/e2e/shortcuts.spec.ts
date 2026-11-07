/**
 * F18 global shortcuts + help e2e (Wave-6 Plan 03 Task 6): Space/arrows drive
 * the real dock, editable targets and the open dialog suppress shortcuts,
 * `?` and the header button open the accessible help panel, Escape closes it.
 * Runs in both locales on the backend-absent static preview harness.
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

async function focusMain(page: Page): Promise<void> {
  await page.locator("main").click({ position: { x: 2, y: 2 } });
}

async function loadSpeech(page: Page): Promise<void> {
  await expect(page.getByTestId("input.demo.card.speech")).toBeVisible();
  await page.getByTestId("input.demo.load.speech").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
  await expect(page.getByTestId("player.playToggle")).toBeEnabled();
}

test("Persian: keyboard play/seek, editable guard, help dialog", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const toggle = page.getByTestId("player.playToggle");
  const time = page.getByTestId("player.time");

  // No source: transport shortcuts do nothing, but help stays reachable.
  await expect(toggle).toBeDisabled();
  await focusMain(page);
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Shift+Slash");
  await expect(page.getByTestId("shortcuts.dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcuts.dialog")).toHaveCount(0);

  await loadSpeech(page);
  await focusMain(page);
  await expect(time).toContainText("00:00");

  // Arrow seek: ±5 s, Shift ±10 s.
  await page.keyboard.press("ArrowRight");
  await expect(time).toContainText("00:05");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(time).toContainText("00:15");
  await page.keyboard.press("ArrowLeft");
  await expect(time).toContainText("00:10");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(time).toContainText("00:00");

  // Space toggles the real transport.
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(time).toContainText("00:01", { timeout: 4_000 });
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // Editable target (header select): arrows must not seek the player.
  const beforeGuard = await time.textContent();
  await page.getByTestId("theme.select").focus();
  await page.keyboard.press("ArrowRight");
  expect(await time.textContent()).toBe(beforeGuard);

  // Focus inside the dialog also suppresses Space.
  await focusMain(page);
  await page.getByTestId("shortcuts.helpButton").click();
  await expect(page.getByTestId("shortcuts.dialog")).toBeVisible();
  const close = page.getByTestId("shortcuts.close");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcuts.dialog")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("English (LTR): shortcut help and transport work with translated copy", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  await focusMain(page);
  await page.keyboard.press("Shift+Slash");
  const dialog = page.getByTestId("shortcuts.dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Keyboard shortcuts");
  await expect(dialog).toContainText("Play / pause");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await loadSpeech(page);
  await focusMain(page);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("player.time")).toContainText("00:05");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("player.playToggle")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("player.playToggle")).toHaveAttribute("aria-pressed", "false");

  expect(errors).toEqual([]);
});
