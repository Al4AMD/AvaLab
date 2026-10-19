import { describe, expect, it } from "vitest";
import { istft, type StftParams, type StftResult, stft, window } from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("stft");

function valueAt(values: Float64Array, index: number, label = "values"): number {
  const value: number | undefined = values[index];
  if (value === undefined) {
    throw new Error(`${label}[${index}] read out of bounds`);
  }
  return value;
}

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

function windowForCase(goldenCase: GoldenCase): Float64Array {
  const length = paramNumber(goldenCase, "frame_length");
  return goldenCase.name.includes("_rect_") ? window("rect", length) : window("hann", length);
}

function paramsForCase(goldenCase: GoldenCase): StftParams {
  return {
    frameLengthSamples: paramNumber(goldenCase, "frame_length"),
    hopLengthSamples: paramNumber(goldenCase, "hop_length"),
    fftLengthSamples: paramNumber(goldenCase, "fft_length"),
    window: windowForCase(goldenCase),
  };
}

function deterministicSignal(length: number, frequencyA = 0.011, frequencyB = 0.037): Float64Array {
  const samples = new Float64Array(length);
  for (let n = 0; n < length; n += 1) {
    samples[n] =
      0.6 * Math.sin(2 * Math.PI * frequencyA * n) +
      0.3 * Math.cos(2 * Math.PI * frequencyB * n) +
      0.1 * Math.sin(2 * Math.PI * 0.13 * n);
  }
  return samples;
}

function windowEnergyPerSample(result: StftResult): Float64Array {
  const length =
    result.frames.length === 0
      ? 0
      : (result.frames.length - 1) * result.hopLengthSamples + result.frameLengthSamples;
  const energy = new Float64Array(length);
  for (let frameIndex = 0; frameIndex < result.frames.length; frameIndex += 1) {
    const start = frameIndex * result.hopLengthSamples;
    for (let n = 0; n < result.frameLengthSamples; n += 1) {
      const weight = valueAt(result.window, n, "window");
      energy[start + n] = valueAt(energy, start + n) + weight * weight;
    }
  }
  return energy;
}

function maxAbsoluteDifference(actual: Float64Array, expected: Float64Array): number {
  let maximum = 0;
  for (let n = 0; n < expected.length; n += 1) {
    maximum = Math.max(maximum, Math.abs(valueAt(actual, n) - valueAt(expected, n)));
  }
  return maximum;
}

describe("stft fixture", () => {
  it("loads the committed stft fixture", () => {
    expect(golden.algorithm).toBe("stft");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "sine440_hann_hop64_fft256",
      "sine440_hann_hop64_fft512",
      "sine440_rect_hop256_fft256",
    ]);
  });
});

describe("stft (golden)", () => {
  it.each(golden.cases)("matches every scipy frame for $name", (goldenCase: GoldenCase) => {
    const samples = Float64Array.from(goldenCase.input.samples);
    const params = paramsForCase(goldenCase);
    const expectedRe = Float64Array.from(asNumberArray(goldenCase.expected.re, "expected.re"));
    const expectedIm = Float64Array.from(asNumberArray(goldenCase.expected.im, "expected.im"));
    const fftLength = params.fftLengthSamples;
    const frameCount = expectedRe.length / fftLength;

    expect(Number.isInteger(frameCount)).toBe(true);
    const result = stft(samples, params);

    expect(result.frames.length).toBe(frameCount);
    expect(result.frameLengthSamples).toBe(params.frameLengthSamples);
    expect(result.hopLengthSamples).toBe(params.hopLengthSamples);
    expect(result.fftLengthSamples).toBe(fftLength);
    expect(result.originalLengthSamples).toBe(samples.length);
    expect(result.window).not.toBe(params.window);
    expect(Array.from(result.window)).toEqual(Array.from(params.window));

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frame = result.frames[frameIndex];
      if (frame === undefined) {
        throw new Error(`missing frame ${frameIndex}`);
      }
      expect(frame.re.length).toBe(fftLength);
      expect(frame.im.length).toBe(fftLength);
      for (let k = 0; k < fftLength; k += 1) {
        const offset = frameIndex * fftLength + k;
        expectClose(
          valueAt(frame.re, k),
          valueAt(expectedRe, offset),
          goldenCase.tolerance,
          `${goldenCase.name} re[frame ${frameIndex}, bin ${k}]`,
        );
        expectClose(
          valueAt(frame.im, k),
          valueAt(expectedIm, offset),
          goldenCase.tolerance,
          `${goldenCase.name} im[frame ${frameIndex}, bin ${k}]`,
        );
      }
    }
  });
});

