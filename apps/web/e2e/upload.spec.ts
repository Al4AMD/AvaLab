/**
 * F01 upload-ingest-lane e2e (Wave-2 Plan 02 Task 1) on the backend-absent
 * static `vite preview` (same harness as smoke.spec.ts / tools.spec.ts).
 *
 * The API is STUBBED at the route layer so the real browser path runs end to
 * end: real FormData fetch, real openapi-fetch client, real Web Audio
 * `decodeAudioData`, real session store — only the HTTP answers are scripted.
 *
 * Console-error discipline (verified against `vite preview`): any fulfill
 * with a 4xx/5xx status makes Chromium log "Failed to load resource"
 * regardless of the response body, and `route.abort()` logs net::ERR as
 * well; a 200 fulfill is console-clean. So the success-path tests assert a
 * zero-error console, while the deliberate error-path test EXPECTS that one
 * browser network log and asserts the UI instead (it is not a bug — the
 * server really did answer 500).
 */
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

/** Schema of the backend's IngestResponse (apps/api ingest endpoint). */
type StubIngestResponse = {
  audio_id: string;
  channels: number;
  duration_s: number;
  sample_rate_hz: number;
  size_bytes: number;
};

/** IngestResponse served by the route stub (values describe tinyWav()). */
const STUB_INGEST: StubIngestResponse = {
  audio_id: "e2e-stub-audio",
  channels: 1,
  duration_s: 8 / 8000,
  sample_rate_hz: 8000,
  size_bytes: 60, // 44-byte header + 8 samples * 2 bytes
};

/** Minimal valid PCM WAV (mono, 8 kHz, 8 samples of ≈0.1 amplitude). */
function tinyWav(): Buffer {
  const sampleCount = 8;
  const sampleRateHz = 8000;
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRateHz, 24);
  buffer.writeUInt32LE(sampleRateHz * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(3277, 44 + index * bytesPerSample); // ≈ 0.1 full-scale
  }
  return buffer;
}

/** Scripted ingest endpoint: a 200 JSON IngestResponse (a successful lane). */
async function stubIngestSuccess(page: Page): Promise<void> {
  await page.route("**/api/v1/ingest", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STUB_INGEST),
    }),
  );
}

/** Scripted canonical-WAV endpoint: the tiny WAV bytes (a successful lane). */
async function stubWavDownload(page: Page): Promise<void> {
  const wav = tinyWav();
  await page.route("**/api/v1/audio/**", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: wav }),
  );
}

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

test("Persian (default): uploading through the ingest lane loads the session source", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await stubIngestSuccess(page);
  await stubWavDownload(page);

  await page.goto("/");
  await expect(page).toHaveURL(/\/tools\/waveform$/);
  await expect(page.getByTestId("input.upload.dropzone")).toBeVisible();

  await page.getByTestId("input.upload.input").setInputFiles({
    name: "clip.wav",
    mimeType: "audio/wav",
    buffer: tinyWav(),
  });

  // Success: the store holds a source, so the empty state yields to the stub
  // body (a later task paints the real waveform) and no failure readout shows.
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
  await expect(
    page.getByText("این ابزار در ادامهٔ همین موج پیاده\u200cسازی می\u200cشود."),
  ).toBeVisible();
  await expect(page.getByTestId("input.upload.error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Persian: a 500 ingest answer surfaces the translated lane error with its recovery hint", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  // Deliberate error path: a 500 fulfill logs one browser network error (see
  // the header note) — that is expected here, so only pageerror is checked.
  const pageErrors: string[] = [];
  page.on("pageerror", (error: Error) => {
    pageErrors.push(error.message);
  });
  await page.route("**/api/v1/ingest", (route) =>
    route.fulfill({ status: 500, contentType: "text/plain", body: "boom" }),
  );

  await page.goto("/");
  await page.getByTestId("input.upload.input").setInputFiles({
    name: "clip.wav",
    mimeType: "audio/wav",
    buffer: tinyWav(),
  });

  await expect(page.getByTestId("input.upload.error")).toBeVisible();
  await expect(page.getByTestId("input.upload.error")).toContainText(
    "سرور در دسترس نیست؛ فایل بارگذاری نشد.",
  );
  await expect(page.getByTestId("input.upload.error")).toContainText(
    "اتصال را بررسی کنید و دوباره تلاش کنید؛ ابزارهای سمت مرورگر بدون سرور هم کار می\u200cکنند.",
  );
  // The error never renders a raw i18n key or a raw developer string.
  await expect(page.getByTestId("input.upload.error")).not.toContainText("input.error");
  await expect(page.getByTestId("input.upload.error")).not.toContainText("boom");
  expect(pageErrors).toEqual([]);
  expect(
    errors.filter((entry) => !entry.startsWith("console.error: Failed to load resource")),
  ).toEqual([]);
});

test("English (persisted preference): the same upload path loads the source", async ({ page }) => {
  const errors = watchForErrors(page);
  await stubIngestSuccess(page);
  await stubWavDownload(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByTestId("input.upload.input").setInputFiles({
    name: "clip.wav",
    mimeType: "audio/wav",
    buffer: tinyWav(),
  });

  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
  await expect(page.getByText("This tool lands later this wave.")).toBeVisible();
  await expect(page.getByTestId("input.upload.error")).toHaveCount(0);
  expect(errors).toEqual([]);
});
