import { describe, expect, it } from "vitest";
import { samplesToSeconds, secondsToSamples } from "../src/index.js";

describe("samplesToSeconds", () => {
  it("converts 48000 samples at 48 kHz to 1 second", () => {
    expect(samplesToSeconds(48000, 48000)).toBe(1);
  });

  it("converts 0 samples to 0 seconds", () => {
    expect(samplesToSeconds(0, 48000)).toBe(0);
  });

  it("throws RangeError when sampleRateHz is 0", () => {
    expect(() => samplesToSeconds(100, 0)).toThrow(RangeError);
  });

  it("throws RangeError for negative or non-finite sample rates", () => {
    expect(() => samplesToSeconds(100, -48000)).toThrow(RangeError);
    expect(() => samplesToSeconds(100, Number.NaN)).toThrow(RangeError);
    expect(() => samplesToSeconds(100, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("secondsToSamples", () => {
  it("converts 1 second at 48 kHz to 48000 samples", () => {
    expect(secondsToSamples(1, 48000)).toBe(48000);
  });

  it("rounds to the nearest integer sample", () => {
    expect(secondsToSamples(1 / 48000, 48000)).toBe(1);
    expect(secondsToSamples(1.000004, 48000)).toBe(48000);
  });

  it("throws RangeError when sampleRateHz is 0", () => {
    expect(() => secondsToSamples(1, 0)).toThrow(RangeError);
  });
});

describe("round trip", () => {
  it("recovers the sample count for 20 seeded-random counts", () => {
    let state = 0x2f6e2b1;
    const nextRandom = (): number => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state;
    };
    const sampleRateHz = 48000;
    for (let i = 0; i < 20; i += 1) {
      const sampleCount = nextRandom() % 10_000_000;
      const roundTripped = secondsToSamples(
        samplesToSeconds(sampleCount, sampleRateHz),
        sampleRateHz,
      );
      expect(roundTripped).toBe(sampleCount);
    }
  });

  it("recovers 12345 samples at 48 kHz exactly", () => {
    expect(secondsToSamples(samplesToSeconds(12345, 48000), 48000)).toBe(12345);
  });
});
