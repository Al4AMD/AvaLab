import { describe, expect, it } from "vitest";
import {
  alawDecode,
  alawEncode,
  type CompandingOptions,
  generateSine,
  mulawDecode,
  mulawEncode,
  quantizeUniform,
  snrDb,
} from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("companding");

type Codec = "mulaw" | "alaw";

function paramString(goldenCase: GoldenCase, key: string): string {
  const value = goldenCase.params[key];
  if (typeof value !== "string") {
    throw new Error(`params.${key} of ${goldenCase.name} is not a string`);
  }
  return value;
}

function codecOf(goldenCase: GoldenCase): Codec {
  const codec = paramString(goldenCase, "codec");
  if (codec !== "mulaw" && codec !== "alaw") {
    throw new Error(`unknown codec "${codec}" in ${goldenCase.name}`);
  }
  return codec;
}

function encodeFor(codec: Codec, samples: Float64Array): Uint8Array {
  return codec === "mulaw" ? mulawEncode(samples, { bits: 8 }) : alawEncode(samples, { bits: 8 });
}

function decodeFor(codec: Codec, bytes: Uint8Array): Float64Array {
  return codec === "mulaw" ? mulawDecode(bytes) : alawDecode(bytes);
}

function expectedEncodedOf(goldenCase: GoldenCase): number[] {
  return asNumberArray(
    goldenCase.expected.encodedBytes,
    `expected.encodedBytes of ${goldenCase.name}`,
  );
}

function expectedDecodedOf(goldenCase: GoldenCase): number[] {
  return asNumberArray(
    goldenCase.expected.decodedSamples,
    `expected.decodedSamples of ${goldenCase.name}`,
  );
}

function expectSamplesClose(
  actual: Float64Array,
  expected: readonly number[],
  tolerance: { rtol: number; atol: number },
  label: string,
): void {
  expect(actual.length).toBe(expected.length);
  for (let n = 0; n < expected.length; n += 1) {
    const actualSample = actual[n] ?? Number.NaN;
    const expectedSample = expected[n] ?? Number.NaN;
    const difference = Math.abs(actualSample - expectedSample);
    const allowed = tolerance.atol + tolerance.rtol * Math.abs(expectedSample);
    expect(
      difference,
      `${label}[${n}]: |${actualSample} - ${expectedSample}| = ${difference} exceeds ${allowed}`,
    ).toBeLessThanOrEqual(allowed);
  }
}

/** Decoded int16 reconstruction (exact: every decoded value is k/32768). */
function codebook(codec: Codec): Int32Array {
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  const decoded = decodeFor(codec, bytes);
  const values = new Int32Array(256);
  for (let code = 0; code < 256; code += 1) {
    values[code] = Math.round((decoded[code] ?? Number.NaN) * 32768);
  }
  return values;
}

function uniqueMagnitudes(values: Int32Array, positive: boolean): number[] {
  const magnitudes = new Set<number>();
  for (const value of values) {
    if (positive ? value >= 0 : value < 0) {
      magnitudes.add(Math.abs(value));
    }
  }
  return [...magnitudes].sort((first, second) => first - second);
}

function stepForMagnitude(sortedMagnitudes: readonly number[], magnitude: number): number {
  const index = sortedMagnitudes.indexOf(magnitude);
  const lower = index > 0 ? magnitude - (sortedMagnitudes[index - 1] ?? magnitude) : 0;
  const upper =
    index >= 0 && index < sortedMagnitudes.length - 1
      ? (sortedMagnitudes[index + 1] ?? magnitude) - magnitude
      : 0;
  return Math.max(lower, upper);
}

/**
 * Code step around each code's reconstruction value, measured on the sorted
 * magnitude axis. G.711's even-bit inversion permutes byte codes, so code order
 * is NOT magnitude order; sorting is required.
 */
function localCodeSteps(values: Int32Array): Float64Array {
  const positives = uniqueMagnitudes(values, true);
  const negatives = uniqueMagnitudes(values, false);
  const steps = new Float64Array(256);
  for (let code = 0; code < 256; code += 1) {
    const value = values[code] ?? 0;
    const sorted = value >= 0 ? positives : negatives;
    steps[code] = stepForMagnitude(sorted, Math.abs(value));
  }
  return steps;
}

function smallestMagnitudeStep(values: Int32Array): number {
  const magnitudes = [
    ...new Set([...uniqueMagnitudes(values, true), ...uniqueMagnitudes(values, false)]),
  ].sort((first, second) => first - second);
  let smallest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < magnitudes.length; index += 1) {
    const previous = magnitudes[index - 1] ?? 0;
    const current = magnitudes[index] ?? 0;
    smallest = Math.min(smallest, current - previous);
  }
  return smallest;
}

