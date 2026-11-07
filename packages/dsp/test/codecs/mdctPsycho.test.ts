import { describe, expect, it } from "vitest";
import {
  decodeMdctPsycho,
  encodeMdctPsycho,
  generateSine,
  imdct,
  type MdctPsychoEncoded,
  measureReferencePower,
} from "../../src/index.js";
import { asNumber, loadGolden } from "../fixtures.js";

const golden = loadGolden("psychoacoustics");
const fs = 48000;
const frame = 512;
const hop = frame / 2;

function sineSamples(amplitude = 0.8): Float32Array {
  return Float32Array.from(
    generateSine({ durationSeconds: 1, sampleRateHz: fs, frequencyHz: 440, amplitude }),
  );
}

function silenceSamples(): Float32Array {
  return new Float32Array(fs);
}

function encode(samples: Float32Array, referenceSplDb = 94): MdctPsychoEncoded {
  return encodeMdctPsycho(samples, {
    sampleRateHz: fs,
    frameLengthSamples: frame,
    bitsPerSecond: 128000,
    referenceSplDb,
  });
}

function reconstruct(encoded: MdctPsychoEncoded): Float32Array {
  const frames = encoded.coefficients.map((frameCoefficients, frameIndex) =>
    Float64Array.from(frameCoefficients, (q, bin) => {
      const bandSteps = encoded.bandSteps[frameIndex];
      if (bandSteps === undefined) {
        throw new Error(`missing band steps for frame ${frameIndex}`);
      }
      const band = Math.min(bandSteps.length - 1, Math.floor((bin * bandSteps.length) / hop));
      return q * (bandSteps[band] ?? 0);
    }),
  );
  return Float32Array.from(imdct(frames, { frameLengthSamples: frame }));
}

describe("measureReferencePower", () => {
  it("matches the Python reference measured through the same MDCT", () => {
    const goldenCase = golden.cases.find(
      (candidate) => candidate.name === "band_levels_48k_frame512",
    );
    if (goldenCase === undefined) {
      throw new Error("missing band_levels_48k_frame512");
    }
    const expected = asNumber(goldenCase.params.reference_power, "reference_power");
    const actual = measureReferencePower(fs, frame);
    expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(1e-9);
  });

  it("is deterministic and rejects invalid rates/frame lengths", () => {
    expect(measureReferencePower(fs, frame)).toBe(measureReferencePower(fs, frame));
    expect(() => measureReferencePower(0, frame)).toThrow(RangeError);
    expect(() => measureReferencePower(fs, 3)).toThrow(RangeError);
    expect(() => measureReferencePower(fs, 63)).toThrow(RangeError);
  });
});

describe("encodeMdctPsycho", () => {
  it("is deterministic for the same input", () => {
    const first = encode(sineSamples());
    const second = encode(sineSamples());
    expect(Array.from(first.bits)).toEqual(Array.from(second.bits));
    expect(Array.from(first.bandSteps[0] ?? [])).toEqual(Array.from(second.bandSteps[0] ?? []));
    expect(Array.from(first.coefficients[0] ?? [])).toEqual(
      Array.from(second.coefficients[0] ?? []),
    );
  });

  it("reports entropy, side info and total bits consistently", () => {
    const encoded = encode(sineSamples());
    let frameEntropy = 0;
    for (const stat of encoded.frameStats) {
      expect(stat.totalBits).toBe(stat.entropyBits + stat.sideInfoBits);
      frameEntropy += stat.entropyBits;
    }
    expect(frameEntropy).toBe(encoded.stats.entropyBits);
    expect(encoded.stats.totalBits).toBe(encoded.stats.entropyBits + encoded.stats.sideInfoBits);
    expect(encoded.stats.sideInfoBits).toBe(encoded.coefficients.length * 25 * 16);
    expect(encoded.stats.maskedFraction).toBeGreaterThanOrEqual(0);
    expect(encoded.stats.maskedFraction).toBeLessThanOrEqual(1);
  });

  it("never lets a band step fall below the global rate step", () => {
    const encoded = encode(sineSamples());
    encoded.bandSteps.forEach((steps, frameIndex) => {
      const globalStep = encoded.steps[frameIndex] ?? Number.NaN;
      for (const step of steps) {
        expect(step).toBeGreaterThanOrEqual(globalStep);
        expect(Number.isFinite(step)).toBe(true);
      }
    });
    for (const stat of encoded.frameStats) {
      for (const band of stat.bands) {
        if (band.binCount === 0) {
          expect(band.masked).toBe(false);
        }
      }
    }
  });

  it("handles silence and empty input without NaN", () => {
    const silence = encode(silenceSamples());
    expect(Number.isFinite(silence.stats.maskedFraction)).toBe(true);
    expect(Number.isFinite(silence.stats.totalBits)).toBe(true);
    expect(
      Array.from(decodeMdctPsycho(silence, { sampleRateHz: fs, frameLengthSamples: frame })),
    ).toHaveLength((silence.coefficients.length - 1) * hop);

    const empty = encode(new Float32Array(0));
    expect(empty.coefficients).toEqual([]);
    expect(empty.bandSteps).toEqual([]);
    expect(empty.frameStats).toEqual([]);
    expect(empty.stats).toMatchObject({
      entropyBits: 0,
      sideInfoBits: 0,
      totalBits: 0,
      maskedFraction: 0,
      compressedSizeBytes: 0,
    });
    expect(decodeMdctPsycho(empty, { sampleRateHz: fs, frameLengthSamples: frame })).toHaveLength(
      0,
    );
  });

  it("throws typed errors for invalid input", () => {
    expect(() =>
      encodeMdctPsycho(new Float32Array([Number.NaN]), {
        sampleRateHz: fs,
        frameLengthSamples: frame,
        bitsPerSecond: 128000,
      }),
    ).toThrow(TypeError);
    expect(() =>
      encodeMdctPsycho(new Float32Array(1), {
        sampleRateHz: Number.NaN,
        frameLengthSamples: frame,
        bitsPerSecond: 128000,
      }),
    ).toThrow(RangeError);
    expect(() =>
      encodeMdctPsycho(new Float32Array(1), {
        sampleRateHz: fs,
        frameLengthSamples: frame,
        bitsPerSecond: 128000,
        referenceSplDb: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(RangeError);
  });
});

describe("decodeMdctPsycho", () => {
  it("reproduces the quantized-index reconstruction and exact length", () => {
    const encoded = encode(sineSamples());
    const decoded = decodeMdctPsycho(encoded, { sampleRateHz: fs, frameLengthSamples: frame });
    const expected = reconstruct(encoded);
    expect(decoded.length).toBe((encoded.coefficients.length - 1) * hop);
    expect(expected.length).toBe(decoded.length);
    let maxError = 0;
    for (let index = 0; index < decoded.length; index += 1) {
      maxError = Math.max(maxError, Math.abs((decoded[index] ?? 0) - (expected[index] ?? 0)));
    }
    expect(maxError).toBeLessThanOrEqual(1e-12);
  });

  it("rejects missing band steps", () => {
    const encoded = encode(sineSamples());
    encoded.bandSteps.pop();
    expect(() =>
      decodeMdctPsycho(encoded, { sampleRateHz: fs, frameLengthSamples: frame }),
    ).toThrow(RangeError);
  });
});
