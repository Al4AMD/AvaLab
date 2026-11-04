/**
 * Wave-2 checks for the tool routes (Plan 01 Task 1, adapted in Plan 02
 * Task 1 and Wave-3 Plans 02–03): root redirect, sidebar navigation,
 * per-tool title, both locales, zero console errors. Same backend-absent static-preview harness
 * as smoke.spec.ts. The waveform overview probe readout now requires a
 * LOADED source (the Plan-01 auto-loaded demo probe was retired for real
 * sources); until a source exists the waveform page shows the load-audio
 * empty state instead.
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
    path: "/tools/filters",
    url: /\/tools\/filters$/,
    label: /(طراحی فیلتر|Filter design)/,
    title: /(آزمایشگاه طراحی فیلتر|Filter design)/,
  },
  {
    path: "/tools/generator",
    url: /\/tools\/generator$/,
    label: /(مولد سیگنال|Generator)/,
    title: /(مولد سیگنال|Signal Generator)/,
  },
  {
    path: "/tools/speed",
    url: /\/tools\/speed$/,
    label: /(سرعت|Speed)/,
    title: /(سرعت|Speed)/,
  },
  {
    path: "/tools/sampling",
    url: /\/tools\/sampling$/,
    label: /(نمونه‌برداری|Sampling)/,
    title: /(نمونه‌برداری|Sampling)/,
  },
  {
    path: "/tools/extent",
    url: /\/tools\/extent$/,
    label: /(گستردگی|Signal extent)/,
    title: /(گستردگی|Signal extent)/,
  },
  {
    path: "/tools/reverb",
    url: /\/tools\/reverb$/,
    label: /(پژواک|Reverb)/,
    title: /(پژواک|Reverb)/,
  },
  {
    path: "/tools/spectrum-edit",
    url: /\/tools\/spectrum-edit$/,
    label: /(ویرایشگر طیف|Spectrum editor)/,
    title: /(ویرایشگر طیف|Spectrum editor)/,
  },
  {
    path: "/tools/codec-lab",
    url: /\/tools\/codec-lab$/,
    label: /(فشرده‌سازی|Compression lab)/,
    title: /(فشرده‌سازی|Compression lab)/,
  },
  {
    path: "/tools/metrics",
    url: /\/tools\/metrics$/,
    label: /(سنجه‌های کیفیت|Quality metrics)/,
    title: /(سنجه‌های کیفیت|Quality metrics)/,
  },
  {
    path: "/tools/ai",
    url: /\/tools\/ai$/,
    label: /(هوش مصنوعی|AI lab)/,
    title: /(هوش مصنوعی|AI lab)/,
  },
  {
    path: "/experiments",
    url: /\/experiments$/,
    label: /(آزمایش‌های هدایت‌شده|Guided experiments)/,
    title: /(آزمایش‌های هدایت‌شده|Guided experiments)/,
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
 * Wave-2 Plan 02 Task 1: without a session source the /tools/waveform page
 * shows the SOLE load affordances (file button + drop target) instead of the
 * waveformOverview readout (that readout belongs to a loaded source; the
 * Plan-01 auto-load was removed with this task).
 */
async function expectWaveformEmptyState(page: Page): Promise<void> {
  await expect(page.getByTestId("input.upload.dropzone")).toBeVisible();
  await expect(page.getByTestId("input.upload.button")).toBeVisible();
}

/**
 * Wave-5 Plan 01 Task 6: the AI shell must stay honest without a backend.
 * Loading a demo proves the run controls render, and the backend-absent
 * model state keeps the run button disabled instead of firing a request.
 */
async function expectAiShellBackendAbsent(page: Page): Promise<void> {
  // The implemented denoise tab owns its own no-source state (no generic
  // placeholder); loading its demo proves the run stays disabled offline.
  await expect(page.getByTestId("ai.placeholder")).toHaveCount(0);
  await expect(page.getByTestId("ai.tab.denoise")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("ai.denoise.loadDemo").click();
  await expect(page.getByTestId("ai.run")).toBeDisabled();
}

test("Persian (default): / redirects to the waveform tool and the sidebar reaches every tool route", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/tools\/waveform$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // DSP worker RPC plumbing (Plan 01 Task 2): the stub ping proves the built
  // module worker answers through the rpc layer under `vite preview`.
  await expect(page.getByTestId("waveform.stub.ping")).toHaveText("4");
  await expectWaveformEmptyState(page);

  for (const tool of TOOLS) {
    await page.getByRole("link", { name: tool.label }).click();
    await expect(page).toHaveURL(tool.url);
    await expect(page.getByRole("heading", { name: tool.title })).toBeVisible();
    if (tool.path === "/tools/ai") {
      await expectAiShellBackendAbsent(page);
    }
  }

  expect(errors).toEqual([]);
});

test("English (persisted preference): the same tool routes with zero console errors", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("waveform.stub.ping")).toHaveText("4");
  await expectWaveformEmptyState(page);

  for (const tool of TOOLS) {
    await page.getByRole("link", { name: tool.label }).click();
    await expect(page).toHaveURL(tool.url);
    await expect(page.getByRole("heading", { name: tool.title })).toBeVisible();
    if (tool.path === "/tools/ai") {
      await expectAiShellBackendAbsent(page);
    }
  }

  expect(errors).toEqual([]);
});
