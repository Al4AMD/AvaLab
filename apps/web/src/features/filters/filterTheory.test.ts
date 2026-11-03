import { describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import fa from "../../i18n/fa.json";
import { FILTER_THEORY_SECTIONS, FILTER_THEORY_TITLE_KEY } from "./filterTheory";

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

describe("filter theory data", () => {
  it("resolves every title, heading, body, and bullet key in both locales", () => {
    const keys = [FILTER_THEORY_TITLE_KEY];
    for (const section of FILTER_THEORY_SECTIONS) {
      keys.push(section.headingKey, section.bodyKey, ...(section.bulletKeys ?? []));
    }
    for (const key of keys) {
      expect(lookup(en, key), `en ${key}`).not.toBeNull();
      expect(lookup(fa, key), `fa ${key}`).not.toBeNull();
    }
  });

  it("keeps every formula non-empty and every content key in the theory namespace", () => {
    expect(FILTER_THEORY_SECTIONS.length).toBeGreaterThanOrEqual(7);
    expect(FILTER_THEORY_TITLE_KEY).toMatch(/^filters\.theory\./);
    let formulaCount = 0;
    for (const section of FILTER_THEORY_SECTIONS) {
      expect(section.headingKey).toMatch(/^filters\.theory\./);
      expect(section.bodyKey).toMatch(/^filters\.theory\./);
      for (const key of section.bulletKeys ?? []) {
        expect(key).toMatch(/^filters\.theory\./);
      }
      if (section.formula !== undefined) {
        expect(section.formula.trim()).not.toBe("");
        formulaCount += 1;
      }
    }
    expect(formulaCount).toBeGreaterThanOrEqual(5);
  });

  it("covers observations and pitfalls as bullet lists", () => {
    const bulletSections = FILTER_THEORY_SECTIONS.filter(
      (section) => (section.bulletKeys?.length ?? 0) > 0,
    );
    expect(bulletSections.length).toBeGreaterThanOrEqual(2);
    const bulletCount = bulletSections.reduce(
      (total, section) => total + (section.bulletKeys?.length ?? 0),
      0,
    );
    expect(bulletCount).toBeGreaterThanOrEqual(7);
  });
});
