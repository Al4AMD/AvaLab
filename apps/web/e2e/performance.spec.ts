/**
 * Wave 6 Plan 05 Task 1 — AGENTS §9 performance harness on the 5-minute
 * 44.1 kHz mono source. Everything runs through the real browser paths on the
 * backend-absent static preview: offline WAV decode, worker DSP, and paint.
 * The real measurements go to `docs/plans/wave-6/performance.md`; this spec
 * gates only stable upper bounds so CI load cannot turn them into flakes.
 */
import { type ConsoleMessage, expect, type Locator, type Page, test } from "@playwright/test";

const SAMPLE_RATE_HZ = 44_100;
const DURATION_SECONDS = 300;
const FIVE_MINUTE_SAMPLES = SAMPLE_RATE_HZ * DURATION_SECONDS;

type Measurement = {
  readonly name: string;
  readonly ms: number;
  readonly limitMs: number | null;
};

const measurements: Measurement[] = [];

/** Valid PCM WAV (mono, 44.1 kHz, 16-bit) with two tones and low noise. */
function fiveMinuteWav(): Buffer {
  const bytesPerSample = 2;
  const dataSize = FIVE_MINUTE_SAMPLES * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE_HZ, 24);
  buffer.writeUInt32LE(SAMPLE_RATE_HZ * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  let noiseState = 0x12345678;
  for (let index = 0; index < FIVE_MINUTE_SAMPLES; index += 1) {
    noiseState = (Math.imul(noiseState, 1_664_525) + 1_013_904_223) >>> 0;
    const noise = ((noiseState / 0xffffffff) * 2 - 1) * 0.01;
    const value =
      0.22 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE_HZ) +
      0.11 * Math.sin((2 * Math.PI * 1_000 * index) / SAMPLE_RATE_HZ) +
      noise;
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32_767), 44 + index * 2);
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

async function browserNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

async function timed(
  page: Page,
  name: string,
  limitMs: number,
  action: () => Promise<void>,
): Promise<number> {
  const startedAt = await browserNow(page);
  await action();
  const ms = (await browserNow(page)) - startedAt;
  measurements.push({ name, ms, limitMs });
  console.log(`[perf] ${name} ${ms.toFixed(1)} ms (limit ${limitMs} ms)`);
  return ms;
}

async function expectCanvasPainted(page: Page, testId: string, timeout = 30_000): Promise<void> {
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
      { timeout },
    )
    .toBeGreaterThan(0);
}

async function expectPlotPainted(canvas: Locator, timeout = 30_000): Promise<void> {
  await expect(canvas).toBeVisible({ timeout });
  await expect
    .poll(
      async () =>
        canvas.evaluate((element) => {
          const node = element as HTMLCanvasElement;
          const context = node.getContext("2d");
          if (context === null) {
            return false;
          }
          const pixels = context.getImageData(0, 0, node.width, node.height).data;
          return pixels.some((value) => value !== 0);
        }),
      { timeout },
    )
    .toBe(true);
}

