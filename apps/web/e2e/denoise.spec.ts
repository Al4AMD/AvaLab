/**
 * Denoise tab e2e (Wave-5 Plan 02 Task 2) on the backend-absent preview.
 *
 * The ML routes are scripted, but the browser path is real: demo clip decode,
 * excerpt upload, SSE job stream, result WAV fetch/decode, and store install.
 * A 200-only stub keeps the console clean.
 */
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

function tinyWav(): Buffer {
  const sampleCount = 8;
  const sampleRateHz = 8000;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRateHz, 24);
  buffer.writeUInt32LE(sampleRateHz * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(3277, 44 + index * 2);
  }
  return buffer;
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

async function stubDenoiseBackend(page: Page): Promise<void> {
  const wav = tinyWav();
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", ffmpeg: false, version: "stub" }),
    }),
  );
  await page.route("**/api/v1/models", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          {
            task: "denoise",
            model_id: "Ceva-IP/DPDFNet",
            revision: "stub",
            license: "Apache-2.0",
            size_bytes: 8_000_000,
            state: "available",
          },
        ],
      }),
    }),
  );
  await page.route("**/api/v1/ingest", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        audio_id: "stub-input",
        channels: 1,
        duration_s: 19.6,
        sample_rate_hz: 48_000,
        size_bytes: wav.length,
      }),
    }),
  );
  await page.route("**/api/v1/ml/denoise", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ job_id: "stub-job" }),
    }),
  );
  await page.route("**/api/v1/jobs/stub-job/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"event":"progress","progress":0.5,"result":null,"code":null}\n\n' +
        'data: {"event":"done","progress":null,"result":{"kind":"audio","result_audio_id":"stub-result","sample_rate_hz":48000,"duration_s":19.6,"stats":{"model_id":"Ceva-IP/DPDFNet","duration_s":19.6,"rms_in_db":-18.2,"rms_out_db":-24.8}},"code":null}\n\n',
    }),
  );
  await page.route("**/api/v1/audio/**", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: wav }),
  );
}

test("denoise: noisy demo → job → denoised lane with RMS and A/B", async ({ page }) => {
  const errors = watchForErrors(page);
  await stubDenoiseBackend(page);

  await page.goto("/tools/ai");
  await expect(page.getByTestId("ai.denoise.loadDemo")).toBeVisible();
  await expect(page.getByTestId("ai.run")).toHaveCount(0);

  await page.getByTestId("ai.denoise.loadDemo").click();
  await expect(page.getByTestId("ai.run")).toBeEnabled();

  await page.getByTestId("ai.run").click();
  await expect(page.getByTestId("ai.denoise.ab.denoised")).toBeEnabled();
  await expect(page.getByTestId("ai.denoise.rms")).toContainText("-18.2");
  await expect(page.getByTestId("ai.denoise.rms")).toContainText("-24.8");
  await expect(page.getByTestId("ai.denoise.wave.denoised")).toBeVisible();

  await page.getByTestId("ai.denoise.ab.original").click();
  await expect(page.getByTestId("ai.denoise.ab.original")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ai.denoise.ab.denoised").click();
  await expect(page.getByTestId("ai.denoise.ab.denoised")).toHaveAttribute("aria-pressed", "true");

  expect(errors).toEqual([]);
});