describe("istft (golden)", () => {
  it.each(golden.cases)("reconstructs the original signal for $name", (goldenCase: GoldenCase) => {
    const samples = Float64Array.from(goldenCase.input.samples);
    const result = stft(samples, paramsForCase(goldenCase));
    const restored = istft(result);
    const expected = asNumberArray(goldenCase.expected.reconstruction, "expected.reconstruction");

    expect(restored.length).toBe(samples.length);
    expect(restored.length).toBe(result.originalLengthSamples);
    expected.forEach((value, n) => {
      expectClose(valueAt(restored, n), value, goldenCase.tolerance, `out[${n}]`);
    });
  });
});

describe("stft / istft properties", () => {
  const frameLength = 256;
  const signalLength = 4096;
  const samples = deterministicSignal(signalLength);

  it("reconstructs exactly with a rectangular window and hop = frame length", () => {
    const result = stft(samples, {
      frameLengthSamples: frameLength,
      hopLengthSamples: frameLength,
      fftLengthSamples: frameLength,
      window: window("rect", frameLength),
    });
    const restored = istft(result);

    expect(restored.length).toBe(signalLength);
    expect(maxAbsoluteDifference(restored, samples)).toBeLessThanOrEqual(1e-10);
  });

  it.each([frameLength / 4, frameLength / 2])(
    "reconstructs indexed samples with hann and hop = %i",
    (hopLength: number) => {
      const result = stft(samples, {
        frameLengthSamples: frameLength,
        hopLengthSamples: hopLength,
        fftLengthSamples: frameLength,
        window: window("hann", frameLength),
      });
      const restored = istft(result);
      const energy = windowEnergyPerSample(result);

      expect(restored.length).toBe(signalLength);
      for (let n = 0; n < signalLength; n += 1) {
        if (valueAt(energy, n) > 0) {
          expectClose(
            valueAt(restored, n),
            valueAt(samples, n),
            { rtol: 0, atol: 1e-9 },
            `out[${n}]`,
          );
        } else {
          expect(valueAt(restored, n), `R16 zero-energy out[${n}]`).toBe(0);
        }
      }
    },
  );

  it("supports odd frame lengths and a non-power-of-two fft length (Bluestein path)", () => {
    const oddFrameLength = 9;
    const oddFftLength = 15;
    const oddHopLength = 3;
    const result = stft(samples, {
      frameLengthSamples: oddFrameLength,
      hopLengthSamples: oddHopLength,
      fftLengthSamples: oddFftLength,
      window: window("rect", oddFrameLength),
    });

    expect(result.frames.length).toBe(Math.ceil(signalLength / oddHopLength));
    for (const frame of result.frames) {
      expect(frame.re.length).toBe(oddFftLength);
      expect(frame.im.length).toBe(oddFftLength);
    }

    const restored = istft(result);
    const energy = windowEnergyPerSample(result);
    expect(restored.length).toBe(signalLength);
    let maxError = 0;
    for (let n = 0; n < signalLength; n += 1) {
      if (valueAt(energy, n) > 0) {
        maxError = Math.max(maxError, Math.abs(valueAt(restored, n) - valueAt(samples, n)));
      }
    }
    expect(maxError).toBeLessThanOrEqual(1e-10);
  });

  it("outputs 0 where the squared-window sum is zero (R16)", () => {
    const impulse = new Float64Array(256);
    impulse[0] = 1;
    const result = stft(impulse, {
      frameLengthSamples: 256,
      hopLengthSamples: 256,
      fftLengthSamples: 256,
      window: window("hann", 256),
    });
    const restored = istft(result);

    expect(valueAt(restored, 0)).toBe(0);
    expect(restored.length).toBe(256);
  });

  it("is linear in the input", () => {
    const x = deterministicSignal(1024, 0.013, 0.041);
    const y = deterministicSignal(1024, 0.027, 0.077);
    const alpha = 2.5;
    const beta = -1.25;
    const combined = new Float64Array(x.length);
    for (let n = 0; n < x.length; n += 1) {
      combined[n] = alpha * valueAt(x, n) + beta * valueAt(y, n);
    }
    const params: StftParams = {
      frameLengthSamples: 128,
      hopLengthSamples: 32,
      fftLengthSamples: 256,
      window: window("hann", 128),
    };

    const left = stft(combined, params);
    const xTransform = stft(x, params);
    const yTransform = stft(y, params);

    expect(left.frames.length).toBe(xTransform.frames.length);
    for (let frameIndex = 0; frameIndex < left.frames.length; frameIndex += 1) {
      const frame = left.frames[frameIndex];
      const frameX = xTransform.frames[frameIndex];
      const frameY = yTransform.frames[frameIndex];
      if (frame === undefined || frameX === undefined || frameY === undefined) {
        throw new Error(`missing frame ${frameIndex}`);
      }
      for (let k = 0; k < frame.re.length; k += 1) {
        expectClose(
          valueAt(frame.re, k),
          alpha * valueAt(frameX.re, k) + beta * valueAt(frameY.re, k),
          { rtol: 1e-9, atol: 1e-10 },
          `linearity re[${frameIndex}, ${k}]`,
        );
        expectClose(
          valueAt(frame.im, k),
          alpha * valueAt(frameX.im, k) + beta * valueAt(frameY.im, k),
          { rtol: 1e-9, atol: 1e-10 },
          `linearity im[${frameIndex}, ${k}]`,
        );
      }
    }
  });

  it("returns a single zero-padded frame when the input is shorter than one frame", () => {
    const short = deterministicSignal(100, 0.05, 0.09);
    const result = stft(short, {
      frameLengthSamples: 256,
      hopLengthSamples: 100,
      fftLengthSamples: 512,
      window: window("rect", 256),
    });

    expect(result.frames.length).toBe(1);
    expect(result.originalLengthSamples).toBe(100);
    const frame = result.frames[0];
    if (frame === undefined) {
      throw new Error("missing frame 0");
    }
    expect(frame.re.length).toBe(512);
    expect(frame.im.length).toBe(512);

    const restored = istft(result);
    expect(restored.length).toBe(100);
    expect(maxAbsoluteDifference(restored, short)).toBeLessThanOrEqual(1e-10);
  });

  it("allows hop > frame length in stft but rejects it in istft", () => {
    const result = stft(deterministicSignal(1024), {
      frameLengthSamples: 128,
      hopLengthSamples: 256,
      fftLengthSamples: 256,
      window: window("hann", 128),
    });

    expect(result.frames.length).toBe(4);
    // Message-specific so removing the H <= L branch cannot pass through the
    // coverage guard's RangeError (covered 896 < originalLengthSamples 1024).
    expect(() => istft(result)).toThrow(
      /hopLengthSamples \(256\) must be <= frameLengthSamples \(128\)/,
    );
  });

  it("returns no frames for empty input and an empty inverse", () => {
    const result = stft(new Float64Array(0), {
      frameLengthSamples: 64,
      hopLengthSamples: 16,
      fftLengthSamples: 64,
      window: window("hann", 64),
    });

    expect(result.frames).toEqual([]);
    expect(result.originalLengthSamples).toBe(0);
    expect(istft(result).length).toBe(0);
  });
});