describe("companding fixture", () => {
  it("loads the committed companding fixture with the pinned cases", () => {
    expect(golden.algorithm).toBe("companding");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "companding_ramp16_mulaw",
      "companding_ramp16_alaw",
      "companding_sine8_mulaw",
      "companding_sine8_alaw",
    ]);
  });

  it("pins bits = 8, both codecs and the 16-bit decode tolerance", () => {
    for (const goldenCase of golden.cases) {
      expect(asNumber(goldenCase.params.bits, `params.bits of ${goldenCase.name}`)).toBe(8);
      expect(goldenCase.tolerance).toEqual({ rtol: 1e-6, atol: 1e-12 });
    }
  });
});

describe("mu-law/A-law encoders and decoders (golden)", () => {
  for (const goldenCase of golden.cases) {
    it(`matches exact audioop bytes and decoded samples for ${goldenCase.name}`, () => {
      const codec = codecOf(goldenCase);
      const samples = Float64Array.from(goldenCase.input.samples);
      const encoded = encodeFor(codec, samples);
      const expectedEncoded = expectedEncodedOf(goldenCase);
      expect(Array.from(encoded)).toEqual(expectedEncoded);

      // Decode the audioop bytes directly so the decoder is verified
      // independently of the TypeScript encoder.
      const decoded = decodeFor(codec, Uint8Array.from(expectedEncoded));
      expectSamplesClose(
        decoded,
        expectedDecodedOf(goldenCase),
        goldenCase.tolerance,
        goldenCase.name,
      );

      const roundTripped = decodeFor(codec, encoded);
      expectSamplesClose(
        roundTripped,
        expectedDecodedOf(goldenCase),
        goldenCase.tolerance,
        `${goldenCase.name} roundtrip`,
      );
    });
  }
});

describe("G.711 bit patterns", () => {
  it("pins the full-scale and zero codes of both codecs", () => {
    expect(Array.from(mulawEncode(Float64Array.from([1]), { bits: 8 }))).toEqual([0x80]);
    expect(Array.from(mulawEncode(Float64Array.from([-1]), { bits: 8 }))).toEqual([0x00]);
    expect(Array.from(mulawEncode(Float64Array.from([0]), { bits: 8 }))).toEqual([0xff]);

    // A-law includes the G.711 even-bit inversion (zero -> 0xD5).
    expect(Array.from(alawEncode(Float64Array.from([1]), { bits: 8 }))).toEqual([0xaa]);
    expect(Array.from(alawEncode(Float64Array.from([-1]), { bits: 8 }))).toEqual([0x2a]);
    expect(Array.from(alawEncode(Float64Array.from([0]), { bits: 8 }))).toEqual([0xd5]);

    expect(mulawDecode(Uint8Array.from([0xff]))[0]).toBe(0);
    // A-law's first positive code reconstructs 8/32768, not zero.
    expect(alawDecode(Uint8Array.from([0xd5]))[0]).toBe(8 / 32768);
  });
});

describe("roundtrip error bounds", () => {
  it("keeps mu-law within one local code step and A-law within half a step", () => {
    // The standard G.711 mu-law encoder truncates the magnitude (right shift
    // by 2 and an arithmetic shift for the sign), so negative samples can be
    // nearly one code step away from the decoded value. A-law's -pcm-1 mapping
    // is symmetric and meets the half-step bound. Measured over all 65 536
    // int16 inputs: mu-law max ratio 0.875 (max error 644/32768 at -32768),
    // A-law max ratio 0.5 (max error 512/32768). The plan's "2^-8 of full
    // scale" figure is not attainable by an 8-bit logarithmic codec: the top
    // segment step is 1024/32768 = 2^-5, so half a step is 2^-6.
    const muValues = codebook("mulaw");
    const aValues = codebook("alaw");
    const muSteps = localCodeSteps(muValues);
    const aSteps = localCodeSteps(aValues);
    let muMaxRatio = 0;
    let muMaxError = 0;
    let aMaxRatio = 0;
    let aMaxError = 0;

    for (let sample = -32768; sample <= 32767; sample += 1) {
      const input = Float64Array.from([sample / 32768]);
      const muCode = mulawEncode(input, { bits: 8 })[0] ?? 0;
      const aCode = alawEncode(input, { bits: 8 })[0] ?? 0;
      const muError = Math.abs(sample - (muValues[muCode] ?? 0));
      const aError = Math.abs(sample - (aValues[aCode] ?? 0));
      muMaxRatio = Math.max(muMaxRatio, muError / (muSteps[muCode] ?? 1));
      aMaxRatio = Math.max(aMaxRatio, aError / (aSteps[aCode] ?? 1));
      muMaxError = Math.max(muMaxError, muError);
      aMaxError = Math.max(aMaxError, aError);
    }

    expect(muMaxRatio, `mu-law max error/step = ${muMaxRatio}`).toBeLessThanOrEqual(1);
    expect(muMaxError, `mu-law max error = ${muMaxError}/32768`).toBe(644);
    expect(aMaxRatio, `A-law max error/step = ${aMaxRatio}`).toBeLessThanOrEqual(0.5);
    expect(aMaxError, `A-law max error = ${aMaxError}/32768`).toBe(512);
  });

  it("gives finer steps near zero than uniform 8-bit PCM", () => {
    const muStepNearZero = smallestMagnitudeStep(codebook("mulaw"));
    const aStepNearZero = smallestMagnitudeStep(codebook("alaw"));
    const uniformEightBitStep = 32768 * (2 / (2 ** 8 - 1));

    expect(muStepNearZero).toBe(8);
    expect(aStepNearZero).toBe(16);
    expect(muStepNearZero).toBeLessThan(uniformEightBitStep);
    expect(aStepNearZero).toBeLessThan(uniformEightBitStep);
  });
});

