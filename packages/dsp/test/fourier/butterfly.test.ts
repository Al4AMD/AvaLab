import { describe, expect, it } from "vitest";
import type { ButterflyStep } from "../../src/index.js";
import { fftButterflySteps, fftRadix2 } from "../../src/index.js";

function deterministicSignal(length: number): Float64Array {
  const samples = new Float64Array(length);
  for (let n = 0; n < length; n += 1) {
    samples[n] = Math.sin(0.31 * n) + 0.4 * Math.cos(0.07 * n);
  }
  return samples;
}

function replay(
  samples: Float64Array,
  steps: readonly ButterflyStep[],
): { re: Float64Array; im: Float64Array } {
  const length = samples.length;
  const re = new Float64Array(length);
  const im = new Float64Array(length);
  for (let n = 0; n < length; n += 1) {
    let reversed = 0;
    for (let bit = 0; bit < Math.log2(length); bit += 1) {
      reversed = (reversed << 1) | ((n >> bit) & 1);
    }
    re[reversed] = samples[n] ?? 0;
    im[reversed] = 0;
  }
  for (const step of steps) {
    re[step.evenIndex] = step.outputEvenRe;
    im[step.evenIndex] = step.outputEvenIm;
    re[step.oddIndex] = step.outputOddRe;
    im[step.oddIndex] = step.outputOddIm;
  }
  return { re, im };
}

describe("fftButterflySteps", () => {
  it.each([8, 16])("returns N/2 * log2(N) steps for N=%i", (length) => {
    const steps = fftButterflySteps(deterministicSignal(length), new Float64Array(length));
    expect(steps).toHaveLength((length / 2) * Math.log2(length));
  });

  it.each([8, 16])("replays the radix-2 transform for N=%i", (length) => {
    const samples = deterministicSignal(length);
    const expected = fftRadix2(samples);
    const replayed = replay(samples, fftButterflySteps(samples, new Float64Array(length)));
    for (let k = 0; k < length; k += 1) {
      expect(replayed.re[k]).toBeCloseTo(expected.re[k] ?? Number.NaN, 12);
      expect(replayed.im[k]).toBeCloseTo(expected.im[k] ?? Number.NaN, 12);
    }
  });

  it("records stage order and the twiddle factor", () => {
    const steps = fftButterflySteps(deterministicSignal(8), new Float64Array(8));
    expect(steps[0]?.stage).toBe(1);
    expect(steps[0]?.twiddleRe).toBe(1);
    expect(steps[0]?.twiddleIm).toBeCloseTo(0, 12);
    expect(steps.at(-1)?.stage).toBe(3);
  });

  it("rejects non-power-of-two and unsupported sizes", () => {
    expect(() => fftButterflySteps(new Float64Array(6), new Float64Array(6))).toThrow(RangeError);
    expect(() => fftButterflySteps(new Float64Array(32), new Float64Array(32))).toThrow(RangeError);
    expect(() => fftButterflySteps(new Float64Array(2), new Float64Array(2))).toThrow(RangeError);
  });

  it("rejects mismatched or non-finite input", () => {
    expect(() => fftButterflySteps(new Float64Array(8), new Float64Array(7))).toThrow(TypeError);
    const samples = deterministicSignal(8);
    samples[3] = Number.NaN;
    expect(() => fftButterflySteps(samples, new Float64Array(8))).toThrow(TypeError);
  });
});
