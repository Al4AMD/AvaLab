import { describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import fa from "../../i18n/fa.json";
import { type TheoryToolId, TOOL_THEORY } from "./theoryContent";

const REQUIRED_TOOL_IDS: readonly TheoryToolId[] = [
  "waveform",
  "spectrogram",
  "fftview",
  "filters",
  "generator",
  "speed",
  "sampling",
  "extent",
  "reverb",
  "spectrum-edit",
  "codec-lab",
  "metrics",
  "psychoacoustics",
  "pipeline",
];

function hasKey(source: unknown, path: string): boolean {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" && current.length > 0;
}

describe("tool theory content", () => {
  it("covers every non-AI tool route", () => {
    expect(Object.keys(TOOL_THEORY).sort()).toEqual([...REQUIRED_TOOL_IDS].sort());
  });

  it.each(REQUIRED_TOOL_IDS)("%s has at least two sections and one formula", (toolId) => {
    const entry = TOOL_THEORY[toolId];
    expect(entry.sections.length).toBeGreaterThanOrEqual(2);
    expect(entry.sections.some((section) => section.formula !== undefined)).toBe(true);
  });

  it.each(REQUIRED_TOOL_IDS)("%s resolves every theory key in both locales", (toolId) => {
    const entry = TOOL_THEORY[toolId];
    const keys = [
      entry.titleKey,
      ...entry.sections.flatMap((section) => [
        section.headingKey,
        section.bodyKey,
        ...(section.bulletKeys ?? []),
      ]),
    ];
    for (const key of keys) {
      expect(hasKey(en, key), `en: ${key}`).toBe(true);
      expect(hasKey(fa, key), `fa: ${key}`).toBe(true);
    }
  });
});