describe("mu-law small-signal SNR", () => {
  it("beats uniform 8-bit quantization by at least 8 dB on a -40 dBFS sine", () => {
    // Comparable conditions: the same 1 kHz tone at 48 kHz, both quantizers at
    // 8 bits. Uniform quantization uses Task 6's mid-tread quantizer with
    // Δ = 2/255; mu-law uses this module's G.711 encoder/decoder. At
    // -40 dBFS the tone RMS is 0.00707, below three uniform 8-bit steps, while
    // mu-law steps near zero are 8/32768 = 2^-12 of full scale.
    const reference = generateSine({
      durationSeconds: 1,
      sampleRateHz: 48000,
      frequencyHz: 1000,
      amplitude: 10 ** (-40 / 20),
    });
    const uniformSnrDb = snrDb(reference, quantizeUniform(reference, { bits: 8 }));
    const mulawSnrDb = snrDb(reference, mulawDecode(mulawEncode(reference, { bits: 8 })));

    expect(
      mulawSnrDb - uniformSnrDb,
      `mu-law ${mulawSnrDb} dB vs uniform 8-bit ${uniformSnrDb} dB`,
    ).toBeGreaterThanOrEqual(8);
  });
});

describe("companding contracts", () => {
  it("preserves length for encode and decode, including empty input", () => {
    const input = Float64Array.from([-0.5, -0.25, 0, 0.25, 0.5]);
    for (const codec of ["mulaw", "alaw"] as const) {
      const encoded = encodeFor(codec, input);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded).toHaveLength(input.length);
      expect(decodeFor(codec, encoded)).toHaveLength(input.length);
      expect(encodeFor(codec, new Float64Array(0))).toHaveLength(0);
      expect(decodeFor(codec, new Uint8Array(0))).toHaveLength(0);
    }
  });

  it("clips |x| > 1 before encoding (documented, not an error)", () => {
    const extreme = Float64Array.from([-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]);
    const clipped = Float64Array.from([-1, -1, -1, -0.5, 0, 0.5, 1, 1, 1]);
    for (const codec of ["mulaw", "alaw"] as const) {
      expect(Array.from(encodeFor(codec, extreme))).toEqual(Array.from(encodeFor(codec, clipped)));
      for (const sample of decodeFor(codec, encodeFor(codec, extreme))) {
        expect(sample).toBeGreaterThanOrEqual(-1);
        expect(sample).toBeLessThanOrEqual(1);
      }
    }
  });

  it("accepts every byte value on decode and returns values in [−1, 1]", () => {
    const allBytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    for (const codec of ["mulaw", "alaw"] as const) {
      const decoded = decodeFor(codec, allBytes);
      expect(decoded).toHaveLength(256);
      for (const sample of decoded) {
        expect(sample).toBeGreaterThanOrEqual(-1);
        expect(sample).toBeLessThanOrEqual(1);
      }
    }
  });

  it("does not mutate the input and returns fresh arrays", () => {
    const input = Float64Array.from([0.1, -0.2, 0.3]);
    const copy = Float64Array.from(input);
    for (const codec of ["mulaw", "alaw"] as const) {
      const encoded = encodeFor(codec, input);
      expect(encoded).not.toBe(input);
      expect(Array.from(input)).toEqual(Array.from(copy));
      const encodedCopy = Uint8Array.from(encoded);
      const decoded = decodeFor(codec, encoded);
      expect(Array.from(encoded)).toEqual(Array.from(encodedCopy));
      expect(decoded).not.toBe(encoded);
    }
  });

  it("rejects any bits value other than 8 with RangeError", () => {
    const input = Float64Array.from([0.25]);
    for (const bits of [0, 1, 7, 16, 8.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const options = { bits } as unknown as CompandingOptions;
      expect(() => mulawEncode(input, options)).toThrow(RangeError);
      expect(() => alawEncode(input, options)).toThrow(RangeError);
    }
    expect(() => mulawEncode(input, undefined as unknown as CompandingOptions)).toThrow(RangeError);
    expect(() => alawEncode(input, undefined as unknown as CompandingOptions)).toThrow(RangeError);
  });

  it("throws TypeError on non-finite samples (R6)", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => mulawEncode(Float64Array.from([0.5, bad]), { bits: 8 })).toThrow(TypeError);
      expect(() => alawEncode(Float64Array.from([0.5, bad]), { bits: 8 })).toThrow(TypeError);
    }
  });
});
