import { describe, expect, it } from "vitest";
import { imdct, type MdctParams, mdct, mulberry32 } from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("mdct");

function expectClose(
  actual: number,
  expected: number,
  tolerance: { rtol: number; atol: number },
  label: string,
): void {
  const difference = Math.abs(actual - expected);
  const allowed = tolerance.atol + tolerance.rtol * Math.abs(expected);
  expect(
    difference,
    `${label}: |${actual} - ${expected}| = ${difference} exceeds ${allowed}`,
  ).toBeLessThanOrEqual(allowed);
}

function paramNumber(goldenCase: GoldenCase, key: string): number {
  return asNumber(goldenCase.params[key], `params.${key} of ${goldenCase.name}`);
}

function paramsForCase(goldenCase: GoldenCase): MdctParams {
  return { frameLengthSamples: paramNumber(goldenCase, "frame_length_samples") };
}

describe("mdct golden fixtures", () => {
  for (const goldenCase of golden.cases) {
    it(`transforms ${goldenCase.name} like the golden vectors`, () => {
      const samples = new Float64Array(asNumberArray(goldenCase.input.samples, "samples"));
      const coefficients = asNumberArray(goldenCase.expected.coefficients, "coefficients");
      const voiced = mdct(samples, paramsForCase(goldenCase));

      const hop = paramNumber(goldenCase, "hop_length_samples");
      expect(voiced.hopLengthSamples).toBe(hop);
      expect(voiced.frameLengthSamples).toBe(hop * 2);
      expect(voiced.coefficients.length * hop).toBe(coefficients.length);
      for (let index = 0; index < coefficients.length; index += 1) {
        const frameIndex = Math.floor(index / hop);
        const bin = index % hop;
        const frame: Float64Array | undefined = voiced.coefficients[frameIndex];
        if (frame === undefined) {
          throw new Error(`fixture ${goldenCase.name}: frame ${frameIndex} missing`);
        }
        const actual: number | undefined = frame[bin];
        if (actual === undefined) {
          throw new Error(`fixture ${goldenCase.name}: bin ${bin} missing`);
        }
        const expectedCoefficient: number | undefined = coefficients[index];
        if (expectedCoefficient === undefined) {
          throw new Error(`fixture ${goldenCase.name}: coefficient ${index} missing`);
        }
        expectClose(
          actual,
          expectedCoefficient,
          goldenCase.tolerance,
          `${goldenCase.name} coefficient [${frameIndex}, ${bin}]`,
        );
      }
    });

    it(`round-trips ${goldenCase.name} through imdct`, () => {
      const samples = new Float64Array(asNumberArray(goldenCase.input.samples, "samples"));
      const forward = mdct(samples, paramsForCase(goldenCase));
      const reconstruction = imdct(forward.coefficients, paramsForCase(goldenCase));
      const expectedLength = (forward.coefficients.length - 1) * forward.hopLengthSamples;
      expect(reconstruction.length).toBe(expectedLength);

      const reconstructionGolden = asNumberArray(
        goldenCase.expected.reconstruction,
        "reconstruction",
      );
      expect(reconstruction.length).toBe(reconstructionGolden.length);
      for (let index = 0; index < reconstructionGolden.length; index += 1) {
        const actual: number | undefined = reconstruction[index];
        if (actual === undefined) {
          throw new Error(`fixture ${goldenCase.name}: reconstruction[${index}] missing`);
        }
        const expectedSample: number | undefined = reconstructionGolden[index];
        if (expectedSample === undefined) {
          throw new Error(`fixture ${goldenCase.name}: reconstruction ${index} missing`);
        }
        expectClose(
          actual,
          expectedSample,
          goldenCase.tolerance,
          `${goldenCase.name} reconstruction[${index}]`,
        );
      }
    });
  }
});

