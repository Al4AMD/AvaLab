/**
 * F16 guided-experiment e2e (Wave-6 Plan 04 Task 7): every experiment card
 * renders with its full step list, every distinct step link reaches its lab,
 * completion persists across a reload, and both locales stay console-clean.
 */
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

import {
  EXPERIMENT_CATEGORIES,
  EXPERIMENTS,
  EXPERIMENTS_PROGRESS_STORAGE_KEY,
  type ExperimentLink,
} from "../src/features/education/experiments";

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

type LinkTarget = {
  readonly experimentId: string;
  readonly linkIndex: number;
  readonly link: ExperimentLink;
};

function stepLinks(experimentId: string): LinkTarget[] {
  const experiment = EXPERIMENTS.find((candidate) => candidate.id === experimentId);
  if (experiment === undefined) {
    throw new Error(`unknown experiment ${experimentId}`);
  }
  let linkIndex = 0;
  return experiment.steps.flatMap((step) => {
    if (step.link === undefined) {
      return [];
    }
    const target = { experimentId, linkIndex, link: step.link };
    linkIndex += 1;
    return [target];
  });
}

function hrefFor(link: ExperimentLink): string {
  return link.search === "" ? link.path : `${link.path}?${link.search}`;
}

test("Persian: every experiment, step link, and completion reload works", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchForErrors(page);
  await page.goto("/experiments");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "آزمایش‌های هدایت‌شده" })).toBeVisible();

  for (const category of EXPERIMENT_CATEGORIES) {
    await expect(page.getByTestId(`experiments.category.${category}`)).toBeVisible();
  }

  const uniqueLinks = new Map<string, { link: ExperimentLink; target: LinkTarget }>();
  for (const experiment of EXPERIMENTS) {
    const card = page.getByTestId(`experiments.card.${experiment.id}`);
    await expect(card).toBeVisible();
    const links = stepLinks(experiment.id);
    await expect(card.getByRole("link")).toHaveCount(links.length);
    for (const target of links) {
      const href = hrefFor(target.link);
      await expect(card.getByRole("link").nth(target.linkIndex)).toHaveAttribute("href", href);
      if (!uniqueLinks.has(href)) {
        uniqueLinks.set(href, { link: target.link, target });
      }
    }
  }

  const first = EXPERIMENTS[0];
  if (first === undefined) {
    throw new Error("no experiments");
  }
  const checkbox = page.getByTestId(`experiments.progress.${first.id}`);
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    EXPERIMENTS_PROGRESS_STORAGE_KEY,
  );
  expect(stored === null ? [] : JSON.parse(stored)).toContain(first.id);
  await page.reload();
  await expect(page.getByTestId(`experiments.progress.${first.id}`)).toBeChecked();

  for (const { link, target } of uniqueLinks.values()) {
    const card = page.getByTestId(`experiments.card.${target.experimentId}`);
    await Promise.all([
      page.waitForURL((url) => url.pathname === link.path),
      card.getByRole("link").nth(target.linkIndex).click(),
    ]);
    const current = new URL(page.url());
    for (const [key, value] of new URLSearchParams(link.search)) {
      expect(current.searchParams.get(key), `${link.path}?${link.search} ${key}`).toBe(value);
    }
    await page.goBack();
    await expect(card).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("English: experiments keep categories, cards, and progress labels", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/experiments");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Guided experiments" })).toBeVisible();
  await expect(page.getByTestId("experiments.category.signals")).toContainText("Signals & Systems");
  await expect(page.getByTestId("experiments.category.multimedia")).toContainText("Multimedia");
  await expect(page.getByTestId("experiments.category.ai")).toContainText("AI");
  await expect(page.getByTestId("experiments.category.labs")).toContainText("Labs");

  for (const experiment of EXPERIMENTS) {
    await expect(page.getByTestId(`experiments.card.${experiment.id}`)).toBeVisible();
  }
  const first = EXPERIMENTS[0];
  if (first === undefined) {
    throw new Error("no experiments");
  }
  await expect(page.getByTestId(`experiments.progress.${first.id}`)).toBeVisible();
  await expect(page.getByTestId(`experiments.card.${first.id}`)).toContainText("Completed");

  expect(errors).toEqual([]);
});
