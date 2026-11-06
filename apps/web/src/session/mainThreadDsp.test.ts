/**
 * Static guard for AGENTS §9: DSP algorithms stay in `packages/dsp` and run in
 * the worker (`session/ops.ts`), never in a feature component on the main
 * thread. Canvas painters are exempt because they read prepared plot data.
 *
 * This is a text scan, not a type-aware lint: it deliberately looks only at
 * runtime imports from `@avalab/dsp`, so type-only imports and unrelated
 * identifiers such as `mdctBitsPerSecond` do not trip it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const FEATURES_DIR = fileURLToPath(new URL("../features/", import.meta.url));

const FORBIDDEN_EXPORT = new RegExp(
  "^(?:" +
    [
      "applySpectrumCurves",
      "fft",
      "ifft",
      "rfft",
      "irfft",
      "fftRadix2",
      "ifftRadix2",
      "fftBluestein",
      "fftButterflySteps",
      "stft",
      "istft",
      "mdct",
      "imdct",
      "encodeMdct",
      "decodeMdct",
      "convolve",
      "measureLoudness",
    ]
      .map((name) => `${name}\\w*`)
      .join("|") +
    ")$",
);

/** Plot/canvas painters may consume prepared arrays but must not transform audio. */
const CANVAS_ONLY_MODULES = new Set([
  "paintSpectrogram.ts",
  "paintWaveform.ts",
  "curveCanvas.tsx",
  "filterPlots.tsx",
]);

type Violation = {
  readonly file: string;
  readonly line: number;
  readonly name: string;
};

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (![".ts", ".tsx"].includes(extname(entry.name))) {
      continue;
    }
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
      continue;
    }
    files.push(path);
  }
  return files;
}

type ImportList = {
  readonly names: readonly string[];
  readonly line: number;
  readonly namespace: boolean;
};

function readDspImports(source: string): ImportList[] {
  const imports: ImportList[] = [];
  const pattern =
    /(?:import|export)\s+(?:type\s+)?((?:(?!\bfrom\b)[\s\S])*?)\s+from\s+["']@avalab\/dsp["']/g;
  for (const match of source.matchAll(pattern)) {
    const clause = match[1] ?? "";
    const line = source.slice(0, match.index ?? 0).split("\n").length;
    const namespace = /\*\s+as\s+/.test(clause);
    const brace = /\{([\s\S]*?)\}/.exec(clause);
    const names = (brace?.[1] ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "" && !entry.startsWith("type "))
      .map((entry) => entry.replace(/\s+as\s+\w+$/, "").trim());
    imports.push({ names, line, namespace });
  }
  return imports;
}

function findViolations(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  for (const entry of readDspImports(source)) {
    if (entry.namespace) {
      violations.push({ file, line: entry.line, name: "* as namespace" });
    }
    for (const name of entry.names) {
      if (FORBIDDEN_EXPORT.test(name)) {
        violations.push({ file, line: entry.line, name });
      }
    }
  }
  return violations;
}

describe("main-thread DSP guard", () => {
  it("keeps DSP imports out of feature modules", () => {
    const files = sourceFiles(FEATURES_DIR);
    expect(files.length).toBeGreaterThan(30);

    const violations = files.flatMap((file) => {
      if (CANVAS_ONLY_MODULES.has(file.split("/").at(-1) ?? "")) {
        return [];
      }
      return findViolations(relative(FEATURES_DIR, file), readFileSync(file, "utf8"));
    });

    expect(violations).toEqual([]);
  });
});
