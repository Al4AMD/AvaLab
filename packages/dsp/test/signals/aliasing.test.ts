import { describe, expect, it } from "vitest";
import { aliasFrequencyHz } from "../../src/index.js";

describe("aliasFrequencyHz", () => {
  it("keeps a tone below Nyquist unchanged", () => {
    expect(aliasFrequencyHz(1000, 8000)).toBe(1000);
  });

  it("folds a tone above Nyquist to |f - fs|", () => {
    expect(aliasFrequencyHz(5000, 8000)).toBe(3000);
  });

  it("folds multiple times for tones far above Nyquist", () => {
    expect(aliasFrequencyHz(9000, 8000)).toBe(1000);
    expect(aliasFrequencyHz(21000, 8000)).toBe(3000);
  });

  it("returns Nyquist at exactly fs/2", () => {
    expect(aliasFrequencyHz(4000, 8000)).toBe(4000);
  });

  it("returns DC at exactly fs", () => {
    expect(aliasFrequencyHz(8000, 8000)).toBe(0);
  });

  it("uses the absolute frequency for negative inputs", () => {
    expect(aliasFrequencyHz(-1000, 8000)).toBe(1000);
    expect(aliasFrequencyHz(-5000, 8000)).toBe(3000);
  });

  it("rejects non-finite arguments and non-positive rates", () => {
    expect(() => aliasFrequencyHz(Number.NaN, 8000)).toThrow(RangeError);
    expect(() => aliasFrequencyHz(1000, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => aliasFrequencyHz(1000, 0)).toThrow(RangeError);
    expect(() => aliasFrequencyHz(1000, -8000)).toThrow(RangeError);
  });
});
