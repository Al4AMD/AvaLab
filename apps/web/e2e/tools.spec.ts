/**
 * Wave 2 navigation smoke for the four tool routes (Plan 01 Task 1):
 * root redirect, sidebar navigation, per-tool stub title, both locales,
 * zero console errors. Same offline static-preview harness as smoke.spec.ts.
 */
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

type ToolSpec = {
  path: string;
  url: RegExp;
  label: RegExp;
  title: RegExp;
};

const TOOLS: ToolSpec[] = [
  {
    path: "/tools/waveform",
    url: /\/tools\/waveform$/,
    // fa/فارسی «شکل‌موج (Waveform)» / en "Waveform" — nav label and page title differ; match loosely.
    label: /(شکل‌موج|Waveform)/,
    title: /(نمایشگر شکل‌موج|Waveform)/,
  },
  {
    path: "/tools/spectrogram",
    url: /\/tools\/spectrogram$/,
    label: /(طیف‌نگاره|Spectrogram)/,
    title: /(نمایشگر طیف‌نگاره|Spectrogram)/,
  },
  {
    path: "/tools/fftview",
    url: /\/tools\/fftview$/,
    label: /(نمای فوریه|FFT View)/,
    title: /(دامنه و فاز|FFT View)/,
  },
  {
    path: "/tools/generator",
    url: /\/tools\/generator$/,
    label: /(مولد سیگنال|Generator)/,
    title: /(مولد سیگنال|Signal Generator)/,
  },
];

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

/**
 * Plan 01 Task 4: the waveform stub also proves the waveformOverview op
 * end-to-end (store → worker → cache). The readout is the returned bucket
 * count; the value depends on the probe and the canvas arrives in Plan 03,
 * so assert it exists and holds a bucket count ≥ 2 in either locale.
 */
async function expectOverviewReadout(page: Page): Promise<void> {
  const overviewText = await page.getByTestId("waveform.stub.overview").textContent();
  expect(Number(overviewText)).toBeGreaterThanOrEqual(2);
}

test("Persian (default): / redirects to the waveform tool and the sidebar reaches all four routes", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/tools\/waveform$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // DSP worker RPC plumbing (Plan 01 Task 2): the stub ping proves the built
  // module worker answers through the rpc layer under `vite preview`.
  await expect(page.getByTestId("waveform.stub.ping")).toHaveText("4");
  await expectOverviewReadout(page);

  for (const tool of TOOLS) {
    await page.getByRole("link", { name: tool.label }).click();
    await expect(page).toHaveURL(tool.url);
    await expect(page.getByRole("heading", { name: tool.title })).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("English (persisted preference): the same four routes with zero console errors", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("waveform.stub.ping")).toHaveText("4");
  await expectOverviewReadout(page);

  for (const tool of TOOLS) {
    await page.getByRole("link", { name: tool.label }).click();
    await expect(page).toHaveURL(tool.url);
    await expect(page.getByRole("heading", { name: tool.title })).toBeVisible();
  }

  expect(errors).toEqual([]);
});
