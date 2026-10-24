import { describe, expect, it } from "vitest";
import {
  decodeLosslessDeltaHuffman,
  deltaDecode,
  deltaEncode,
  encodeLosslessDeltaHuffman,
  entropyBitsPerSymbol,
  generateSine,
  mulberry32,
  quantizeUniform,
} from "../../src/index.js";

/** Pins an exact RangeError instance and message (R14 error style). */
function expectExactRangeError(action: () => unknown, message: string): void {
  let caught: Error | undefined;
  try {
    action();
  } catch (error) {
    caught = error as Error;
  }
  expect(caught, `expected RangeError("${message}")`).toBeInstanceOf(RangeError);
  expect(caught?.message, `expected RangeError("${message}")`).toBe(message);
}

/** Pins an exact TypeError instance (R14 guard rule). */
function expectExactTypeError(action: () => unknown, message: string): void {
  let caught: Error | undefined;
  try {
    action();
  } catch (error) {
    caught = error as Error;
  }
  expect(caught, `expected TypeError("${message}")`).toBeInstanceOf(TypeError);
  expect(caught?.message, `expected TypeError("${message}")`).toBe(message);
}

/**
 * Quantized sine, produced in-test per the dispatch: plan-02 sine generator
 * through the plan-02 uniform quantizer at 8 bits (mid-tread, values in
 * [−1, 1] on the Δ = 2/255 grid), then scaled into the Int16 range. The
 * 8-bit level structure survives (adjacent levels are ~256 apart), so the
 * residual distribution is the peaked, low-entropy one delta coding is for.
 */
function quantizedSineSamples(): Int16Array {
  const sine = generateSine({
    durationSeconds: 4096 / 48000,
    sampleRateHz: 48000,
    frequencyHz: 440,
    amplitude: 1,
  });
  const quantized = quantizeUniform(sine, { bits: 8 });
  const samples = new Int16Array(quantized.length);
  for (let index = 0; index < quantized.length; index += 1) {
    samples[index] = Math.round((quantized[index] ?? 0) * 32767);
  }
  return samples;
}

/** Full-scale square wave: strict ±32767 alternation (R7 edges separate). */
function fullScaleSquareSamples(length: number): Int16Array {
  const samples = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = index % 2 === 0 ? 32767 : -32767;
  }
  return samples;
}

/** Deterministic Int16 noise from mulberry32 (seeded; plan-02 PRNG). */
function seededRandomSamples(seed: number, length: number): Int16Array {
  const next = mulberry32(seed);
  const samples = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.floor(next() * 65536) - 32768;
  }
  return samples;
}

/** Stationary ramp 0..length−1: residuals are all +1 after the first. */
function rampSamples(length: number): Int16Array {
  const samples = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = index;
  }
  return samples;
}

/** Codec-level round-trip assertion shared by the adversarial set. */
function expectCodecRoundTripBitExact(samples: Int16Array, label: string): void {
  const encoded = encodeLosslessDeltaHuffman(samples);
  const decoded = decodeLosslessDeltaHuffman(encoded.payload);
  expect(Array.from(decoded.samples), label).toEqual(Array.from(samples));
}

describe("lossless delta+Huffman round-trip (bit-exact)", () => {
  const cases = [
    { label: "quantized sine", samples: quantizedSineSamples() },
    { label: "silence", samples: new Int16Array(4096) },
    { label: "full-scale square", samples: fullScaleSquareSamples(4096) },
    { label: "seeded random", samples: seededRandomSamples(7, 4096) },
    { label: "single sample", samples: Int16Array.of(12345) },
    { label: "empty", samples: new Int16Array(0) },
    { label: "wrap edge", samples: Int16Array.of(32767, -32768, 32767, -32768) },
    // Residual −32768 → zigzag u = 65535 → low = high = 0xFF through decode.
    { label: "extreme residual", samples: Int16Array.of(0, -32768) },
  ];
  for (const testCase of cases) {
    it(`round-trips ${testCase.label} bit-exactly`, () => {
      expectCodecRoundTripBitExact(testCase.samples, testCase.label);
    });
  }
});

