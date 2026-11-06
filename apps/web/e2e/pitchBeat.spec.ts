/**
 * Pitch/beat tab e2e (Wave-6 Plan 04 Task 5) on the backend-absent preview.
 *
 * The analysis routes are scripted, but the browser path is real: demo WAV
 * decode, excerpt upload, SSE job stream and result parsing. Pitch and beat
 * share one tab, so the mode buttons must keep `?task=` in sync.
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

async function stubAnalysisBackend(
  page: Page,
  task: "pitch" | "beat",
  result: string,
): Promise<void> {
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
      body: JSON.stringify({ ml_enabled: true, models: [] }),
    }),
  );
  await page.route("**/api/v1/ingest", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        audio_id: "stub-input",
        channels: 1,
        duration_s: 1,
        sample_rate_hz: 48_000,
        size_bytes: wav.length,
      }),
    }),
  );
  await page.route("**/api/v1/audio/**", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: wav }),
  );
  await page.route(`**/api/v1/ml/${task}`, (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ job_id: "stub-analysis" }),
    }),
  );
  await page.route("**/api/v1/jobs/stub-analysis/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"event":"progress","progress":0.5,"result":null,"code":null}\n\n' +
        `data: {"event":"done","progress":null,"result":${result},"code":null}\n\n`,
    }),
  );
}

async function loadSource(page: Page): Promise<void> {
  await page.getByTestId("input.upload.input").setInputFiles({
    name: "clip.wav",
    mimeType: "audio/wav",
    buffer: tinyWav(),
  });
  await expect(page.getByTestId("ai.run")).toBeEnabled();
}

test("pitch: upload → analysis → F0 canvas and stats, then switch to beat", async ({ page }) => {
  const errors = watchForErrors(page);
  await stubAnalysisBackend(
    page,
    "pitch",
    JSON.stringify({
      kind: "analysis",
      analysis: {
        analysis_kind: "pitch",
        times_s: [0, 0.5, 1],
        f0_hz: [220, 222.5, null],
        voiced_probability: [0.9, 0.8, 0.1],
      },
      stats: { median_f0_hz: 221.25, voiced_fraction: 0.6666666666666666 },
    }),
  );

  await page.goto("/tools/ai?task=pitch");
  await expect(page.getByTestId("ai.pitchBeat.mode.pitch")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ai.models.banner")).toHaveCount(0);
  await loadSource(page);

  await page.getByTestId("ai.run").click();
  await expect(page.getByTestId("ai.status")).toHaveText("پایان یافت.");
  await expect(page.getByTestId("ai.pitchBeat.medianF0")).toContainText("221.25");
  await expect(page.getByTestId("ai.pitchBeat.voicedFraction")).toContainText("66.7");
  await expect(page.getByTestId("ai.pitchBeat.pitchCanvas")).toBeVisible();

  await page.getByTestId("ai.pitchBeat.mode.beat").click();
  await expect(page).toHaveURL(/task=beat/);
  await expect(page.getByTestId("ai.pitchBeat.mode.beat")).toHaveAttribute("aria-pressed", "true");

  expect(errors).toEqual([]);
});

test("beat: upload → beat mode → tempo and sorted beat times", async ({ page }) => {
  const errors = watchForErrors(page);
  await stubAnalysisBackend(
    page,
    "beat",
    JSON.stringify({
      kind: "analysis",
      analysis: {
        analysis_kind: "beat",
        tempo_bpm: 120,
        beat_times_s: [0, 0.5, 1, 1.5],
      },
      stats: {},
    }),
  );

  await page.goto("/tools/ai?task=pitch");
  await loadSource(page);
  await page.getByTestId("ai.pitchBeat.mode.beat").click();
  await expect(page).toHaveURL(/task=beat/);

  await page.getByTestId("ai.run").click();
  await expect(page.getByTestId("ai.pitchBeat.tempo")).toContainText("120.00");
  await expect(page.getByTestId("ai.pitchBeat.beatCount")).toHaveText("4");
  await expect(page.getByTestId("ai.pitchBeat.beatList")).toContainText("0.500");
  await expect(page.getByTestId("ai.pitchBeat.beatList")).toContainText("1.500");

  expect(errors).toEqual([]);
});
