/**
 * Deterministic report/slide screenshots (Wave-6 Plan 07 Task 4).
 *
 * The script starts the Vite dev server when AVALAB_CAPTURE_BASE_URL is unset,
 * forces the Persian dark UI at a fixed 1440x900 viewport, and writes PNGs to
 * docs/report/assets/. AI screenshots additionally require the API on :8000
 * with the pinned cache; the PDF build never calls this script.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const requireFromWeb = createRequire(join(repoRoot, "apps/web/package.json"));
const { chromium } = requireFromWeb("@playwright/test");

const BASE_URL = process.env.AVALAB_CAPTURE_BASE_URL ?? "http://127.0.0.1:5174";
const assetsDir = join(repoRoot, "docs/report/assets");
const skipAi = process.argv.includes("--no-ai");

let server = null;

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not start: ${url}`);
}

async function startWebServer() {
  if (process.env.AVALAB_CAPTURE_BASE_URL !== undefined) {
    return;
  }
  server = spawn(
    "pnpm",
    ["--filter", "@avalab/web", "dev", "--host", "127.0.0.1", "--port", "5174"],
    { cwd: repoRoot, detached: true, stdio: "ignore" },
  );
  await waitForHttp(BASE_URL);
}

async function stopWebServer() {
  if (server === null) {
    return;
  }
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // already gone
  }
  server = null;
}

async function apiAvailable() {
  try {
    const response = await fetch("http://127.0.0.1:8000/api/v1/models");
    return response.ok;
  } catch {
    return false;
  }
}

function watchErrors(page, label) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`${label} console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`${label} pageerror: ${error.message}`);
  });
  return errors;
}

async function painted(canvas) {
  return canvas.evaluate((element) => {
    const ctx = element.getContext("2d");
    if (ctx === null) {
      return false;
    }
    const pixels = ctx.getImageData(0, 0, element.width, element.height).data;
    return pixels.some((value) => value !== 0);
  });
}

async function pollPainted(page, selector) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 20_000 });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await painted(page.locator(selector).first())) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`canvas did not paint: ${selector}`);
}

async function pollVaried(page, selector) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 20_000 });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const varied = await page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const canvas = element;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
          return false;
        }
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set();
        for (let index = 0; index < data.length; index += 400) {
          colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
          if (colors.size > 8) {
            return true;
          }
        }
        return false;
      });
    if (varied) {
      return;
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`canvas stayed blank: ${selector}`);
}

async function open(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor({ state: "visible", timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function capture(context, path, file, ready, afterReady) {
  const page = await context.newPage();
  const errors = watchErrors(page, file);
  try {
    await open(page, path);
    await ready(page);
    if (afterReady !== undefined) {
      await afterReady(page);
    }
    await page.waitForTimeout(450);
    if ((await page.locator(".animate-spin").count()) > 0) {
      throw new Error(`${file}: spinner still visible`);
    }
    await page.screenshot({ path: join(assetsDir, file), fullPage: false });
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }
    console.log(`captured ${file}`);
  } catch (error) {
    console.error(`${file}: url=${page.url()}`);
    console.error(
      (
        await page
          .locator("main")
          .innerText()
          .catch(() => "<no main>")
      ).slice(0, 1200),
    );
    throw error;
  } finally {
    await page.close();
  }
}

async function buildPipeline(page) {
  await open(page, "/tools/pipeline");
  await page.getByTestId("pipeline.view").waitFor();
  await page.getByTestId("input.demo.load.chirp").click();
  await page.getByTestId("pipeline.palette.filter").click();
  await page.getByTestId("pipeline.node.filter-1").waitFor();
  await page.locator(".react-flow__controls-fitview").click();
  await page.getByTestId("rf__edge-edge-1").click({ force: true });
  await page.getByTestId("pipeline.deleteEdge").click();

  async function connect(fromId, toId) {
    const from = await page
      .locator(`.react-flow__handle[data-nodeid="${fromId}"][data-handlepos="right"]`)
      .boundingBox();
    const to = await page
      .locator(`.react-flow__handle[data-nodeid="${toId}"][data-handlepos="left"]`)
      .boundingBox();
    if (from === null || to === null) {
      throw new Error(`missing pipeline handle ${fromId} -> ${toId}`);
    }
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
  }

  await connect("source-1", "filter-1");
  await connect("filter-1", "output-1");
  await page.getByTestId("pipeline.run").click();
  await page.getByTestId("pipeline.stage.filter-1").waitFor({ timeout: 30_000 });
  await page.getByTestId("pipeline.stage.output-1").waitFor();
  await page.getByTestId("pipeline.output.install").click();
}

async function main() {
  await mkdir(join(assetsDir, "ai"), { recursive: true });
  await startWebServer();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: "fa-IR",
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
    });
    await context.addInitScript(() => {
      localStorage.setItem("avalab.language", "fa");
      localStorage.setItem("avalab.theme", "dark");
    });
    await capture(context, "/tools/waveform?demo=pinkNoise", "waveform.png", async (p) => {
      await p.getByTestId("waveform.readout").waitFor({ timeout: 20_000 });
    });

    await capture(context, "/tools/spectrogram?demo=pinkNoise", "spectrogram.png", async (p) => {
      await p.getByTestId("spectrogram.canvas").waitFor({ state: "visible", timeout: 20_000 });
      await pollPainted(p, '[data-testid="spectrogram.canvas"]');
    });

    await capture(context, "/tools/fftview?demo=chirp", "fft.png", async (p) => {
      await pollPainted(p, '[data-testid="fftview.chart.magnitude"] canvas');
      await pollPainted(p, '[data-testid="fftview.chart.phase"] canvas');
    });

    await capture(
      context,
      "/tools/sampling?demo=chirp",
      "sampling.png",
      async (p) => {
        await p.getByTestId("sampling.metric.snr").waitFor({ timeout: 20_000 });
        await p.getByTestId("sampling.alias.predicted").waitFor({ timeout: 20_000 });
      },
      async (p) => {
        await p.getByTestId("sampling.control.targetRate").selectOption("8000");
        await p.getByTestId("sampling.control.antiAlias").click();
        await p.getByTestId("sampling.metric.snr").waitFor();

        // The aliasing card is source-free: its sine is generated in the worker.
        await p.getByTestId("sampling.alias.targetRate").selectOption("16000");
        await p.getByTestId("sampling.alias.frequency").evaluate((element) => {
          const input = element;
          input.value = "15000";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await p.waitForFunction(() => {
          const node = document.querySelector('[data-testid="sampling.alias.predicted"]');
          return node !== null && node.textContent !== null && node.textContent.trim() !== "";
        });
      },
    );

    await capture(
      context,
      "/tools/speed?demo=speech",
      "speed.png",
      async (p) => {
        await p.getByTestId("speed.result.duration").waitFor({ timeout: 20_000 });
      },
      async (p) => {
        await p.getByTestId("speed.control.mode").selectOption("timeStretch");
        await p.getByTestId("speed.preset.2").click();
        await p.waitForFunction(() => {
          const node = document.querySelector('[data-testid="speed.result.actualSpeed"]');
          return node !== null && node.textContent === "×2.00";
        });
        await pollPainted(p, '[data-testid="speed.result.waveform"]');
        await pollPainted(p, '[data-testid="speed.result.spectrogram"]');
      },
    );

    await capture(
      context,
      "/tools/extent?demo=chirp",
      "extent.png",
      async (p) => {
        await p.getByTestId("extent.metric.duration").waitFor({ timeout: 20_000 });
      },
      async (p) => {
        await p.getByTestId("extent.control.operation").selectOption("zeroPad");
        await p.getByTestId("extent.control.padEnd").fill("48000");
        await p.waitForFunction(() => {
          const node = document.querySelector('[data-testid="extent.metric.samples"]');
          return node !== null && node.textContent === "288000";
        });
        await pollPainted(p, '[data-testid="extent.spectrum.after"] canvas');
      },
    );

    await capture(
      context,
      "/tools/spectrum-edit?demo=chirp",
      "spectrum-edit.png",
      async (p) => {
        await p.getByTestId("spectrumEdit.meta.fftLength").waitFor({ timeout: 20_000 });
      },
      async (p) => {
        await p.getByTestId("spectrumEdit.preset.zeroIm").click();
        await p.getByTestId("spectrumEdit.edit.item").waitFor();
        await pollPainted(p, '[data-testid="spectrumEdit.chart.re"] canvas');
        await pollPainted(p, '[data-testid="spectrumEdit.chart.phase"] canvas');
      },
    );

    await capture(
      context,
      "/tools/reverb?demo=chirp",
      "reverb.png",
      async (p) => {
        await p.getByTestId("reverb.metric.duration").waitFor({ timeout: 20_000 });
      },
      async (p) => {
        await p.getByTestId("reverb.control.ir").selectOption("hall");
        await p.getByTestId("reverb.control.wetMix").fill("0.65");
        await pollVaried(p, '[data-testid="reverb.ir.waveform"]');
        await pollVaried(p, '[data-testid="reverb.result.spectrogram"]');
        await p.evaluate(() => {
          window.scrollTo(0, 0);
        });
      },
    );

    await capture(
      context,
      "/tools/generator",
      "generator.png",
      async (p) => {
        await p.getByTestId("generator.preview.canvas").waitFor({ timeout: 20_000 });
      },
      async (p) => {
        await p.getByTestId("generator.tab.fourier").click();
        await p.getByTestId("generator.control.fourierHarmonics").fill("9");
        await pollPainted(p, '[data-testid="generator.fourier.preview.partial"]');
        await pollPainted(p, '[data-testid="generator.fourier.preview.ideal"]');
      },
    );

    await capture(
      context,
      "/tools/codec-lab?demo=music",
      "codec.png",
      async (p) => {
        await p.getByTestId("codecLab.range").waitFor({ timeout: 20_000 });
      },
      async (p) => {
        await p.getByTestId("codecLab.control.codec").selectOption("mdct");
        const psycho = p.getByTestId("codecLab.control.psycho");
        if (!(await psycho.isChecked())) {
          await psycho.click();
        }
        await p.getByTestId("codecLab.encode").click();
        await p.getByTestId("codecLab.mdct.totalBitrate").waitFor({ timeout: 30_000 });
      },
    );

    await capture(context, "/tools/filters?demo=speech", "filters.png", async (p) => {
      await p.getByTestId("filters.result.stability").waitFor({ timeout: 20_000 });
    });

    await capture(
      context,
      "/tools/pipeline",
      "pipeline.png",
      async (p) => {
        await p.getByTestId("pipeline.view").waitFor();
      },
      buildPipeline,
    );

    await capture(context, "/tools/waveform?demo=music", "psychoacoustics.png", async (p) => {
      await p.getByTestId("waveform.readout").waitFor({ timeout: 20_000 });
      await p.locator('a[href="/tools/psychoacoustics"]').click();
      await p.getByTestId("psychoacoustics.chart.threshold").waitFor({ timeout: 30_000 });
      await p.getByTestId("psychoacoustics.chart.level").waitFor();
    });

    if (!skipAi) {
      if (!(await apiAvailable())) {
        throw new Error("AI capture requires the API on http://127.0.0.1:8000");
      }
      await capture(
        context,
        "/tools/ai?task=superres&demo=speech",
        "ai/superres.png",
        async (p) => {
          await p.getByTestId("ai.run").waitFor({ state: "visible", timeout: 20_000 });
          await p.waitForFunction(
            () => {
              const button = document.querySelector('[data-testid="ai.run"]');
              return button instanceof HTMLButtonElement && !button.disabled;
            },
            undefined,
            { timeout: 30_000 },
          );
        },
        async (p) => {
          await p.getByTestId("ai.run").click();
          await p.waitForFunction(
            () => {
              const button = document.querySelector('[data-testid="ai.superres.ab.restored"]');
              return button instanceof HTMLButtonElement && !button.disabled;
            },
            undefined,
            { timeout: 30_000 },
          );
        },
      );

      await capture(
        context,
        "/tools/ai?task=denoise",
        "ai/denoise.png",
        async (p) => {
          await p.getByTestId("ai.denoise.loadDemo").waitFor({ timeout: 20_000 });
        },
        async (p) => {
          await p.getByTestId("ai.denoise.loadDemo").click();
          await p.waitForFunction(
            () => {
              const button = document.querySelector('[data-testid="ai.run"]');
              return button instanceof HTMLButtonElement && !button.disabled;
            },
            undefined,
            { timeout: 30_000 },
          );
          await p.getByTestId("ai.run").click();
          await p.getByTestId("ai.denoise.rms").waitFor({ timeout: 30_000 });
        },
      );
    }

    await context.close();
  } finally {
    await browser.close();
    await stopWebServer();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
