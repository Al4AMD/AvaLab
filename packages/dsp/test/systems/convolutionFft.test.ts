import { describe, expect, it } from "vitest";
import type { Complex } from "../../src/index.js";
import { convolveDirect, convolveFft, fft, nextPowerOfTwo } from "../../src/index.js";

// Deterministic LCG so every run exercises the same non-trivial samples.
function makeSignal(length: number, seed: number): Float64Array {
  const samples = new Float64Array(length);
  let state = seed >>> 0;
  for (let n = 0; n < length; n += 1) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    samples[n] = (state / 0xffffffff) * 2 - 1;
  }
  return samples;
}

function zeroPad(samples: Float64Array, length: number): Float64Array {
  const padded = new Float64Array(length);
  padded.set(samples);
  return padded;
}

function expectSamplesClose(
  actual: Float64Array,
  expected: Float64Array,
  tolerance: number,
  label: string,
): void {
  expect(actual.length, `${label} length`).toBe(expected.length);
  for (let n = 0; n < expected.length; n += 1) {
    const actualValue = actual[n] ?? Number.NaN;
    const expectedValue = expected[n] ?? Number.NaN;
    const difference = Math.abs(actualValue - expectedValue);
    const allowed = tolerance * Math.max(1, Math.abs(expectedValue));
    expect(
      difference,
      `${label}[${n}]: |${actualValue} - ${expectedValue}| = ${difference} exceeds ${allowed}`,
    ).toBeLessThanOrEqual(allowed);
  }
}

function multiplySpectra(left: Complex, right: Complex): Complex {
  const re = new Float64Array(left.re.length);
  const im = new Float64Array(left.re.length);
  for (let k = 0; k < left.re.length; k += 1) {
    const leftRe = left.re[k] ?? 0;
    const leftIm = left.im[k] ?? 0;
    const rightRe = right.re[k] ?? 0;
    const rightIm = right.im[k] ?? 0;
    re[k] = leftRe * rightRe - leftIm * rightIm;
    im[k] = leftRe * rightIm + leftIm * rightRe;
  }
  return { re, im };
}

describe("nextPowerOfTwo", () => {
  it("rounds up to the smallest power of two", () => {
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(4)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(17)).toBe(32);
    expect(nextPowerOfTwo(1023)).toBe(1024);
    expect(nextPowerOfTwo(1024)).toBe(1024);
    expect(nextPowerOfTwo(1025)).toBe(2048);
  });

  it("returns 1 for n <= 1 (R13)", () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(0)).toBe(1);
    expect(nextPowerOfTwo(-7)).toBe(1);
  });

  it("throws RangeError for invalid sizes", () => {
    for (const invalid of [
      1.5,
      2.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => nextPowerOfTwo(invalid)).toThrow(RangeError);
    }
  });
});

