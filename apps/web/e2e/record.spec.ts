/**
 * F01 microphone-recording e2e (Wave-2 Plan 02 Task 3) on the backend-absent
 * static `vite preview` harness.
 *
 * Chromium under Playwright DOES expose a real microphone API surface, but
 * CI grants no devices and a permission prompt would hang the run — the
 * recorder's browser-facing states (permission, engines) are unit-pinned in
 * `src/lib/media.test.ts`. What e2e proves honestly here:
 *
 * 1. the proactive ABSENT path: with `navigator.mediaDevices` deleted the
 *    widget degrades to the translated hint, `aria-disabled` start button,
 *    and no focusable no-op affordance — console stays clean;
 * 2. with the API present (default), the widget renders the start button
 *    and never fires a permission request until the user clicks (no
 *    auto-pops on mount).
 */
import { type ConsoleMessage, expect, test } from "@playwright/test";

function watchForErrors(page: import("@playwright/test").Page): string[] {
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

test("Persian: no mediaDevices API → translated disabled hint, no focusable no-op button", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    // The e2e environment HAS a mediaDevices object; this simulation makes
    // the widget's degraded path testable deterministically.
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("input.upload.dropzone")).toBeVisible();
  await expect(page.getByTestId("input.record.absent")).toBeVisible();
  await expect(page.getByTestId("input.record.start")).toHaveCount(0);
  await expect(page.getByTestId("input.record.denied")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Persian: with the API present the start button renders and mount requests NO permission", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    // Stub the permission boundary with an instant, prompt-less rejection:
    // if some mount-time code auto-requested permission, the widget would
    // immediately render a denial/error state and the assertions below
    // fail; a CI permission prompt could never hang the run either way.
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: {
        getUserMedia: () =>
          Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })),
      },
      configurable: true,
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("input.upload.dropzone")).toBeVisible();
  await expect(page.getByTestId("input.record.start")).toBeVisible();
  await expect(page.getByTestId("input.record.absent")).toHaveCount(0);
  await expect(page.getByTestId("input.record.denied")).toHaveCount(0);
  await expect(page.getByTestId("input.record.error")).toHaveCount(0);
  expect(errors).toEqual([]);
});
