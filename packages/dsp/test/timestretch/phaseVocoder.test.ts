import { describe, expect, it } from "vitest";
import {
  fft,
  istft,
  mulberry32,
  window as periodicWindow,
  pitchShift,
  stft,
  timeStretch,
} from "../../src/index.js";

const RATE = 48000;

function seededUniformNoise(length: number, seed: number): Float64Array {
  const random = mulberry32(seed);
  const samples = new Float64Array(length);
  for (let n = 0; n < length; n += 1) {
    const value: number | undefined = random();
    if (value === undefined) throw new Error(`random value ${n} missing`);
    samples[n] = value * 2 - 1;
  }
  return samples;
}

function maxDiff(a: Float64Array, b: Float64Array): number {
  let worst = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return worst;
}

/** Exact linear-chirp phase, ramped at the edges so the STFT segments are clean. */
function linearChirp(
  length: number,
  rateHz: number,
  f0: number,
  f1: number,
): { samples: Float64Array; instFreqHz: (time: number) => number } {
  const samples = new Float64Array(length);
  const endTime = (length - 1) / rateHz;
  const slopeHzPerSec = (f1 - f0) / endTime;
  for (let n = 0; n < length; n += 1) {
    const time = n / rateHz;
    const edge = Math.min(1, Math.min(n, length - 1 - n) / 480);
    samples[n] = Math.sin(2 * Math.PI * (f0 * time + (slopeHzPerSec / 2) * time * time)) * edge;
  }
  return { samples, instFreqHz: (time) => f0 + slopeHzPerSec * Math.min(time, endTime) };
}

/** Dominant bin frequency (Hz) of a (windowed) real segment, zero-padded FFT. */
function dominantFreqHz(segment: Float64Array, rateHz: number, fftLength: number): number {
  const fftWindow = periodicWindow("hann", segment.length);
  const re = new Float64Array(fftLength);
  for (let n = 0; n < segment.length; n += 1) {
    re[n] = (segment[n] ?? 0) * (fftWindow[n] ?? 0);
  }
  const spectrum = fft(re);
  let best = 0;
  let bestBin = 0;
  for (let k = 1; k < fftLength / 2; k += 1) {
    const magnitude = Math.abs(spectrum.re[k] ?? 0);
    if (magnitude > best) {
      best = magnitude;
      bestBin = k;
    }
  }
  return (bestBin * rateHz) / fftLength;
}

/** Raw (unwindowed) magnitude spectrum of a real signal, zero-padded FFT. */
function paddedSpectrum(samples: Float64Array, fftLength: number): Float64Array {
  const re = new Float64Array(fftLength);
  for (let n = 0; n < samples.length; n += 1) {
    re[n] = samples[n] ?? 0;
  }
  const spectrum = fft(re);
  const magnitudes = new Float64Array(fftLength / 2);
  for (let k = 0; k < fftLength / 2; k += 1) {
    magnitudes[k] = Math.abs(spectrum.re[k] ?? 0);
  }
  return magnitudes;
}

describe("timeStretch identity and length contract", () => {
  it("reconstructs the input exactly when stretchFactor = 1", () => {
    // stretchFactor 1 makes the synthesis phase rotation exact, so the output
    // must equal a plain istft(stft(x)) wave (measured bit-exact above).
    const input = seededUniformNoise(8192, 2026);
    const L = 1024;
    const analysis = stft(input, {
      frameLengthSamples: L,
      hopLengthSamples: L / 4,
      fftLengthSamples: L,
      window: periodicWindow("hann", L),
    });
    const baseline = istft(analysis);
    const stretched = timeStretch(input, { stretchFactor: 1, windowLengthSamples: L });
    expect(stretched.length).toBe(8192);
    expect(maxDiff(stretched, baseline)).toBeLessThanOrEqual(1e-6);
  });

  it("rounds the output length exactly per stretch factor", () => {
    const input = seededUniformNoise(5000, 7);
    interface LengthCase {
      stretchFactor: number;
      expectedLength: number;
    }
    // Cases measured against the plan's round(N * r) contract.
    const cases: LengthCase[] = [
      { stretchFactor: 0.5, expectedLength: 2500 },
      { stretchFactor: 1.1, expectedLength: 5500 },
      { stretchFactor: 1.25, expectedLength: 6250 },
      { stretchFactor: 1.5, expectedLength: 7500 },
      { stretchFactor: 2, expectedLength: 10000 },
    ];
    for (const lengthCase of cases) {
      const stretched = timeStretch(input, {
        stretchFactor: lengthCase.stretchFactor,
        windowLengthSamples: 1024,
      });
      expect(stretched.length, `stretchFactor ${lengthCase.stretchFactor} length`).toBe(
        lengthCase.expectedLength,
      );
    }
  });

  it("maps empty input to empty output", () => {
    expect(
      timeStretch(new Float64Array(0), { stretchFactor: 1.5, windowLengthSamples: 8 }),
    ).toEqual(new Float64Array(0));
    expect(
      pitchShift(new Float64Array(0), {
        semitones: 3,
        windowLengthSamples: 8,
        sampleRateHz: RATE,
      }),
    ).toEqual(new Float64Array(0));
  });
});

