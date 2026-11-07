import { describe, expect, it, vi } from "vitest";

import { readLastUsed, writeLastUsed } from "./lastUsed";

describe("last-used storage", () => {
  it("reads and writes through the injected storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    writeLastUsed("avalab.test.last", "a=1", storage);
    expect(readLastUsed("avalab.test.last", storage)).toBe("a=1");
    expect(readLastUsed("avalab.missing.last", storage)).toBeNull();
  });

  it("is total when storage throws and never writes an empty value", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("quota");
      }),
    };
    expect(readLastUsed("avalab.test.last", storage)).toBeNull();
    expect(() => writeLastUsed("avalab.test.last", "a=1", storage)).not.toThrow();
    expect(() => writeLastUsed("avalab.test.last", "", storage)).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
});
