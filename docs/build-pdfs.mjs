/**
 * Wave-6 Plan 07 Task 1/5 — deterministic PDF build for the Persian report and slides.
 *
 * Chromium prints both documents from the same static sources the repository
 * ships. The build fails on a missing page, missing image, missing font,
 * horizontal overflow, clipped slide, console error, or failed request.
 */

import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const requireFromWeb = createRequire(join(repoRoot, "apps/web/package.json"));
const { chromium } = requireFromWeb("@playwright/test");

const deliverables = join(repoRoot, "docs/deliverables");
const reportPath = join(repoRoot, "docs/report/index.html");
const slidesPath = join(repoRoot, "docs/slides/index.html");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
};

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const requested = decodeURIComponent(url.pathname);
      const relative = normalize(requested).replace(/^([/\\])+/, "");
      if (relative.startsWith("..") || relative.split(sep).includes("..")) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const file = join(repoRoot, relative === "" ? "index.html" : relative);
      const info = await stat(file);
      if (!info.isFile()) {
        response.writeHead(404).end("not found");
        return;
      }
      response.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "content-length": info.size,
        "cache-control": "no-store",
      });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        resolve(null);
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function assertBuilt(htmlPath) {
  const info = await stat(htmlPath).catch(() => null);
  if (info === null || !info.isFile()) {
    throw new Error(`missing page: ${htmlPath}`);
  }
}

async function load(page, url, label) {
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("requestfailed", (request) => {
    problems.push(
      `request failed: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
    );
  });
  const response = await page.goto(url, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(`${label}: HTTP ${response?.status() ?? "no response"}`);
  }
  await page.evaluate(() => document.fonts.ready);
  const state = await page.evaluate(() => {
    const fonts = ["400 16px Vazirmatn", "700 16px Vazirmatn"].map((font) => ({
      font,
      ok: document.fonts.check(font),
    }));
    const images = [...document.images].map((image) => ({
      src: image.getAttribute("src") ?? "",
      ok: image.complete && image.naturalWidth > 0,
    }));
    return {
      fonts,
      images,
      bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  if (problems.length > 0) {
    throw new Error(`${label}:\n${problems.join("\n")}`);
  }
  const missingFonts = state.fonts.filter((font) => !font.ok);
  if (missingFonts.length > 0) {
    throw new Error(
      `${label}: font not ready: ${missingFonts.map((font) => font.font).join(", ")}`,
    );
  }
  const missingImages = state.images.filter((image) => !image.ok);
  if (missingImages.length > 0) {
    throw new Error(
      `${label}: missing image: ${missingImages.map((image) => image.src).join(", ")}`,
    );
  }
  if (state.bodyOverflow > 1) {
    throw new Error(
      `${label}: horizontal overflow ${state.bodyOverflow}px (body ${state.bodyWidth}px, viewport ${state.viewportWidth}px)`,
    );
  }
  return state;
}

async function assertSlidesFits(page) {
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll(".slide")].flatMap((slide, index) => {
      const element = slide;
      const horizontal = element.scrollWidth - element.clientWidth;
      const vertical = element.scrollHeight - element.clientHeight;
      return horizontal > 1 || vertical > 1 ? [{ index: index + 1, horizontal, vertical }] : [];
    }),
  );
  if (clipped.length > 0) {
    throw new Error(`clipped slides: ${JSON.stringify(clipped)}`);
  }
}

function countPdfPages(buffer) {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches === null ? 0 : matches.length;
}

async function printPdf(page, file, label) {
  const buffer = await page.pdf({
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
  });
  if (buffer.length === 0) {
    throw new Error(`${label}: empty PDF`);
  }
  const pages = countPdfPages(buffer);
  if (pages === 0) {
    throw new Error(`${label}: PDF has no pages`);
  }
  await import("node:fs/promises").then(({ writeFile }) => writeFile(file, buffer));
  console.log(`${label}: ${pages} pages, ${buffer.length} bytes -> ${file}`);
  return { pages, bytes: buffer.length };
}

async function main() {
  const startedAt = performance.now();
  await assertBuilt(reportPath);
  await assertBuilt(slidesPath);
  await mkdir(deliverables, { recursive: true });

  const server = await startServer();
  if (server === null) {
    throw new Error("could not start static server");
  }
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      locale: "fa-IR",
    });

    const report = await context.newPage();
    await load(report, `${server.origin}/docs/report/index.html`, "report");
    await report.emulateMedia({ media: "print" });
    const reportPdf = await printPdf(report, join(deliverables, "avalab-report-fa.pdf"), "report");

    const slides = await context.newPage();
    await load(slides, `${server.origin}/docs/slides/index.html`, "slides");
    await assertSlidesFits(slides);
    await slides.emulateMedia({ media: "print" });
    const slidesPdf = await printPdf(slides, join(deliverables, "avalab-slides-fa.pdf"), "slides");
    if (slidesPdf.pages < 14 || slidesPdf.pages > 18) {
      throw new Error(`slides: expected 14-18 pages, got ${slidesPdf.pages}`);
    }

    await context.close();
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(
      `built report ${reportPdf.pages} pages / slides ${slidesPdf.pages} pages in ${elapsedMs} ms at ${new Date().toISOString()}`,
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