describe("timeStretch content preservation", () => {
  it("keeps a sine's pitch under a 2x stretch (center and side bins)", () => {
    const samples = new Float64Array(2 * RATE);
    for (let n = 0; n < samples.length; n += 1) {
      samples[n] = Math.sin((2 * Math.PI * 440 * n) / RATE);
    }
    const stretched = timeStretch(samples, { stretchFactor: 2, windowLengthSamples: 1024 });
    expect(stretched.length).toBe(4 * RATE);

    const originalFrequencies = paddedSpectrum(samples, 131072);
    const stretchedFrequencies = paddedSpectrum(stretched, 262144);
    let originalPeakBin = 0;
    let stretchedPeakBin = 0;
    for (let k = 1; k < originalFrequencies.length; k += 1) {
      if ((originalFrequencies[k] ?? 0) > (originalFrequencies[originalPeakBin] ?? 0)) {
        originalPeakBin = k;
      }
      if ((stretchedFrequencies[k] ?? 0) > (stretchedFrequencies[stretchedPeakBin] ?? 0)) {
        stretchedPeakBin = k;
      }
    }
    // Stretching doubles duration, so a pitch-preserving vocoder keeps the
    // spectral peak (bin indexes double too within measurement error).
    const originalPeakHz = (originalPeakBin * RATE) / 131072;
    const stretchedPeakHz = (stretchedPeakBin * RATE) / 262144;
    expect(Math.abs(stretchedPeakHz / originalPeakHz - 1)).toBeLessThanOrEqual(0.02);

    // Side bins far from the peak fall below -20 dB (measured worst in the
    // 32..128-bin bands, 5.9..23.5 Hz away: -26.5 dB). Offsets 1..16 carry the
    // 21.3 ms analysis-window skirt (hann main lobe = +/-187 Hz = +/-1024
    // padded bins at this resolution), inside which that bound does not
    // apply; measured there -1.2 dB to -20.8 dB depending on offset.
    let worstSideRelative = 0;
    for (let offset = 32; offset < 128; offset += 1) {
      for (const sign of [-1, 1]) {
        const bin = stretchedPeakBin + sign * offset;
        const magnitude: number | undefined = stretchedFrequencies[bin];
        if (magnitude === undefined) {
          throw new Error(`side bin ${bin} missing`);
        }
        worstSideRelative = Math.max(
          worstSideRelative,
          magnitude / (stretchedFrequencies[stretchedPeakBin] ?? 1),
        );
      }
    }
    expect(worstSideRelative).toBeLessThanOrEqual(10 ** (-20 / 20));
  });

  it("keeps a chirp's instantaneous-frequency trajectory within 15%", () => {
    // 300 -> 2000 Hz over 1 s; stretch 2; 8 segments. Segment centers map to
    // input-time centers; the crude segment-peak estimator plus vocoder
    // smearing leaves a few percent (measured max 2.8%), plan allows 15%.
    const chirp = linearChirp(RATE, RATE, 300, 2000);
    const stretched = timeStretch(chirp.samples, { stretchFactor: 2, windowLengthSamples: 1024 });
    expect(stretched.length).toBe(2 * RATE);
    const segCount = 8;
    const segLen = stretched.length / segCount;
    for (let m = 0; m < segCount; m += 1) {
      const start = Math.round(m * segLen);
      const inputCenterSeconds = (m + 0.5) * (segLen / stretched.length);
      const expected = chirp.instFreqHz(inputCenterSeconds);
      const measured = dominantFreqHz(
        stretched.subarray(start, Math.round(start + segLen)),
        RATE,
        32768,
      );
      const relative = measured / expected - 1;
      expect(
        Math.abs(relative),
        `chirp segment ${m}: expected ${expected.toFixed(2)} Hz, measured ${measured.toFixed(2)} Hz`,
      ).toBeLessThanOrEqual(0.15);
    }
  });

  it("keeps noise finite and bounded within 10x the input rms", () => {
    const noise = seededUniformNoise(2 * RATE, 55);
    const stretched = timeStretch(noise, { stretchFactor: 2, windowLengthSamples: 1024 });
    let inputSumSq = 0;
    let maxAbs = 0;
    for (let n = 0; n < stretched.length; n += 1) {
      const value: number | undefined = stretched[n];
      if (value === undefined) throw new Error(`sample ${n} missing`);
      expect(Number.isFinite(value), `sample ${n} finite`).toBe(true);
      maxAbs = Math.max(maxAbs, Math.abs(value));
    }
    for (let n = 0; n < noise.length; n += 1) {
      const value: number | undefined = noise[n];
      if (value === undefined) throw new Error(`input sample ${n} missing`);
      inputSumSq += value * value;
    }
    const inputRms = Math.sqrt(inputSumSq / noise.length);
    expect(maxAbs).toBeLessThanOrEqual(10 * inputRms);
  });

  it("maps zero input to zero output", () => {
    const stretched = timeStretch(new Float64Array(4096), {
      stretchFactor: 1.5,
      windowLengthSamples: 1024,
    });
    expect(stretched).toEqual(new Float64Array(6144));
  });
});

