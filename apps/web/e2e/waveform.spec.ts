/**
 * Waveform canvas e2e (F02, Wave 2 Plan 03 Task 2) on the backend-absent
 * static-preview harness: a demo clip loads through the REAL offline lane
 * (static WAV → browser decode → session store), the view derives peak
 * buckets through the REAL worker, and both canvases paint real pixels.
 *
 * Pixel assertion: read the canvas backing store with `getImageData` and sum
 * alpha; a blank canvas has alpha 0, a painted envelope/center line does not.
 * The assertion polls because the worker result and the component's rAF paint
 * land after the clip load resolves. Sample-space readouts only — never
 * left/right (the plot is dir="ltr" in both locales).
 */
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

const OVERVIEW = "waveform.overview.canvas";
const DETAIL = "waveform.detail.canvas";
const SELECTION = /^[^0-9]*[0-9]+\.[0-9]+ (?:ms|s)[^0-9]+[0-9]+\.[0-9]+ (?:ms|s)$/;

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

async function expectCanvasPainted(page: Page, testId: string): Promise<void> {
  const canvas = page.getByTestId(testId);
  await expect(canvas).toBeVisible();
  await expect
    .poll(
      async () =>
        canvas.evaluate((element) => {
          const node = element as HTMLCanvasElement;
          if (node.width === 0 || node.height === 0) {
            return 0;
          }
          const context = node.getContext("2d");
          if (context === null) {
            return -1;
          }
          const pixels = context.getImageData(0, 0, node.width, node.height).data;
          let alphaSum = 0;
          for (let index = 3; index < pixels.length; index += 4) {
            alphaSum += pixels[index] ?? 0;
          }
          return alphaSum;
        }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
}

test("Persian (default): a demo clip paints both canvases and the hover readout reports a time", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/tools\/waveform$/);
  await expect(page.getByTestId("input.demo.load.pinkNoise")).toBeVisible();

  const clickedAt = Date.now();
  await page.getByTestId("input.demo.load.pinkNoise").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
  await expectCanvasPainted(page, OVERVIEW);
  await expectCanvasPainted(page, DETAIL);
  test.info().annotations.push({
    type: "load-to-first-paint-ms",
    description: String(Date.now() - clickedAt),
  });

  // The hover readout starts empty, then reports a time in seconds.
  await expect(page.getByTestId("waveform.hover.time")).toHaveCount(0);
  await expect(page.getByTestId("waveform.scale")).toBeVisible();
  await page.getByTestId(DETAIL).hover({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("waveform.hover.time")).toHaveText(/^[0-9]+\.[0-9]+ (?:ms|s)$/);
  await expect(page.getByTestId("waveform.hover.value")).toContainText(/-?[0-9]+\.[0-9]{4}$/);

  expect(errors).toEqual([]);
});

test("English (persisted preference): both canvases paint with zero console errors", async ({
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

  for (const testId of [OVERVIEW, DETAIL]) {
    await expectCanvasPainted(page, testId);
  }
  expect(errors).toEqual([]);
});

test("Persian: drag selection, zoom controls, and the keyboard surface all work", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await page.getByTestId("input.demo.load.pinkNoise").click();
  await expectCanvasPainted(page, DETAIL);

  const selectionValue = page.getByTestId("waveform.selection.value");
  await expect(selectionValue).toHaveText(SELECTION);
  const initialSelection = (await selectionValue.textContent()) ?? "";

  const detail = page.getByTestId(DETAIL);
  const box = await detail.boundingBox();
  if (box === null) {
    throw new Error("detail canvas has no box");
  }
  // Drag from 20 % to 70 %: the readout must CHANGE from the seeded range.
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(selectionValue).not.toHaveText(initialSelection);
  await expect(selectionValue).toHaveText(SELECTION);
  const draggedSelection = (await selectionValue.textContent()) ?? "";

  // Reversed (right-to-left) drag: sample-space ordering keeps the range
  // ascending; the fa document direction must not invert it.
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(selectionValue).not.toHaveText(draggedSelection);
  await expect(selectionValue).toHaveText(SELECTION);
  const reversedSelection = (await selectionValue.textContent()) ?? "";

  const rangeValue = page.getByTestId("waveform.range.value");
  const before = (await rangeValue.textContent()) ?? "";
  await page.getByTestId("waveform.zoom.in").click();
  await expect.poll(async () => (await rangeValue.textContent()) ?? "").not.toBe(before);
  await page.getByTestId("waveform.zoom.out").click();
  await expect.poll(async () => (await rangeValue.textContent()) ?? "").toBe(before);

  await page.getByRole("slider").focus();
  const beforeKeyboard = (await rangeValue.textContent()) ?? "";
  await page.keyboard.press("]");
  await expect.poll(async () => (await rangeValue.textContent()) ?? "").not.toBe(beforeKeyboard);
  await page.keyboard.press("[");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(selectionValue).not.toHaveText(reversedSelection);
  await expect(selectionValue).toHaveText(SELECTION);

  await page.getByTestId("waveform.zoom.reset").click();
  await expect.poll(async () => (await rangeValue.textContent()) ?? "").toBe(before);

  expect(errors).toEqual([]);
});