describe("mdct perfect reconstruction properties", () => {
  it("round-trips a seeded random edge-tail signal to <= 1e-10", () => {
    const random = mulberry32(2026);
    const length = 4096;
    const samples = new Float64Array(length);
    for (let n = 0; n < length; n += 1) {
      samples[n] = random() * 2 - 1;
    }
    for (const frameLengthSamples of [512, 1024]) {
      const forward = mdct(samples, { frameLengthSamples });
      const backward = imdct(forward.coefficients, { frameLengthSamples });
      expect(backward.length).toBe(
        Math.ceil(length / (frameLengthSamples / 2)) * (frameLengthSamples / 2),
      );
      let maxError = 0;
      for (let n = 0; n < length; n += 1) {
        const sample: number | undefined = samples[n];
        const reconstructed: number | undefined = backward[n];
        if (sample === undefined || reconstructed === undefined) {
          throw new Error(`sample ${n} missing`);
        }
        maxError = Math.max(maxError, Math.abs(reconstructed - sample));
      }
      expect(maxError).toBeLessThanOrEqual(1e-10);
    }
  });

  it("round-trips the minimum frame length on a non-multiple length", () => {
    const random = mulberry32(7);
    const samples = new Float64Array(11);
    for (let n = 0; n < samples.length; n += 1) {
      samples[n] = random() * 2 - 1;
    }
    const forward = mdct(samples, { frameLengthSamples: 4 });
    const backward = imdct(forward.coefficients, { frameLengthSamples: 4 });
    expect(forward.hopLengthSamples).toBe(2);
    expect(forward.coefficients.length).toBe(7);
    expect(backward.length).toBe(12);
    for (let n = 0; n < samples.length; n += 1) {
      const sample: number | undefined = samples[n];
      const reconstructed: number | undefined = backward[n];
      if (sample === undefined || reconstructed === undefined) {
        throw new Error(`sample ${n} missing`);
      }
      expect(Math.abs(reconstructed - sample)).toBeLessThanOrEqual(1e-10);
    }
    for (let n = samples.length; n < backward.length; n += 1) {
      const tail: number | undefined = backward[n];
      if (tail === undefined) {
        throw new Error(`tail sample ${n} missing`);
      }
      // The theory cancels the cross terms exactly; floating point leaves ulps.
      expect(Math.abs(tail)).toBeLessThanOrEqual(1e-10);
    }
  });

  it("round-trips an exact-multiple length with a precise imdct output size", () => {
    const samples = new Float64Array(96);
    for (let n = 0; n < samples.length; n += 1) {
      samples[n] = Math.sin((2 * Math.PI * (n + 0.5)) / 96);
    }
    const forward = mdct(samples, { frameLengthSamples: 32 });
    const backward = imdct(forward.coefficients, { frameLengthSamples: 32 });
    expect(forward.coefficients.length).toBe(96 / 16 + 1);
    expect(backward.length).toBe(96);
    for (let n = 0; n < samples.length; n += 1) {
      const sample: number | undefined = samples[n];
      const reconstructed: number | undefined = backward[n];
      if (sample === undefined || reconstructed === undefined) {
        throw new Error(`sample ${n} missing`);
      }
      expect(Math.abs(reconstructed - sample)).toBeLessThanOrEqual(1e-10);
    }
  });

  it("round-trips constant and point-impulse signals exactly enough", () => {
    const dc = new Float64Array(300).fill(0.25);
    const impulse = new Float64Array(300);
    impulse[0] = 1;
    impulse[255] = 1;
    for (const samples of [dc, impulse]) {
      const forward = mdct(samples, { frameLengthSamples: 512 });
      const backward = imdct(forward.coefficients, { frameLengthSamples: 512 });
      for (let n = 0; n < samples.length; n += 1) {
        const sample: number | undefined = samples[n];
        const reconstructed: number | undefined = backward[n];
        if (sample === undefined || reconstructed === undefined) {
          throw new Error(`sample ${n} missing`);
        }
        expect(Math.abs(reconstructed - sample)).toBeLessThanOrEqual(1e-10);
      }
      for (let n = samples.length; n < backward.length; n += 1) {
        const tail: number | undefined = backward[n];
        if (tail === undefined) {
          throw new Error(`tail sample ${n} missing`);
        }
        // Same rationale: cancellation is exact in algebra, ulps in floats.
        expect(Math.abs(tail)).toBeLessThanOrEqual(1e-10);
      }
    }
  });
});

describe("mdct and imdct guards", () => {
  it("returns empty coefficients for empty input in both directions", () => {
    const forward = mdct(new Float64Array(0), { frameLengthSamples: 512 });
    expect(forward.coefficients).toEqual([]);
    expect(forward.frameLengthSamples).toBe(512);
    expect(forward.hopLengthSamples).toBe(256);
    expect(imdct([], { frameLengthSamples: 512 })).toEqual(new Float64Array(0));
  });

  it("rejects invalid frame lengths", () => {
    expect(() => mdct(new Float64Array(8), { frameLengthSamples: 3 })).toThrow(RangeError);
    expect(() => mdct(new Float64Array(8), { frameLengthSamples: 2 })).toThrow(RangeError);
    // Any even integer >= 4 is valid, including odd hops such as 6 -> hop 3.
    expect(() => mdct(new Float64Array(8), { frameLengthSamples: 6 })).not.toThrow();
    expect(() => imdct([new Float64Array(4)], { frameLengthSamples: 5.5 })).toThrow(RangeError);
  });

  it("rejects non-finite samples and coefficients", () => {
    const withNaN = new Float64Array(8);
    withNaN[3] = Number.NaN;
    expect(() => mdct(withNaN, { frameLengthSamples: 4 })).toThrow(TypeError);
    const withInfinity = new Float64Array(8);
    withInfinity[3] = Number.POSITIVE_INFINITY;
    expect(() => mdct(withInfinity, { frameLengthSamples: 4 })).toThrow(TypeError);
    const coefficients = new Float64Array(3);
    coefficients[1] = Number.NEGATIVE_INFINITY;
    expect(() => imdct([coefficients], { frameLengthSamples: 6 })).toThrow(TypeError);
  });

  it("rejects coefficient frames with the wrong length", () => {
    expect(() => imdct([new Float64Array(3)], { frameLengthSamples: 8 })).toThrow(RangeError);
    expect(() =>
      imdct([new Float64Array(4), new Float64Array(5)], { frameLengthSamples: 8 }),
    ).toThrow(RangeError);
    imdct([new Float64Array(4)], { frameLengthSamples: 8 });
  });

  it("never mutates the input buffers", () => {
    const samples = new Float64Array([1, -2, 3, -4, 5, -6, 7, -8]);
    const samplesCopy = Float64Array.from(samples);
    const forward = mdct(samples, { frameLengthSamples: 8 });
    const coefficientsCopy = forward.coefficients.map((frame) => Float64Array.from(frame));
    imdct(forward.coefficients, { frameLengthSamples: 8 });
    expect(samples).toEqual(samplesCopy);
    for (let frameIndex = 0; frameIndex < forward.coefficients.length; frameIndex += 1) {
      const frame: Float64Array | undefined = forward.coefficients[frameIndex];
      const stored: Float64Array | undefined = coefficientsCopy[frameIndex];
      if (frame === undefined || stored === undefined) {
        throw new Error(`frame ${frameIndex} missing`);
      }
      expect(frame).toEqual(stored);
    }
  });
});