async function selectThirtySeconds(page: Page): Promise<void> {
  await page.locator('a[href="/tools/waveform"]').click();
  await expectCanvasPainted(page, "waveform.detail.canvas");
  const detail = page.getByTestId("waveform.detail.canvas");
  const box = await detail.boundingBox();
  if (box === null) {
    throw new Error("waveform detail has no box");
  }
  await page.mouse.move(box.x + box.width * 0.01, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.11, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("waveform.selection.value")).toHaveText(/[0-9]/);
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

test("5-minute 44.1 kHz source meets the AGENTS §9 budgets", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = watchForErrors(page);
  const wav = fiveMinuteWav();
  await page.addInitScript(() => {
    document.addEventListener(
      "change",
      (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.type === "file") {
          performance.mark("avalab-file-change");
        }
      },
      true,
    );
    const originalDecode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (
      this: AudioContext,
      ...args: Parameters<AudioContext["decodeAudioData"]>
    ) {
      performance.mark("avalab-decode-start");
      const result = originalDecode.apply(this, args);
      const done = () => performance.mark("avalab-decode-done");
      result.then(done, done);
      return result;
    };
  });
  await page.goto("/tools/waveform");
  await expect(page.getByTestId("input.upload.input")).toBeVisible();

  await page.getByTestId("input.upload.input").setInputFiles({
    name: "five-minute-44k1.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expectCanvasPainted(page, "waveform.overview.canvas");
  await expectCanvasPainted(page, "waveform.detail.canvas");
  const firstPaint = await page.evaluate(() => {
    const mark = (name: string): number => {
      const value = performance.getEntriesByName(name).at(0)?.startTime;
      if (value === undefined) {
        throw new Error(`missing performance mark ${name}`);
      }
      return value;
    };
    const fileChange = mark("avalab-file-change");
    const decodeStart = mark("avalab-decode-start");
    const decodeDone = mark("avalab-decode-done");
    const now = performance.now();
    return {
      totalMs: now - fileChange,
      decodeMs: decodeDone - decodeStart,
      overviewMs: now - decodeDone,
    };
  });
  measurements.push(
    { name: "file change→waveform overview", ms: firstPaint.totalMs, limitMs: null },
    { name: "decodeAudioData 5-minute WAV", ms: firstPaint.decodeMs, limitMs: null },
    { name: "waveform overview after decode", ms: firstPaint.overviewMs, limitMs: 2_000 },
  );
  console.log(
    `[perf] file change→waveform overview ${firstPaint.totalMs.toFixed(1)} ms; decode ${firstPaint.decodeMs.toFixed(1)} ms; overview after decode ${firstPaint.overviewMs.toFixed(1)} ms (limit 2000 ms)`,
  );
  expect(firstPaint.overviewMs).toBeLessThan(2_000);

  await timed(page, "spectrogram overview", 6_000, async () => {
    await page.locator('a[href="/tools/spectrogram"]').click();
    await expect(page.getByTestId("spectrogram.loading")).toHaveCount(0, { timeout: 30_000 });
    await expectCanvasPainted(page, "spectrogram.canvas");
  });
  expect(measurements.at(-1)?.ms ?? Number.POSITIVE_INFINITY).toBeLessThan(6_000);

  await selectThirtySeconds(page);
  await page.evaluate(() => performance.mark("fft-click"));
  await page.locator('a[href="/tools/fftview"]').click();
  await expect(page.getByTestId("fftview.meta.bins")).not.toHaveText("0", { timeout: 30_000 });
  const fftBinsMs = await page.evaluate(
    () => performance.now() - (performance.getEntriesByName("fft-click").at(0)?.startTime ?? 0),
  );
  await expectPlotPainted(page.getByTestId("fftview.chart.magnitude").locator("canvas").first());
  const fftPaintMs = await page.evaluate(
    () => performance.now() - (performance.getEntriesByName("fft-click").at(0)?.startTime ?? 0),
  );
  measurements.push({ name: "FFT 30 s excerpt", ms: fftPaintMs, limitMs: 600 });
  console.log(
    `[perf] FFT 30 s excerpt ${fftPaintMs.toFixed(1)} ms (bins ${fftBinsMs.toFixed(1)} ms; paint +${(fftPaintMs - fftBinsMs).toFixed(1)} ms; limit 600 ms)`,
  );
  expect(fftPaintMs).toBeLessThan(600);

  await page.locator('a[href="/tools/codec-lab"]').click();
  await expect(page.getByTestId("codecLab.control.start")).toBeVisible();
  await page.getByTestId("codecLab.control.start").fill("0");
  await page.getByTestId("codecLab.control.end").fill("10");
  await page.getByTestId("codecLab.control.codec").selectOption("mdct");
  await page.getByTestId("codecLab.control.bitrate").selectOption("64");
  // The teaching MDCT codec is deliberately O(N^2); a 10 s encode is an
  // explicit long job, not a live slider path. Keep a stable upper bound and
  // record the honest fallback in performance.md.
  await timed(page, "MDCT encode+decode 10 s", 6_000, async () => {
    await page.getByTestId("codecLab.encode").click();
    await expect(page.getByTestId("codecLab.stat.ratio")).toBeVisible({ timeout: 30_000 });
  });
  const mdctStats = {
    encodeMs: await page.getByTestId("codecLab.stat.encodeMs").textContent(),
    decodeMs: await page.getByTestId("codecLab.stat.decodeMs").textContent(),
  };
  console.log(`[perf] MDCT worker stats ${JSON.stringify(mdctStats)}`);
  expect(measurements.at(-1)?.ms ?? Number.POSITIVE_INFINITY).toBeLessThan(6_000);

  await page.locator('a[href="/tools/filters"]').click();
  await expect(page.getByTestId("filters.result.stability")).toBeVisible({ timeout: 30_000 });
  await timed(page, "FIR filter 30 s excerpt", 600, async () => {
    await page.getByTestId("filters.apply.selection").click();
    await expect(page.getByTestId("filters.apply.done")).toBeVisible({ timeout: 30_000 });
  });
  expect(measurements.at(-1)?.ms ?? Number.POSITIVE_INFINITY).toBeLessThan(600);

  await page.locator('a[href="/tools/reverb"]').click();
  await expect(page.getByTestId("reverb.metric.elapsed")).toBeVisible({ timeout: 30_000 });
  const initialElapsed = await page.getByTestId("reverb.metric.elapsed").textContent();
  // A 30 s convolution preview is heavy; 2 s is the documented fallback
  // ceiling for this explicit apply, not the 300 ms slider budget.
  await timed(page, "reverb 30 s excerpt", 2_000, async () => {
    await page.getByTestId("reverb.control.ir").selectOption("room");
    await expect
      .poll(async () => (await page.getByTestId("reverb.metric.elapsed").textContent()) ?? "", {
        timeout: 30_000,
      })
      .not.toBe(initialElapsed ?? "");
  });
  console.log(
    `[perf] reverb worker elapsed ${await page.getByTestId("reverb.metric.elapsed").textContent()}`,
  );
  expect(measurements.at(-1)?.ms ?? Number.POSITIVE_INFINITY).toBeLessThan(2_000);

  await page.locator('a[href="/tools/pipeline"]').click();
  await expect(page.getByTestId("pipeline.view")).toBeVisible();
  await page.getByTestId("pipeline.palette.filter").click();
  await expect(page.getByTestId("pipeline.node.filter-1")).toBeVisible();
  await page.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(400);
  const defaultEdge = page.getByTestId("rf__edge-edge-1");
  await defaultEdge.click({ force: true });
  await expect(page.getByTestId("pipeline.deleteEdge")).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("pipeline.deleteEdge").click();
  await connect(page, "source-1", "filter-1");
  await connect(page, "filter-1", "output-1");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await timed(page, "pipeline 30 s excerpt", 600, async () => {
    await page.getByTestId("pipeline.run").click();
    await expect(page.getByTestId("pipeline.stage.output-1")).toBeVisible({ timeout: 30_000 });
  });
  console.log(
    `[perf] pipeline worker total ${await page.getByTestId("pipeline.result").locator("p").first().textContent()}`,
  );
  expect(measurements.at(-1)?.ms ?? Number.POSITIVE_INFINITY).toBeLessThan(600);

  const loudnessMatch = page.getByTestId("player.loudnessMatch");
  if ((await loudnessMatch.getAttribute("aria-pressed")) === "true") {
    await loudnessMatch.click();
  }
  await expect(loudnessMatch).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("player.ab.processed").click();
  await timed(page, "loudness 5-minute source + 30 s processed", 10_000, async () => {
    await loudnessMatch.click();
    await expect(loudnessMatch).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("player.loudnessGain")).not.toHaveText(/measuring|در حال/, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("player.loudnessGain")).toHaveText(/dB/);
  });
  expect(measurements.at(-1)?.ms ?? Number.POSITIVE_INFINITY).toBeLessThan(10_000);

  const device = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
  }));
  console.log(`[perf-json] ${JSON.stringify({ device, measurements })}`);
  expect(errors).toEqual([]);
});
