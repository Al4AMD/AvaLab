import { describe, expect, it } from "vitest";
import {
  applySpectrumCurves,
  fftRadix2,
  ifftRadix2,
  type SpectrumCurveEdit,
} from "../../src/index.js";

function spectrumOf(length: number): { re: Float64Array; im: Float64Array } {
  const samples = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin(0.3 * index) + 0.2 * Math.cos(0.11 * index);
  }
  return fftRadix2(samples);
}

describe("applySpectrumCurves", () => {
  it("sets a constant magnitude across the covered bins and keeps phase", () => {
    const spectrum = spectrumOf(16);
    const phases = Array.from({ length: 16 }, (_, bin) =>
      Math.atan2(spectrum.im[bin] ?? 0, spectrum.re[bin] ?? 0),
    );
    applySpectrumCurves(
      spectrum,
      [
        {
          target: "mag",
          points: [
            { bin: 2, value: 3 },
            { bin: 5, value: 3 },
          ],
        },
      ],
      16,
    );
    for (let bin = 0; bin < 16; bin += 1) {
      const magnitude = Math.hypot(spectrum.re[bin] ?? 0, spectrum.im[bin] ?? 0);
      if (bin < 2 || bin > 5) {
        continue;
      }
      expect(magnitude).toBeCloseTo(3, 12);
      expect(Math.atan2(spectrum.im[bin] ?? 0, spectrum.re[bin] ?? 0)).toBeCloseTo(
        phases[bin] ?? 0,
        12,
      );
    }
  });

  it("holds a two-point curve constant before and after its points", () => {
    const spectrum = spectrumOf(16);
    const before = Float64Array.from(spectrum.re);
    applySpectrumCurves(
      spectrum,
      [
        {
          target: "re",
          points: [
            { bin: 4, value: 1 },
            { bin: 6, value: 1 },
          ],
        },
      ],
      16,
    );
    for (let bin = 0; bin < 16; bin += 1) {
      expect(spectrum.re[bin]).toBeCloseTo(1, 12);
    }
    expect(before[2]).not.toBe(1);
  });

  it("preserves magnitude when setting phase", () => {
    const spectrum = spectrumOf(16);
    const magnitudes = Array.from({ length: 16 }, (_, bin) =>
      Math.hypot(spectrum.re[bin] ?? 0, spectrum.im[bin] ?? 0),
    );
    applySpectrumCurves(
      spectrum,
      [
        {
          target: "phase",
          points: [
            { bin: 0, value: Math.PI / 2 },
            { bin: 15, value: -Math.PI / 2 },
          ],
        },
      ],
      16,
    );
    for (let bin = 0; bin < 16; bin += 1) {
      expect(Math.hypot(spectrum.re[bin] ?? 0, spectrum.im[bin] ?? 0)).toBeCloseTo(
        magnitudes[bin] ?? 0,
        12,
      );
    }
  });

  it("round-trips re/im edits through the inverse transform", () => {
    const spectrum = spectrumOf(16);
    applySpectrumCurves(
      spectrum,
      [
        {
          target: "re",
          points: [
            { bin: 1, value: 0.25 },
            { bin: 14, value: 0.25 },
          ],
        },
        {
          target: "im",
          points: [
            { bin: 2, value: -0.5 },
            { bin: 13, value: 0.5 },
          ],
        },
      ],
      16,
    );
    const samples = ifftRadix2(spectrum);
    expect(samples).toHaveLength(16);
    expect(samples.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("keeps the last value for duplicate bins and sorts unsorted points", () => {
    const spectrum = {
      re: new Float64Array([0, 0, 0, 0]),
      im: new Float64Array(4),
    };
    const curve: SpectrumCurveEdit = {
      target: "re",
      points: [
        { bin: 2, value: 7 },
        { bin: 0, value: 1 },
        { bin: 2, value: 5 },
        { bin: 3, value: 9 },
      ],
    };
    applySpectrumCurves(spectrum, [curve], 4);
    expect(Array.from(spectrum.re)).toEqual([1, 3, 5, 9]);
  });

  it("clamps negative magnitude to zero", () => {
    const spectrum = {
      re: new Float64Array([1, 1]),
      im: new Float64Array([0, 0]),
    };
    applySpectrumCurves(
      spectrum,
      [
        {
          target: "mag",
          points: [
            { bin: 0, value: -3 },
            { bin: 1, value: -3 },
          ],
        },
      ],
      2,
    );
    expect(Array.from(spectrum.re)).toEqual([0, 0]);
  });

  it("rejects bad curves, points and bin bounds", () => {
    const spectrum = { re: new Float64Array(4), im: new Float64Array(4) };
    const bad =
      (curves: readonly SpectrumCurveEdit[]): (() => void) =>
      () =>
        applySpectrumCurves(spectrum, curves, 4);
    expect(bad([{ target: "re", points: [{ bin: 0, value: 0 }] }])).toThrow(RangeError);
    expect(
      bad([
        {
          target: "wat" as SpectrumCurveEdit["target"],
          points: [
            { bin: 0, value: 0 },
            { bin: 1, value: 1 },
          ],
        },
      ]),
    ).toThrow(RangeError);
    expect(
      bad([
        {
          target: "re",
          points: [
            { bin: 0, value: Number.NaN },
            { bin: 1, value: 1 },
          ],
        },
      ]),
    ).toThrow(RangeError);
    expect(
      bad([
        {
          target: "re",
          points: [
            { bin: 0, value: 0 },
            { bin: 4, value: 1 },
          ],
        },
      ]),
    ).toThrow(RangeError);
    expect(
      bad(
        Array.from({ length: 9 }, () => ({
          target: "re" as const,
          points: [
            { bin: 0, value: 0 },
            { bin: 1, value: 1 },
          ],
        })),
      ),
    ).toThrow(RangeError);
  });
});
