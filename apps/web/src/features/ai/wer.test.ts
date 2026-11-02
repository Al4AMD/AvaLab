import { describe, expect, it } from "vitest";

import { normalizeTranscript, wordErrorRate } from "./wer";

describe("normalizeTranscript", () => {
  it("lower-cases, removes punctuation and collapses whitespace", () => {
    expect(normalizeTranscript("  Hello,   WORLD! ")).toBe("hello world");
    expect(normalizeTranscript("Don't — stop.")).toBe("don t stop");
  });
});

describe("wordErrorRate", () => {
  it("is zero for an exact match", () => {
    expect(wordErrorRate("the quick brown fox", "the quick brown fox")).toBe(0);
  });

  it("counts one substitution over the reference length", () => {
    expect(wordErrorRate("the quick brown fox", "the quick brown box")).toBe(0.25);
  });

  it("counts an insertion", () => {
    expect(wordErrorRate("the quick brown fox", "the very quick brown fox")).toBe(0.25);
  });

  it("counts a deletion", () => {
    expect(wordErrorRate("the quick brown fox", "the quick brown")).toBe(0.25);
  });

  it("ignores case and punctuation", () => {
    expect(wordErrorRate("Hello, world!", "hello world")).toBe(0);
  });

  it("throws only for an empty reference", () => {
    expect(() => wordErrorRate("   ", "anything")).toThrow(RangeError);
    expect(() => wordErrorRate("hello", "   ")).not.toThrow();
    expect(wordErrorRate("hello", "   ")).toBe(1);
  });
});