describe("timeStretch windows", () => {
  it("supports non-power-of-two windows on the identity path", () => {
    const input = seededUniformNoise(6000, 33);
    const L = 1000;
    const analysis = stft(input, {
      frameLengthSamples: L,
      hopLengthSamples: 250,
      fftLengthSamples: L,
      window: periodicWindow("hann", L),
    });
    const baseline = istft(analysis);
    const stretched = timeStretch(input, { stretchFactor: 1, windowLengthSamples: L });
    expect(stretched.length).toBe(input.length);
    expect(maxDiff(stretched, baseline)).toBeLessThanOrEqual(1e-6);
  });

  it("supports the minimum window length of 8", () => {
    const input = seededUniformNoise(256, 44);
    const analysis = stft(input, {
      frameLengthSamples: 8,
      hopLengthSamples: 2,
      fftLengthSamples: 8,
      window: periodicWindow("hann", 8),
    });
    const baseline = istft(analysis);
    const stretched = timeStretch(input, { stretchFactor: 1, windowLengthSamples: 8 });
    expect(stretched.length).toBe(256);
    expect(maxDiff(stretched, baseline)).toBeLessThanOrEqual(1e-6);
  });
});

describe("pitchShift", () => {
  it("shifts the dominant frequency by the requested semitones", () => {
    const samples = new Float64Array(RATE); // 1 s of 440 Hz
    for (let n = 0; n < samples.length; n += 1) {
      samples[n] = Math.sin((2 * Math.PI * 440 * n) / RATE);
    }
    interface PitchCase {
      semitones: number;
      expectedHz: number;
    }
    // 440 * 2^(semitones/12), peak frequencies within 2% (measured <= 0.15%).
    const cases: PitchCase[] = [
      { semitones: -12, expectedHz: 220 },
      { semitones: -5, expectedHz: 440 * 2 ** (-5 / 12) },
      { semitones: 0, expectedHz: 440 },
      { semitones: 5, expectedHz: 440 * 2 ** (5 / 12) },
      { semitones: 12, expectedHz: 880 },
    ];
    for (const pitchCase of cases) {
      const output = pitchShift(samples, {
        semitones: pitchCase.semitones,
        windowLengthSamples: 1024,
        sampleRateHz: RATE,
      });
      expect(output.length, `semitones ${pitchCase.semitones} length`).toBe(samples.length);
      const measured = dominantFreqHz(output, RATE, 65536);
      expect(
        Math.abs(measured / pitchCase.expectedHz - 1),
        `semitones ${pitchCase.semitones} peak ${measured.toFixed(2)} Hz vs ${pitchCase.expectedHz.toFixed(2)} Hz`,
      ).toBeLessThanOrEqual(0.02);
    }
  });

  it("passes semitones 0 through the vocoder identity exactly", () => {
    const input = seededUniformNoise(8192, 2026);
    const L = 1024;
    const analysis = stft(input, {
      frameLengthSamples: L,
      hopLengthSamples: L / 4,
      fftLengthSamples: L,
      window: periodicWindow("hann", L),
    });
    const baseline = istft(analysis);
    const output = pitchShift(input, { semitones: 0, windowLengthSamples: L, sampleRateHz: RATE });
    expect(output.length).toBe(input.length);
    expect(maxDiff(output, baseline)).toBeLessThanOrEqual(1e-6);
  });
});

