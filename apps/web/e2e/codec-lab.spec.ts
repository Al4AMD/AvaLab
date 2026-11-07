/**
 * F04 browser codec lab e2e (Wave-4 Plan 01 Task 4): the demo chirp drives the
 * real worker op, RLE proves bit-exactness, MDCT exposes sparsity, the
 * histogram paints, the decoded result installs into the processed A/B lane,
 * and "Use selection" writes the waveform selection into the URL. Both
 * locales, zero console errors.
 */
import { readFile } from "node:fs/promises";

import { type ConsoleMessage, expect, type Locator, type Page, test } from "@playwright/test";

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

async function expectCanvasPainted(canvas: Locator): Promise<void> {
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () =>
      canvas.evaluate((element) => {
        const canvasElement = element as HTMLCanvasElement;
        const ctx = canvasElement.getContext("2d");
        if (ctx === null) {
          return false;
        }
        const pixels = ctx.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
        return pixels.some((value) => value !== 0);
      }),
    )
    .toBe(true);
}

async function loadChirp(page: Page): Promise<void> {
  await page.getByTestId("input.demo.load.chirp").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
}

/** Minimal stereo PCM WAV (48 kHz, 16-bit, 0.1 s) for the stubbed backend. */
function stereoWav(frameCount = 4800): Buffer {
  const sampleRateHz = 48_000;
  const bytesPerFrame = 4;
  const dataSize = frameCount * bytesPerFrame;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRateHz, 24);
  buffer.writeUInt32LE(sampleRateHz * bytesPerFrame, 28);
  buffer.writeUInt16LE(bytesPerFrame, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < frameCount; index += 1) {
    buffer.writeInt16LE(1638, 44 + index * bytesPerFrame);
    buffer.writeInt16LE(3277, 46 + index * bytesPerFrame);
  }
  return buffer;
}

/** Health, ingest, encode, and decoded-WAV stubs for the stereo real-codec lane. */
async function stubStereoBackend(page: Page): Promise<void> {
  const wav = stereoWav();
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        ffmpeg: true,
        version: "stub",
        codecs: ["wav", "flac", "mp3"],
      }),
    }),
  );
  await page.route("**/api/v1/ingest", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        audio_id: "e2e-stereo-source",
        channels: 2,
        duration_s: 5,
        sample_rate_hz: 48_000,
        size_bytes: 960_000,
      }),
    }),
  );
  await page.route("**/api/v1/codec/encode", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result_audio_id: "e2e-stereo-result",
        size_bytes: 19_244,
        bitrate_kbps: 1539,
        encode_ms: 12,
        codec_delay_samples: 0,
        reference_start_sample: 0,
        aligned_sample_count: 4800,
        duration_s: 0.1,
        sample_rate_hz: 48_000,
        channels: 2,
        bit_exact: false,
        lossless: true,
      }),
    }),
  );
  await page.route("**/api/v1/audio/**", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: wav }),
  );
}