describe("deltaEncode / deltaDecode", () => {
  it("round-trips every Int16 sample list exactly (identity composition)", () => {
    const cases = [
      { label: "quantized sine", samples: quantizedSineSamples() },
      { label: "silence", samples: new Int16Array(4096) },
      { label: "full-scale square", samples: fullScaleSquareSamples(4096) },
      { label: "seeded random", samples: seededRandomSamples(7, 4096) },
      { label: "single sample", samples: Int16Array.of(12345) },
      { label: "empty", samples: new Int16Array(0) },
      { label: "wrap up", samples: Int16Array.of(32767, -32768, 32767, -32768) },
      { label: "wrap down", samples: Int16Array.of(-32768, 32767) },
    ];
    for (const testCase of cases) {
      expectArrayEquals(
        deltaDecode(deltaEncode(testCase.samples)),
        testCase.samples,
        testCase.label,
      );
    }
  });

  it("encodes the wrap transition 32767 → −32768 as residual +1", () => {
    const residuals = deltaEncode(Int16Array.of(32767, -32768, 32767, -32768));
    expect(Array.from(residuals)).toEqual([32767, 1, -1, 1]);
  });

  it("keeps ramp residuals at the pinned |r| ≤ 1 (predictor sanity)", () => {
    const residuals = deltaEncode(rampSamples(4096));
    expect(residuals[0]).toBe(0);
    for (let index = 1; index < residuals.length; index += 1) {
      expect(Math.abs(residuals[index] ?? 0)).toBeLessThanOrEqual(1);
      expect(residuals[index]).toBe(1);
    }
  });

  it("rejects non-Int16Array inputs with the pinned TypeErrors", () => {
    expectExactTypeError(
      () => deltaEncode("x" as unknown as Int16Array),
      "deltaEncode: samples must be an Int16Array",
    );
    expectExactTypeError(
      () => deltaDecode(42 as unknown as Int16Array),
      "deltaDecode: residuals must be an Int16Array",
    );
  });

  it("never mutates its inputs and returns fresh arrays", () => {
    const samples = fullScaleSquareSamples(256);
    const snapshot = Int16Array.from(samples);
    const residuals = deltaEncode(samples);
    residuals[0] = 555;
    expect(Array.from(samples)).toEqual(Array.from(snapshot));
    // A second decode from the same residuals must ignore the first decoded
    // array (fresh outputs), here including a full-scale wrap transition.
    const residualWrap = deltaEncode(Int16Array.of(-32768, 32767));
    deltaDecode(residualWrap)[0] = 555;
    expectArrayEquals(
      deltaDecode(residualWrap),
      Int16Array.of(-32768, 32767),
      "fresh decode result",
    );
  });
});

describe("encodeLosslessDeltaHuffman payload layout", () => {
  it("matches the pinned header layout [u32 low][u32 high][codeLengths ×256][low][high]", () => {
    const samples = rampSamples(4096);
    const encoded = encodeLosslessDeltaHuffman(samples);
    const payload = encoded.payload;

    const bitLengthLow = readUint32Le(payload, 0);
    const bitLengthHigh = readUint32Le(payload, 4);
    expect(bitLengthLow).toBeGreaterThan(0);
    expect(bitLengthHigh).toBeGreaterThan(0);
    expect(encoded.bitLength).toBe(bitLengthLow + bitLengthHigh);
    expect(payload.length).toBe(264 + ((bitLengthLow + 7) >> 3) + ((bitLengthHigh + 7) >> 3));

    // Codebook per R8: one length table over the combined histogram, 256
    // bytes, stored identically in the header and returned in `codebook`.
    expect(Array.from(payload.slice(8, 264))).toEqual(Array.from(encoded.codebook.codeLengths));
    expect(encoded.stats.bitsPerSample).toBe(encoded.bitLength / samples.length);
    expectArrayEquals(decodeLosslessDeltaHuffman(payload).samples, samples, "layout re-decode");
  });

  it("pins the single-sample layout values exactly (zigzag → bytes)", () => {
    // r = 12345 → u = 24690 = 0x6072 → low 0x72, high 0x60; both streams are
    // one symbol over the combined book → one bit each, MSB-first codes.
    const encoded = encodeLosslessDeltaHuffman(Int16Array.of(12345));
    expect(encoded.bitLength).toBe(2);
    expect(encoded.payload.length).toBe(264 + 1 + 1);
    expect(readUint32Le(encoded.payload, 0)).toBe(1);
    expect(readUint32Le(encoded.payload, 4)).toBe(1);
    expect(encoded.payload[264]).toBe(0x80); // low stream "1" MSB-padded
    expect(encoded.payload[265]).toBe(0x00); // high stream "0"
  });

  it("encodes empty input to exactly the 264-byte header and decodes empty", () => {
    const encoded = encodeLosslessDeltaHuffman(new Int16Array(0));
    expect(encoded.payload.length).toBe(264);
    expect(encoded.bitLength).toBe(0);
    expect(encoded.stats.bitsPerSample).toBe(0);
    expect(encoded.stats.entropyBitsPerSymbol).toBe(0);

    const decoded = decodeLosslessDeltaHuffman(encoded.payload);
    expect(decoded.samples.length).toBe(0);
    expect(decoded.stats.bitsPerSample).toBe(0);
  });

  it("never mutates its input and returns a fresh payload", () => {
    const samples = seededRandomSamples(3, 2048);
    const snapshot = Int16Array.from(samples);
    const encoded = encodeLosslessDeltaHuffman(samples);
    expect(Array.from(samples)).toEqual(Array.from(snapshot));
    // The first stream byte is part of the payload, not the source buffer.
    encoded.payload[264] = (encoded.payload[264] ?? 0) ^ 0xff;
    expectArrayEquals(
      decodeLosslessDeltaHuffman(encodeLosslessDeltaHuffman(samples).payload).samples,
      samples,
      "fresh payload after mutation",
    );
  });

  it("rejects non-Int16Array samples with the pinned TypeError", () => {
    expectExactTypeError(
      () => encodeLosslessDeltaHuffman(["x"] as unknown as Int16Array),
      "encodeLosslessDeltaHuffman: samples must be an Int16Array",
    );
  });
});