describe("phase vocoder guards", () => {
  it("rejects non-finite samples with TypeError", () => {
    const testCases: Array<{ samples: Float64Array; label: string }> = [];
    const withNaN = new Float64Array(2048);
    withNaN[10] = Number.NaN;
    testCases.push({ samples: withNaN, label: "NaN" });
    const withPositiveInfinity = new Float64Array(2048);
    withPositiveInfinity[10] = Number.POSITIVE_INFINITY;
    testCases.push({ samples: withPositiveInfinity, label: "+Infinity" });
    for (const testCase of testCases) {
      expect(() =>
        timeStretch(testCase.samples, { stretchFactor: 1, windowLengthSamples: 1024 }),
      ).toThrow(TypeError);
      expect(() =>
        pitchShift(testCase.samples, {
          semitones: 0,
          windowLengthSamples: 1024,
          sampleRateHz: RATE,
        }),
      ).toThrow(TypeError);
      void testCase.label;
    }
  });

  it("rejects invalid stretch factors and window lengths with RangeError", () => {
    const input = new Float64Array(1024);
    for (const stretchFactor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => timeStretch(input, { stretchFactor, windowLengthSamples: 1024 })).toThrow(
        RangeError,
      );
    }
    expect(() => timeStretch(input, { stretchFactor: 1.5, windowLengthSamples: 7 })).toThrow(
      RangeError,
    );
    expect(() => timeStretch(input, { stretchFactor: 1.5, windowLengthSamples: 7.5 })).toThrow(
      RangeError,
    );
  });

  it("rejects invalid pitchShift parameters with RangeError", () => {
    const input = new Float64Array(1024);
    for (const semitones of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        pitchShift(input, { semitones, windowLengthSamples: 1024, sampleRateHz: RATE }),
      ).toThrow(RangeError);
    }
    for (const sampleRateHz of [0, -RATE, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        pitchShift(input, { semitones: 0, windowLengthSamples: 1024, sampleRateHz }),
      ).toThrow(RangeError);
    }
    expect(() =>
      pitchShift(input, { semitones: 0, windowLengthSamples: 7, sampleRateHz: RATE }),
    ).toThrow(RangeError);
  });

  it("rejects missing parameter objects with RangeError", () => {
    const input = new Float64Array(64);
    expect(() =>
      timeStretch(input, {
        stretchFactor: 1,
        windowLengthSamples: undefined as unknown as number,
      }),
    ).toThrow(RangeError);
    expect(() =>
      pitchShift(input, {
        semitones: 0,
        windowLengthSamples: 8,
        sampleRateHz: undefined as unknown as number,
      }),
    ).toThrow(RangeError);
    expect(() =>
      timeStretch(
        input,
        undefined as unknown as { stretchFactor: number; windowLengthSamples: number },
      ),
    ).toThrow(RangeError);
    expect(() =>
      pitchShift(
        input,
        undefined as unknown as {
          semitones: number;
          windowLengthSamples: number;
          sampleRateHz: number;
        },
      ),
    ).toThrow(RangeError);
  });

  it("never mutates the input buffers", () => {
    const input = seededUniformNoise(2048, 99);
    const inputCopy = Float64Array.from(input);
    timeStretch(input, { stretchFactor: 1.5, windowLengthSamples: 1024 });
    pitchShift(input, { semitones: -7, windowLengthSamples: 1024, sampleRateHz: RATE });
    expect(input).toEqual(inputCopy);
  });
});
