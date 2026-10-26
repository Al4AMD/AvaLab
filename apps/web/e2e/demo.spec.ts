/**
 * Demo-clip e2e (F01, Wave-2 Plan 02 Task 2) on the backend-absent static
 * `vite preview` harness (same as smoke/upload): clicking a demo card loads
 * the bundled clip through the REAL offline lane — fetch (real static asset,
 * no route stub), real Web Audio `decodeAudioData`, real session store — and
 * the waveform stub's overview readout then renders the REAL sample count
 * the worker derived from the transferred source bytes.
 *
 * The exact count is DEVICE-DEPENDENT on purpose (documented offline-lane
 * browser-codec variance, spec §6): `decodeAudioData` resamples to the
 * AudioContext's hardware rate, so the 48 kHz/5 s clip yields 240 000
 * samples at a 48 kHz context but ≈ 220 500 at a 44.1 kHz one. The assertion
 * is therefore "a real, non-trivial count" (≥ 1000), never a magic number.
 *
 * The >300 s store-guard path is NOT repeated here: it is client-side store
 * logic, covered by the offline loader unit tests (a 5-minute WAV fixture in
 * the browser would be heavy; the unit pin is the same guard).
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

test("Persian (default): a demo card loads through the offline lane and the overview readout shows the real sample count", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/tools\/waveform$/);
  await expect(page.getByTestId("input.demo.card.pinkNoise")).toBeVisible();

  // HealthStatus still renders after the store-flag swap (backend-absent
  // harness: the pill settles on the translated offline state).
  await expect(page.getByRole("status")).toContainText("سرور در دسترس نیست");

  await page.getByTestId("input.demo.load.pinkNoise").click();

  // The store now holds a source: the empty state yields to the stub body
  // and the overview readout renders the worker-derived sample count.
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
  const overviewText = await page.getByTestId("waveform.stub.overview").textContent();
  expect(overviewText).toMatch(/^[0-9]+$/); // a plain integer readout (Latin digits, LTR)
  expect(Number(overviewText)).toBeGreaterThanOrEqual(1000); // a real count, not the 32-bucket stub
  expect(errors).toEqual([]);
});

test("English (persisted preference): the same demo path with zero console errors", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByTestId("input.demo.load.clicks").click();

  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
  const overviewText = await page.getByTestId("waveform.stub.overview").textContent();
  expect(Number(overviewText)).toBeGreaterThanOrEqual(1000);
  expect(errors).toEqual([]);
});