test("Persian: a mono toy-codec result from a stereo source is labelled", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await page.getByTestId("input.demo.load.stereo").click();
  await expect(page.getByTestId("player.channels")).toHaveText("2 کانال");

  await page.locator('a[href="/tools/codec-lab"]').click();
  await expect(page).toHaveURL(/\/tools\/codec-lab$/);
  await page.getByTestId("codecLab.encode").click();
  await expect(page.getByTestId("codecLab.stat.bitExact")).toHaveText(/✓/, { timeout: 20_000 });
  await page.getByTestId("codecLab.play").click();

  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player.channels")).toHaveText("1 کانال");
  await expect(page.getByTestId("player.result.mono")).toHaveText("نتیجهٔ مونو");
  await expect(page.getByTestId("player.analysis")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Persian (default): RLE is bit-exact, MDCT is lossy, and the result plays", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/codec-lab");
  await loadChirp(page);

  await page.getByTestId("codecLab.encode").click();
  await expect(page.getByTestId("codecLab.stat.bitExact")).toHaveText(/✓/, { timeout: 20_000 });
  await expect(page.getByTestId("codecLab.stat.ratio")).toBeVisible();
  await expect(page.getByTestId("codecLab.stat.snr")).toHaveText(/dB/);
  await expectCanvasPainted(page.getByTestId("codecLab.histogram"));

  await page.getByTestId("codecLab.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("codecLab.control.codec").selectOption("mdct");
  await expect(page).toHaveURL(/c=mdct/);
  await page.getByTestId("codecLab.control.bitrate").selectOption("64");
  await expect(page).toHaveURL(/mbr=64/);
  await page.getByTestId("codecLab.encode").click();
  await expect(page.getByTestId("codecLab.stat.bitExact")).not.toHaveText(/✓/, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("codecLab.mdct.sparsity")).toHaveText(/%/);
  await expect(page.getByTestId("codecLab.stale")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("Persian: Use selection copies the waveform selection into from/to", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/waveform");
  await page.getByTestId("input.demo.load.pinkNoise").click();
  const detail = page.getByTestId("waveform.detail.canvas");
  await expect(detail).toBeVisible({ timeout: 15_000 });
  const box = await detail.boundingBox();
  if (box === null) {
    throw new Error("detail canvas has no box");
  }
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("waveform.selection.value")).toHaveText(/[0-9]/);

  await page.locator('a[href="/tools/codec-lab"]').click();
  await expect(page).toHaveURL(/\/tools\/codec-lab$/);
  await expect(page.getByTestId("codecLab.control.codec")).toBeVisible();
  await page.getByTestId("codecLab.useSelection").click();
  await expect(page).toHaveURL(/[?&]from=[0-9]+/);
  await expect(page).toHaveURL(/[?&]to=[0-9]+/);
  await expect(page.getByTestId("codecLab.range")).toHaveText(/[0-9]/);

  expect(errors).toEqual([]);
});

test("Persian: real codecs are disabled with an offline hint when no backend is served", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/codec-lab");
  await loadChirp(page);

  await expect(page.getByTestId("codecLab.real")).toBeVisible();
  await expect(page.getByTestId("codecLab.real.offline")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("codecLab.real.encode")).toBeDisabled();
  await expect(page.getByTestId("codecLab.real.codec")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Persian: the comparison batch fills the table and rate-distortion chart", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/tools/codec-lab");
  await loadChirp(page);
  await expect(page.getByTestId("codecLab.comparison.empty")).toBeVisible();

  await page.getByTestId("codecLab.comparison.run").click();
  await expect(page.getByTestId("codecLab.comparison.progress")).toHaveText("8/8", {
    timeout: 60_000,
  });
  await expect(page.locator('[data-testid^="codecLab.comparison.row."]')).toHaveCount(8);
  await expect(page.getByTestId("codecLab.comparison.chart")).toBeVisible();
  await expect(
    page.getByTestId("codecLab.comparison.chart").locator("canvas").first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("English (LTR): the codec lab encodes with zero console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/codec-lab");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await loadChirp(page);
  await page.getByTestId("codecLab.control.codec").selectOption("huffman");
  await page.getByTestId("codecLab.encode").click();
  await expect(page.getByTestId("codecLab.stat.bitExact")).toHaveText(/Yes/, { timeout: 20_000 });
  await expect(page.getByTestId("codecLab.stat.entropy")).toHaveText(/bit\/symbol/);
  expect(errors).toEqual([]);
});

async function runStereoRealCodec(
  page: Page,
  playerLabel: string,
  realLabel: string,
): Promise<void> {
  await stubStereoBackend(page);
  await page.goto("/tools/codec-lab");
  await page.getByTestId("input.demo.load.stereo").click();
  await expect(page.getByTestId("input.upload.dropzone")).toHaveCount(0);
  await expect(page.getByTestId("player.channels")).toHaveText(playerLabel);

  await page.getByTestId("codecLab.real.encode").click();
  await expect(page.getByTestId("codecLab.real.channels")).toHaveText(realLabel, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("codecLab.metrics.monoAnalysis")).toBeVisible();
  await expect(page.getByTestId("codecLab.real.stat.size")).toBeVisible();

  await page.getByTestId("codecLab.real.play").click();
  await expect(page.getByTestId("player.ab.processed")).toHaveAttribute("aria-pressed", "true");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("codecLab.real.export").click(),
  ]);
  expect(download.suggestedFilename()).toBe("avalab-flac.wav");
  const downloadPath = await download.path();
  if (downloadPath === null) {
    throw new Error("real-codec WAV download has no path");
  }
  const bytes = await readFile(downloadPath);
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
  expect(bytes.readUInt16LE(22)).toBe(2);
  expect(bytes.readUInt32LE(24)).toBe(48_000);
  expect(bytes.readUInt16LE(34)).toBe(16);
}

test("Persian: a real stereo codec result keeps two channels, plays, and exports WAV", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await runStereoRealCodec(page, "2 کانال", "استریو");
  expect(errors).toEqual([]);
});

test("English (LTR): the real stereo codec lane and WAV export stay console-clean", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("avalab.language", "en");
  });
  await page.goto("/tools/codec-lab");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await runStereoRealCodec(page, "2 ch", "Stereo");
  expect(errors).toEqual([]);
});
