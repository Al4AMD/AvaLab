import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../i18n/en.json";
import fa from "../../i18n/fa.json";
import { Formula } from "../theory/Formula";
import { AI_TASKS, type AiTask } from "./aiState";
import { AI_THEORY } from "./aiTheory";

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

const THEORY_NAMESPACE: Record<AiTask, string> = {
  denoise: "denoise",
  superres: "superres",
  separation: "separation",
  asr: "asr",
  "neural-codec": "neuralCodec",
  classification: "classification",
  pitch: "pitch",
  beat: "beat",
};

describe("AI theory data", () => {
  it("has one entry per tab with every fa/en key present", () => {
    expect(Object.keys(AI_THEORY).sort()).toEqual([...AI_TASKS].sort());
    for (const task of AI_TASKS) {
      const theory = AI_THEORY[task];
      const keys = [theory.titleKey];
      for (const section of theory.sections) {
        keys.push(section.headingKey, section.bodyKey, ...(section.bulletKeys ?? []));
      }
      for (const key of keys) {
        expect(key.startsWith(`ai.theory.${THEORY_NAMESPACE[task]}.`), key).toBe(true);
        expect(lookup(en, key), `en ${key}`).not.toBeNull();
        expect(lookup(fa, key), `fa ${key}`).not.toBeNull();
      }
    }
  });

  it("gives every tab one non-empty formula and observation plus pitfalls lists", () => {
    for (const task of AI_TASKS) {
      const sections = AI_THEORY[task].sections;
      const formulas = sections.flatMap((section) =>
        section.formula === undefined ? [] : [section.formula],
      );
      expect(formulas, task).toHaveLength(1);
      expect(formulas[0]?.trim()).not.toBe("");
      for (const formula of formulas) {
        expect(
          () => renderToStaticMarkup(createElement(Formula, { tex: formula, display: true })),
          `${task} formula`,
        ).not.toThrow();
      }
      const bulletSections = sections.filter((section) => (section.bulletKeys?.length ?? 0) > 0);
      expect(bulletSections.length, task).toBeGreaterThanOrEqual(2);
      const bulletCount = bulletSections.reduce(
        (total, section) => total + (section.bulletKeys?.length ?? 0),
        0,
      );
      expect(bulletCount, task).toBeGreaterThanOrEqual(4);
      expect(
        sections.some((section) => section.bodyKey.endsWith(".pitfalls.body")),
        task,
      ).toBe(true);
    }
  });

  it("keeps the task ids aligned with the record type", () => {
    const tasks: AiTask[] = [...AI_TASKS];
    expect(tasks).toEqual([
      "denoise",
      "superres",
      "separation",
      "asr",
      "neural-codec",
      "classification",
      "pitch",
      "beat",
    ]);
  });
});
