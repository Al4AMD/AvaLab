import { describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import fa from "../../i18n/fa.json";
import { EXPERIMENTS } from "./experiments";

type Locale = typeof en;

function lookup(locale: Locale, key: string): string | null {
  let cursor: unknown = locale;
  for (const part of key.split(".")) {
    if (typeof cursor !== "object" || cursor === null || !(part in cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : null;
}

const ALLOWED_LINK_PATHS = new Set(["/tools/filters", "/tools/ai", "/tools/codec-lab"]);

describe("guided experiments", () => {
  it("defines exactly the three planned experiments", () => {
    expect(EXPERIMENTS.map((experiment) => experiment.id)).toEqual([
      "filters",
      "superres",
      "asr-codec",
    ]);
  });

  it("resolves every title, goal, instruction, and observation in fa and en", () => {
    for (const experiment of EXPERIMENTS) {
      const keys = [experiment.titleKey, experiment.goalKey];
      for (const step of experiment.steps) {
        keys.push(step.instructionKey, step.observationKey);
      }
      for (const key of keys) {
        expect(key.startsWith("experiments."), key).toBe(true);
        expect(lookup(en, key), `en ${key}`).not.toBeNull();
        expect(lookup(fa, key), `fa ${key}`).not.toBeNull();
      }
    }
  });

  it("gives every experiment steps and at least one valid lab link", () => {
    for (const experiment of EXPERIMENTS) {
      expect(experiment.steps.length, experiment.id).toBeGreaterThanOrEqual(3);
      const links = experiment.steps.flatMap((step) =>
        step.link === undefined ? [] : [step.link],
      );
      expect(links.length, experiment.id).toBeGreaterThanOrEqual(1);
      for (const link of links) {
        expect(ALLOWED_LINK_PATHS.has(link.path), link.path).toBe(true);
        expect(link.search.startsWith("?"), link.search).toBe(false);
        expect(() => new URLSearchParams(link.search)).not.toThrow();
      }
    }
  });

  it("links the filter lab and both F14 labs from the matching experiments", () => {
    const paths = EXPERIMENTS.map((experiment) => ({
      id: experiment.id,
      paths: experiment.steps.flatMap((step) => (step.link === undefined ? [] : [step.link.path])),
    }));
    expect(paths.find((entry) => entry.id === "filters")?.paths).toContain("/tools/filters");
    expect(paths.find((entry) => entry.id === "superres")?.paths).toContain("/tools/ai");
    expect(paths.find((entry) => entry.id === "asr-codec")?.paths).toContain("/tools/codec-lab");
    expect(paths.find((entry) => entry.id === "asr-codec")?.paths).toContain("/tools/ai");
  });
});
