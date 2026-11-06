import { describe, expect, it } from "vitest";
import { formatLufs, matchGainDb } from "./loudnessMath";

describe("matchGainDb", () => {
  it("returns the original-minus-processed gain", () => {
    expect(matchGainDb(-10, -20)).toBe(10);
    expect(matchGainDb(-20, -10)).toBe(-10);
    expect(matchGainDb(-23, -23)).toBe(0);
  });

  it("clamps to the playback gain range and ignores non-finite input", () => {
    expect(matchGainDb(0, -40)).toBe(24);
    expect(matchGainDb(-40, 0)).toBe(-24);
    expect(matchGainDb(Number.NaN, -20)).toBe(0);
    expect(matchGainDb(-20, Number.POSITIVE_INFINITY)).toBe(0);
    expect(matchGainDb(Number.NEGATIVE_INFINITY, -20)).toBe(0);
  });
});

describe("formatLufs", () => {
  it("formats finite values to one decimal with the LUFS unit", () => {
    expect(formatLufs(-23.04)).toBe("-23.0 LUFS");
    expect(formatLufs(-19.96)).toBe("-20.0 LUFS");
  });

  it("uses an em dash for silence and non-finite values", () => {
    expect(formatLufs(Number.NEGATIVE_INFINITY)).toBe("—");
    expect(formatLufs(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatLufs(Number.NaN)).toBe("—");
  });
});
