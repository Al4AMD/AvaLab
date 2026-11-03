import { describe, expect, it } from "vitest";

import { DspOpError, type FilterDesignParams, filterDesign } from "./ops";

function params(overrides: Partial<FilterDesignParams> = {}): FilterDesignParams {
  return {
    kind: "fir",
    band: "lowpass",
    cutoffHz: 1_000,
    cutoff2Hz: 2_000,
    order: 4,
    taps: 101,
    window: "hamming",
    rippleDb: 0.5,
    q: Math.SQRT1_2,
    gainDb: 0,
    sampleRateHz: 48_000,
    ...overrides,
  };
}

function dbAt(frequenciesHz: number[], magnitudeDb: number[], targetHz: number): number {
  let bestIndex = 0;
  for (let index = 1; index < frequenciesHz.length; index += 1) {
    if (
      Math.abs((frequenciesHz[index] ?? 0) - targetHz) <
      Math.abs((frequenciesHz[bestIndex] ?? 0) - targetHz)
    ) {
      bestIndex = index;
    }
  }
  return magnitudeDb[bestIndex] ?? Number.NaN;
}

describe("filterDesign", () => {
  it("designs a 1 kHz FIR low-pass with a flat passband and a stopped 8 kHz", () => {
    const result = filterDesign(params());

    expect(result.b).toHaveLength(101);
    expect(result.a).toEqual([1]);
    expect(result.frequenciesHz).toHaveLength(512);
    expect(result.magnitudeDb).toHaveLength(512);
    expect(result.phaseRad).toHaveLength(512);
    expect(result.groupDelaySamples).toHaveLength(512);
    expect(result.impulse).toHaveLength(256);
    expect(result.step).toHaveLength(256);
    expect(result.stable).toBe(true);
    expect(result.delaySamples).toBe(50);

    expect(dbAt(result.frequenciesHz, result.magnitudeDb, 100)).toBeGreaterThan(-1);
    expect(dbAt(result.frequenciesHz, result.magnitudeDb, 100)).toBeLessThan(1);
    expect(dbAt(result.frequenciesHz, result.magnitudeDb, 8_000)).toBeLessThan(-20);
  });

  it("returns a symmetric linear-phase FIR impulse response", () => {
    const result = filterDesign(params({ taps: 33 }));

    for (let index = 0; index < result.b.length; index += 1) {
      expect(result.b[index]).toBeCloseTo(result.b[result.b.length - 1 - index] ?? 0, 12);
    }
    expect(result.zeros.length).toBeGreaterThan(0);
    expect(result.poles).toEqual([]);
  });

  it("designs a stable Butterworth low-pass with poles inside the unit circle", () => {
    const result = filterDesign(params({ kind: "butterworth", order: 4 }));

    expect(result.b.length).toBeGreaterThan(0);
    expect(result.a.length).toBeGreaterThan(0);
    expect(result.poles).toHaveLength(4);
    expect(result.stable).toBe(true);
    for (const pole of result.poles) {
      expect(Math.hypot(pole.re, pole.im)).toBeLessThan(1);
    }
    expect(dbAt(result.frequenciesHz, result.magnitudeDb, 100)).toBeGreaterThan(-3);
  });

  it("designs Chebyshev I and RBJ biquad coefficients", () => {
    const cheby = filterDesign(params({ kind: "chebyshev1", order: 3, rippleDb: 1 }));
    const biquad = filterDesign(params({ kind: "biquad", band: "notch", cutoffHz: 1_000 }));

    expect(cheby.poles).toHaveLength(3);
    expect(cheby.stable).toBe(true);
    expect(biquad.b).toHaveLength(3);
    expect(biquad.a).toHaveLength(3);
    expect(biquad.poles).toHaveLength(2);
    expect(biquad.stable).toBe(true);
    expect(dbAt(biquad.frequenciesHz, biquad.magnitudeDb, 1_000)).toBeLessThan(-30);
  });

  it("omits FIR roots above 33 taps instead of paying the high-degree root solve", () => {
    const small = filterDesign(params({ taps: 33 }));
    const large = filterDesign(params({ taps: 35 }));

    expect(small.zeros).toHaveLength(32);
    expect(large.zeros).toEqual([]);
    expect(large.poles).toEqual([]);
  });

  it("rejects a cutoff outside (0, Nyquist) with badParams", () => {
    expect(() => filterDesign(params({ cutoffHz: 24_000 }))).toThrowError(
      expect.objectContaining({ code: "badParams" }),
    );
    expect(() => filterDesign(params({ cutoffHz: 0 }))).toThrowError(
      expect.objectContaining({ code: "badParams" }),
    );
    expect(() => filterDesign(params({ cutoffHz: Number.NaN }))).toThrowError(
      expect.objectContaining({ code: "badParams" }),
    );
  });

  it("rejects invalid order, tap count, and band combinations", () => {
    expect(() => filterDesign(params({ kind: "butterworth", order: 9 }))).toThrow(DspOpError);
    expect(() => filterDesign(params({ taps: 100 }))).toThrow(DspOpError);
    expect(() => filterDesign(params({ kind: "biquad", band: "bandpass" }))).toThrow(DspOpError);
    expect(() => filterDesign(params({ band: "bandpass", cutoff2Hz: 500 }))).toThrow(DspOpError);
  });
});
