/**
 * F15 pipeline e2e (Wave-6 Plan 02 Task 6): a real graph is built through the
 * palette and React Flow handles, run in the worker, persisted in the URL, and
 * a self-connection is refused with the translated cycle message. Both
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

async function loadDemo(page: Page): Promise<void> {
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
}

async function connect(page: Page, sourceNodeId: string, targetNodeId: string): Promise<void> {
  const source = page.locator(
    `.react-flow__handle[data-nodeid="${sourceNodeId}"][data-handlepos="right"]`,
  );
  const target = page.locator(
    `.react-flow__handle[data-nodeid="${targetNodeId}"][data-handlepos="left"]`,
  );
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) {
    throw new Error(`missing handle ${sourceNodeId} -> ${targetNodeId}`);
  }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function buildFilterGraph(page: Page): Promise<void> {
  await page.getByTestId("pipeline.palette.filter").click();
  await expect(page.getByTestId("pipeline.node.filter-1")).toBeVisible();
  await page.locator(".react-flow__controls-fitview").click();

  const defaultEdge = page.getByTestId("rf__edge-edge-1");
  await defaultEdge.click({ force: true });
  await page.getByTestId("pipeline.deleteEdge").click();

  await connect(page, "source-1", "filter-1");
  await connect(page, "filter-1", "output-1");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.getByTestId("pipeline.validationError")).toHaveCount(0);
}

async function runPipeline(page: Page): Promise<void> {
  await page.getByTestId("pipeline.run").click();
  await expect(page.getByTestId("pipeline.stage.filter-1")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("pipeline.stage.output-1")).toBeVisible();
  await expect(page.getByTestId("pipeline.runError")).toHaveCount(0);
}

test("Persian: graph edits persist, the worker runs, and a cycle is rejected", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/pipeline");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("pipeline.view")).toBeVisible();
  await loadDemo(page);

  await buildFilterGraph(page);
  await expect(page).toHaveURL(/pg=/);
  await runPipeline(page);

  await page.reload();
  await expect(page.getByTestId("pipeline.node.filter-1")).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await loadDemo(page);

  await connect(page, "filter-1", "filter-1");
  await expect(page.getByTestId("pipeline.actionError")).toContainText("حلقه");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.getByTestId("pipeline.run")).toBeEnabled();

  expect(errors).toEqual([]);
});

test("English (LTR): the pipeline runs from the palette-built graph", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/pipeline");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("theory.panel")).toContainText("Pipeline theory");
  await loadDemo(page);

  await buildFilterGraph(page);
  await runPipeline(page);

  expect(errors).toEqual([]);
});
