import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface GoldenCaseInput {
  samples: number[];
  sample_rate_hz: number | null;
}

export interface GoldenCase {
  name: string;
  input: GoldenCaseInput;
  params: Record<string, unknown>;
  expected: Record<string, unknown>;
  tolerance: { rtol: number; atol: number };
}

export function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`golden fixture value ${label} is not a finite number`);
  }
  return value;
}

export function asNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`golden fixture value ${label} is not an array`);
  }
  return value.map((item: unknown, index: number) => asNumber(item, `${label}[${index}]`));
}

export interface GoldenFile {
  algorithm: string;
  cases: GoldenCase[];
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function loadGolden(algorithm: string): GoldenFile {
  const filePath = join(packageRoot, "test-data", "golden", `${algorithm}.json`);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new Error(`golden fixture not found or unreadable: ${filePath}`, { cause });
  }
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { algorithm?: unknown }).algorithm !== "string" ||
    !Array.isArray((parsed as { cases?: unknown }).cases)
  ) {
    throw new Error(`golden fixture has an unexpected shape: ${filePath}`);
  }
  return parsed as GoldenFile;
}