describe("convolveFft", () => {
  it("matches convolveDirect for N=1000, M=64 within 1e-10", () => {
    const x = makeSignal(1000, 0x1234_5678);
    const h = makeSignal(64, 0x8765_4321);
    const actual = convolveFft(x, h);
    expect(actual).toHaveLength(1000 + 64 - 1);
    expectSamplesClose(actual, convolveDirect(x, h), 1e-10, "N=1000 M=64");
  });

  it("matches convolveDirect for non-aligned N=999, M=100 within 1e-10", () => {
    const x = makeSignal(999, 0x0bad_f00d);
    const h = makeSignal(100, 0xfeed_face);
    const actual = convolveFft(x, h);
    expect(actual).toHaveLength(999 + 100 - 1);
    expectSamplesClose(actual, convolveDirect(x, h), 1e-10, "N=999 M=100");
  });

  it("matches convolveDirect when the IR is longer than the signal (N=64, M=1000)", () => {
    const x = makeSignal(64, 0xcafe_babe);
    const h = makeSignal(1000, 0xdead_beef);
    const actual = convolveFft(x, h);
    expect(actual).toHaveLength(64 + 1000 - 1);
    expectSamplesClose(actual, convolveDirect(x, h), 1e-10, "N=64 M=1000");
  });

  it("matches convolveDirect with an explicit tiny block (N=100, M=33, B=16)", () => {
    const x = makeSignal(100, 0x1357_9bdf);
    const h = makeSignal(33, 0x2468_ace0);
    const actual = convolveFft(x, h, { blockLengthSamples: 16 });
    expect(actual).toHaveLength(100 + 33 - 1);
    expectSamplesClose(actual, convolveDirect(x, h), 1e-10, "N=100 M=33 B=16");
  });

  it("matches convolveDirect for N=1", () => {
    const x = Float64Array.from([0.75]);
    const h = makeSignal(5, 0x0f0f_0f0f);
    const actual = convolveFft(x, h);
    expect(actual).toHaveLength(5);
    expectSamplesClose(actual, convolveDirect(x, h), 1e-10, "N=1");
  });

  it("matches convolveDirect for M=1 (default block = 1)", () => {
    const x = makeSignal(1000, 0x1a2b_3c4d);
    const h = Float64Array.from([1.25]);
    const actual = convolveFft(x, h);
    expect(actual).toHaveLength(1000);
    expectSamplesClose(actual, convolveDirect(x, h), 1e-10, "M=1");
  });

  it("matches convolveDirect for N=48000, M=4096 with a decaying IR within 1e-9", () => {
    const x = makeSignal(48000, 0x5eed_5eed);
    const h = new Float64Array(4096);
    for (let n = 0; n < h.length; n += 1) {
      h[n] = 0.1 * Math.exp(-n / 512) * Math.cos((2 * Math.PI * n) / 37);
    }
    const actual = convolveFft(x, h);
    expect(actual).toHaveLength(48000 + 4096 - 1);
    expectSamplesClose(actual, convolveDirect(x, h), 1e-9, "N=48000 M=4096");
  }, 60_000);

  it("writes the exact final tail of a non-aligned block (delta at the last sample)", () => {
    const x = new Float64Array(100);
    x[99] = 1;
    const h = makeSignal(33, 0x7777_1111);
    const actual = convolveFft(x, h, { blockLengthSamples: 16 });
    const expected = convolveDirect(x, h);

    // y = h delayed by 99 samples: the last M outputs are the kernel itself.
    for (let n = 0; n < h.length; n += 1) {
      expect(actual[99 + n] ?? Number.NaN, `tail[${n}]`).toBeCloseTo(h[n] ?? Number.NaN, 10);
    }
    expect(actual[actual.length - 1] ?? Number.NaN).toBeCloseTo(h[32] ?? Number.NaN, 10);
    expectSamplesClose(
      actual.slice(actual.length - 8),
      expected.slice(expected.length - 8),
      1e-10,
      "final 8 samples",
    );
  });

  it("satisfies the convolution theorem: FFT(conv) = FFT(x) * FFT(h)", () => {
    const x = makeSignal(1000, 0x0102_0304);
    const h = makeSignal(64, 0x0a0b_0c0d);
    const convoluted = convolveFft(x, h);
    const transformLength = 4096;
    expect(convoluted.length).toBe(1063);
    expect(convoluted.length).toBeLessThanOrEqual(transformLength);

    const product = multiplySpectra(
      fft(zeroPad(x, transformLength)),
      fft(zeroPad(h, transformLength)),
    );
    const transformedConvolution = fft(zeroPad(convoluted, transformLength));

    for (let k = 0; k < transformLength; k += 1) {
      const actualRe = transformedConvolution.re[k] ?? Number.NaN;
      const actualIm = transformedConvolution.im[k] ?? Number.NaN;
      const expectedRe = product.re[k] ?? Number.NaN;
      const expectedIm = product.im[k] ?? Number.NaN;
      expect(
        Math.abs(actualRe - expectedRe),
        `Re[${k}]: ${actualRe} vs ${expectedRe}`,
      ).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expectedRe)));
      expect(
        Math.abs(actualIm - expectedIm),
        `Im[${k}]: ${actualIm} vs ${expectedIm}`,
      ).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expectedIm)));
    }
  });

  it("does not mutate either input", () => {
    const x = makeSignal(37, 0x2222_3333);
    const h = makeSignal(11, 0x4444_5555);
    const xBefore = Array.from(x);
    const hBefore = Array.from(h);
    convolveFft(x, h, { blockLengthSamples: 8 });
    expect(Array.from(x)).toEqual(xBefore);
    expect(Array.from(h)).toEqual(hBefore);
  });

  it("throws RangeError when either input is empty", () => {
    expect(() => convolveFft(new Float64Array(0), Float64Array.from([1]))).toThrow(RangeError);
    expect(() => convolveFft(Float64Array.from([1]), new Float64Array(0))).toThrow(RangeError);
    expect(() => convolveFft(new Float64Array(0), new Float64Array(0))).toThrow(RangeError);
  });

  it("throws TypeError on non-finite samples in either input", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => convolveFft(Float64Array.from([1, bad]), Float64Array.from([1]))).toThrow(
        TypeError,
      );
      expect(() => convolveFft(Float64Array.from([1]), Float64Array.from([bad]))).toThrow(
        TypeError,
      );
    }
  });

  it("throws RangeError when blockLengthSamples is not an integer >= 1", () => {
    const x = Float64Array.from([1, 2, 3]);
    const h = Float64Array.from([1, 2]);
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => convolveFft(x, h, { blockLengthSamples: invalid })).toThrow(RangeError);
    }
  });
});
