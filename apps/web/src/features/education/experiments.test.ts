import { beforeAll, describe, expect, it, vi } from "vitest";

import en from "../../i18n/en.json";
import fa from "../../i18n/fa.json";
import {
  EXPERIMENT_CATEGORIES,
  EXPERIMENT_IDS,
  EXPERIMENTS,
  EXPERIMENTS_PROGRESS_STORAGE_KEY,
  type ExperimentId,
  loadExperimentProgress,
  parseExperimentProgress,
  saveExperimentProgress,
} from "./experiments";

type Locale = typeof en;

let allowedPaths: ReadonlySet<string>;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const { TOOL_IDS } = await import("../../app/routes");
  allowedPaths = new Set(TOOL_IDS.map((toolId) => `/tools/${toolId}`));
});

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

describe("guided experiments", () => {
  it("defines every planned experiment in plan order", () => {
    expect(EXPERIMENTS.map((experiment) => experiment.id)).toEqual([...EXPERIMENT_IDS]);
  });

  it("assigns every experiment to a known category", () => {
    for (const experiment of EXPERIMENTS) {
      expect(EXPERIMENT_CATEGORIES).toContain(experiment.category);
    }
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

  it("gives every experiment five to eight steps", () => {
    for (const experiment of EXPERIMENTS) {
      expect(experiment.steps.length, experiment.id).toBeGreaterThanOrEqual(5);
      expect(experiment.steps.length, experiment.id).toBeLessThanOrEqual(8);
    }
  });

  it("gives the deep-dive labs eight steps", () => {
    const deepDive: readonly ExperimentId[] = [
      "fft",
      "spectrum-edit",
      "filters",
      "codec-lab",
      "ai-separation",
      "ai-denoise",
      "ai-superres",
      "ai-asr",
      "ai-neural-codec",
      "ai-pitch-beat",
      "pipeline",
      "psychoacoustics",
    ];
    for (const id of deepDive) {
      expect(EXPERIMENTS.find((experiment) => experiment.id === id)?.steps.length, id).toBe(8);
    }
  });

  it("links only to existing tool routes with valid search params", () => {
    for (const experiment of EXPERIMENTS) {
      for (const step of experiment.steps) {
        if (step.link === undefined) {
          continue;
        }
        const link = step.link;
        expect(allowedPaths.has(link.path), link.path).toBe(true);
        expect(link.search.startsWith("?")).toBe(false);
        expect(() => new URLSearchParams(link.search)).not.toThrow();
      }
    }
  });

  it("links each experiment's first step to its matching lab", () => {
    const expected: Partial<Record<ExperimentId, string>> = {
      "waveform-spectrogram": "/tools/waveform",
      sampling: "/tools/sampling",
      extent: "/tools/extent",
      fft: "/tools/fftview",
      "spectrum-edit": "/tools/spectrum-edit",
      speed: "/tools/speed",
      reverb: "/tools/reverb",
      filters: "/tools/filters",
      "generator-fourier": "/tools/generator",
      "codec-lab": "/tools/codec-lab",
      metrics: "/tools/metrics",
      "ai-separation": "/tools/ai",
      "ai-denoise": "/tools/ai",
      "ai-superres": "/tools/ai",
      "ai-asr": "/tools/ai",
      "ai-neural-codec": "/tools/ai",
      "ai-pitch-beat": "/tools/ai",
      pipeline: "/tools/pipeline",
      psychoacoustics: "/tools/psychoacoustics",
    };
    for (const experiment of EXPERIMENTS) {
      expect(experiment.steps[0]?.link?.path, experiment.id).toBe(expected[experiment.id]);
    }
  });
});

describe("experiment progress", () => {
  it("parses a known id list and drops unknown or duplicate values", () => {
    const parsed = parseExperimentProgress(
      JSON.stringify(["filters", "unknown", "sampling", "filters", 7]),
    );
    expect([...parsed]).toEqual(["filters", "sampling"]);
  });

  it("resets invalid stored JSON to an empty set", () => {
    expect(parseExperimentProgress("{")).toEqual(new Set());
    expect(parseExperimentProgress(JSON.stringify({ filters: true }))).toEqual(new Set());
    expect(parseExperimentProgress(null)).toEqual(new Set());
  });

  it("persists only ids and reloads them", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveExperimentProgress(storage, new Set<ExperimentId>(["filters", "pipeline"]));
    expect(values.get(EXPERIMENTS_PROGRESS_STORAGE_KEY)).toBe(
      JSON.stringify(["filters", "pipeline"]),
    );
    expect([...loadExperimentProgress(storage)]).toEqual(["filters", "pipeline"]);
  });
});
