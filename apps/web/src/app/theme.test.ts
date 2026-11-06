import { describe, expect, it, vi } from "vitest";
import { readStoredTheme, resolveTheme, THEME_STORAGE_KEY, writeStoredTheme } from "./theme";

describe("readStoredTheme", () => {
  it("returns the stored theme and falls back to system for missing/unknown values", () => {
    expect(readStoredTheme({ getItem: () => "dark" })).toBe("dark");
    expect(readStoredTheme({ getItem: () => "light" })).toBe("light");
    expect(readStoredTheme({ getItem: () => "system" })).toBe("system");
    expect(readStoredTheme({ getItem: () => null })).toBe("system");
    expect(readStoredTheme({ getItem: () => "garbage" })).toBe("system");
    expect(readStoredTheme(null)).toBe("system");
  });

  it("is total when storage throws", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    expect(readStoredTheme(storage)).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("resolves all explicit/system combinations", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("light");
  });
});

describe("writeStoredTheme", () => {
  it("writes the exact theme value", () => {
    const values = new Map<string, string>();
    writeStoredTheme("light", {
      setItem: (key, value) => {
        values.set(key, value);
      },
    });
    expect(values.get(THEME_STORAGE_KEY)).toBe("light");
  });

  it("is best-effort when storage throws", () => {
    expect(() =>
      writeStoredTheme("dark", {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).not.toThrow();
  });
});