describe("stft / istft validation", () => {
  const validParams: StftParams = {
    frameLengthSamples: 8,
    hopLengthSamples: 4,
    fftLengthSamples: 8,
    window: window("hann", 8),
  };
  const samples = deterministicSignal(32);

  it.each([
    {
      label: "frameLengthSamples = 0",
      params: { ...validParams, frameLengthSamples: 0 },
      message: /frameLengthSamples must be an integer >= 1 \(got 0\)/,
    },
    {
      label: "frameLengthSamples = 8.5",
      params: { ...validParams, frameLengthSamples: 8.5 },
      message: /frameLengthSamples must be an integer >= 1 \(got 8\.5\)/,
    },
    {
      label: "hopLengthSamples = 0",
      params: { ...validParams, hopLengthSamples: 0 },
      message: /hopLengthSamples must be an integer >= 1 \(got 0\)/,
    },
    {
      label: "hopLengthSamples = 2.5",
      params: { ...validParams, hopLengthSamples: 2.5 },
      message: /hopLengthSamples must be an integer >= 1 \(got 2\.5\)/,
    },
    {
      label: "fftLengthSamples = 0",
      params: { ...validParams, fftLengthSamples: 0 },
      message: /fftLengthSamples must be an integer >= 1 \(got 0\)/,
    },
    {
      label: "fftLengthSamples = 7.5",
      params: { ...validParams, fftLengthSamples: 7.5 },
      message: /fftLengthSamples must be an integer >= 1 \(got 7\.5\)/,
    },
  ])("rejects $label with the integer branch's error", ({ params, message }) => {
    expect(() => stft(samples, params)).toThrow(message);
  });

  it("rejects fftLength < frameLength", () => {
    expect(() => stft(samples, { ...validParams, fftLengthSamples: 4 })).toThrow(
      /fftLengthSamples \(4\) must be >= frameLengthSamples \(8\)/,
    );
  });

  it("rejects a window whose length differs from frameLength", () => {
    expect(() => stft(samples, { ...validParams, window: window("hann", 7) })).toThrow(
      /window length 7 does not match frameLengthSamples 8/,
    );
  });

  it("rejects non-finite input samples", () => {
    for (const badValue of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const bad = deterministicSignal(32);
      bad[5] = badValue;
      expect(() => stft(bad, validParams)).toThrow(TypeError);
    }
  });

  it("rejects non-finite window values", () => {
    const badWindow = window("hann", 8);
    badWindow[3] = Number.NaN;
    expect(() => stft(samples, { ...validParams, window: badWindow })).toThrow(
      /window\[3\] is not finite/,
    );
  });

  it("rejects a frame whose bin count differs from fftLength", () => {
    const result = stft(samples, validParams);
    const frame = result.frames[0];
    if (frame === undefined) {
      throw new Error("missing frame 0");
    }
    // originalLengthSamples 8 equals the length covered by the single frame,
    // so the coverage guard passes and the bin-count branch is under test.
    const broken: StftResult = {
      ...result,
      frames: [{ re: frame.re.slice(0, 4), im: frame.im.slice(0, 4) }],
      originalLengthSamples: 8,
    };
    expect(() => istft(broken)).toThrow(
      /frame 0 holds 4 re and 4 im bins, expected fftLengthSamples 8/,
    );
  });

  it("rejects hop > frameLength in istft with the H <= L branch's error", () => {
    const frames = stft(samples, { ...validParams, hopLengthSamples: 16 }).frames;
    // Covered length (2 - 1) * 16 + 8 = 24 >= originalLengthSamples, so the
    // coverage guard passes first and only the H <= L branch can throw.
    const inconsistent: StftResult = {
      frames,
      frameLengthSamples: 8,
      hopLengthSamples: 16,
      fftLengthSamples: 8,
      window: window("hann", 8),
      originalLengthSamples: 24,
    };
    expect(frames.length).toBe(2);
    expect(() => istft(inconsistent)).toThrow(
      /hopLengthSamples \(16\) must be <= frameLengthSamples \(8\)/,
    );
  });

  it("rejects an istft window whose length differs from frameLength", () => {
    const result = stft(samples, validParams);
    const broken: StftResult = {
      ...result,
      window: window("hann", 7),
      originalLengthSamples: 0,
    };
    expect(() => istft(broken)).toThrow(/window length 7 does not match frameLengthSamples 8/);
  });

  it("rejects non-finite istft window values", () => {
    for (const badValue of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = stft(samples, validParams);
      const badWindow = result.window.slice();
      badWindow[2] = badValue;
      expect(() => istft({ ...result, window: badWindow })).toThrow(/window\[2\] is not finite/);
    }
  });

  it.each([
    { label: "negative", value: -1 },
    { label: "non-integer", value: 8.5 },
    { label: "NaN", value: Number.NaN },
  ])("rejects $label originalLengthSamples in istft", ({ value }) => {
    const result = stft(samples, validParams);
    expect(() => istft({ ...result, originalLengthSamples: value })).toThrow(
      /originalLengthSamples must be an integer >= 0/,
    );
  });

  it("rejects originalLengthSamples beyond the covered length", () => {
    // 8 frames at hop 4 with frame length 8 cover (8 - 1) * 4 + 8 = 36 samples.
    const result = stft(samples, validParams);
    expect(result.frames.length).toBe(8);
    expect(() => istft({ ...result, originalLengthSamples: 37 })).toThrow(
      /originalLengthSamples \(37\) exceeds the 36 samples covered by 8 frames/,
    );
  });

  it("rejects a hand-built empty result with non-zero originalLengthSamples", () => {
    const result = stft(new Float64Array(0), validParams);
    expect(result.frames).toEqual([]);
    expect(() => istft({ ...result, originalLengthSamples: 1 })).toThrow(
      /originalLengthSamples \(1\) exceeds the 0 samples covered by 0 frames/,
    );
  });
});