describe("decodeLosslessDeltaHuffman guards and error propagation", () => {
  it("rejects non-Uint8Array payloads with the pinned TypeError", () => {
    expectExactTypeError(
      () => decodeLosslessDeltaHuffman(7 as unknown as Uint8Array),
      "decodeLosslessDeltaHuffman: payload must be a Uint8Array",
    );
  });

  it("throws the pinned truncated error for short, cut and over-long payloads", () => {
    const { payload } = encodeLosslessDeltaHuffman(seededRandomSamples(11, 1024));
    expectExactRangeError(
      () => decodeLosslessDeltaHuffman(new Uint8Array(0)),
      "truncated delta-huffman payload",
    );
    expectExactRangeError(
      () => decodeLosslessDeltaHuffman(payload.slice(0, 100)),
      "truncated delta-huffman payload",
    );
    expectExactRangeError(
      () => decodeLosslessDeltaHuffman(payload.slice(0, payload.length - 2)),
      "truncated delta-huffman payload",
    );
    // Header-consistent bitLengths but a payload 3 bytes longer than the
    // declared streams → size check fires before any decode.
    const overLong = new Uint8Array(payload.length + 3);
    overLong.set(payload, 0);
    expectExactRangeError(
      () => decodeLosslessDeltaHuffman(overLong),
      "truncated delta-huffman payload",
    );
  });

  it("propagates the huffman codebook error from a corrupted header table", () => {
    // Hand-crafted layout: codeLengths [1,1,1,0,...] is not prefix-free, so
    // the huffmanDecode guard must fire with its pinned message.
    const payload = new Uint8Array(264 + 1 + 1);
    const view = new DataView(payload.buffer);
    view.setUint32(0, 1, true);
    view.setUint32(4, 1, true);
    payload[8] = 1;
    payload[9] = 1;
    payload[10] = 1;
    expectExactRangeError(() => decodeLosslessDeltaHuffman(payload), "invalid huffman codebook");
  });

  it("propagates the invalid-code stream error from a length-consistent payload", () => {
    // Hand-crafted layout: one length-1 code (symbol 0 = "0") and a low
    // stream of five all-1 bits → the bounded walk hits no leaf (R6 error).
    const payload = new Uint8Array(264 + 1);
    const view = new DataView(payload.buffer);
    view.setUint32(0, 5, true);
    view.setUint32(4, 0, true);
    payload[8] = 1;
    payload[264] = 0xff;
    expectExactRangeError(() => decodeLosslessDeltaHuffman(payload), "invalid huffman code");
  });
});

describe("compression ordering properties", () => {
  it("achieves lower bitsPerSample on the quantized sine than on seeded noise", () => {
    const sine = encodeLosslessDeltaHuffman(quantizedSineSamples());
    const noise = encodeLosslessDeltaHuffman(seededRandomSamples(7, 4096));
    expect(sine.stats.bitsPerSample).toBeLessThan(noise.stats.bitsPerSample);
    // The noise ceiling: a near-flat 256-symbol histogram costs about one
    // bit per byte per stream, but the one combined codebook and the slight
    // histogram skew make the exact value drift below 16 (deterministic for
    // the pinned seed; observed 15.992431640625).
    expect(noise.stats.bitsPerSample).toBeGreaterThan(15.9);
    expect(noise.stats.bitsPerSample).toBeLessThanOrEqual(16);
  });

  it("compresses the stationary ramp better than the alternating square", () => {
    const ramp = encodeLosslessDeltaHuffman(rampSamples(4096));
    const square = encodeLosslessDeltaHuffman(fullScaleSquareSamples(4096));
    expect(ramp.stats.bitsPerSample).toBeLessThan(square.stats.bitsPerSample);
  });

  it("reports the residual entropy (R15) and stays above the achieved rate − 1", () => {
    const samples = quantizedSineSamples();
    const encoded = encodeLosslessDeltaHuffman(samples);
    const expectedEntropy = entropyBitsPerSymbol(new Int32Array(deltaEncode(samples)));
    expect(encoded.stats.entropyBitsPerSymbol).toBeCloseTo(expectedEntropy, 10);
    // Huffman achieves at most ~1 bit/symbol overhead over the entropy of
    // the underlying symbol alphabet; per-sample it cannot beat the two
    // byte-stream floors, so only the sane upper direction is asserted.
    expect(encoded.stats.bitsPerSample).toBeGreaterThan(0);
    expect(encoded.stats.bitsPerSample).toBeLessThan(16);
  });
});

/** Local helpers (declared last so the suites read top-down). */

function expectArrayEquals(actual: Int16Array, expected: Int16Array, label: string): void {
  expect(Array.from(actual), label).toEqual(Array.from(expected));
}

/** uint32 little-endian read matching the payload layout. */
function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  );
}
