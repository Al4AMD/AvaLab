import { describe, expect, it } from "vitest";
import type { MdctCodecEncoded } from "../../src/index.js";
import { decodeMdct, encodeMdct, generateSine, mdct, mulberry32, snrDb } from "../../src/index.js";

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

const fs = 48000;
const frame = 1024;
const hop = frame / 2;

/** 1 s of 440 Hz sine (peak 0.9). */
function sineSamples(): Float32Array {
  return Float32Array.from(
    generateSine({ durationSeconds: 1, sampleRateHz: fs, frequencyHz: 440, amplitude: 0.9 }),
  );
}

/** 1 s of deterministic seeded uniform noise in [−1, 1). */
function randomSamples(): Float32Array {
  const next = mulberry32(7);
  const samples = new Float32Array(fs);
  for (let index = 0; index < fs; index += 1) {
    samples[index] = next() * 2 - 1;
  }
  return samples;
}

/** 1 s of DC 0.5. */
function dcSamples(): Float32Array {
  const samples = new Float32Array(fs);
  samples.fill(0.5);
  return samples;
}

/** 1 s with a single impulse of amplitude 1 at sample 1024. */
function impulseSamples(): Float32Array {
  const samples = new Float32Array(fs);
  samples[1024] = 1;
  return samples;
}

/** 1 s linear chirp 100 → 4000 Hz, peak 0.9. */
function chirpSamples(): Float32Array {
  const raw = new Float64Array(fs);
  const startFrequencyHz = 100;
  const endFrequencyHz = 4000;
  const differenceHz = endFrequencyHz - startFrequencyHz;
  for (let n = 0; n < fs; n += 1) {
    const seconds = n / fs;
    const phaseCycles = startFrequencyHz * seconds + (differenceHz * seconds * seconds) / 2;
    raw[n] = 0.9 * Math.sin(2 * Math.PI * phaseCycles);
  }
  return Float32Array.from(raw);
}

const inputs: Array<[string, () => Float32Array]> = [
  ["sine440", sineSamples],
  ["random", randomSamples],
  ["dc0.5", dcSamples],
  ["impulse", impulseSamples],
  ["chirp", chirpSamples],
];

function encodeDecode(samples: Float32Array, bitsPerSecond: number): Float32Array {
  const encoded = encodeMdct(samples, {
    sampleRateHz: fs,
    frameLengthSamples: frame,
    bitsPerSecond,
  });
  return decodeMdct(encoded, { sampleRateHz: fs, frameLengthSamples: frame });
}

/** Relative RMS error of `test` against `reference`, both length N (round trips in the pinned range). */
function relativeRms(reference: Float32Array | Float64Array, test: Float32Array): number {
  let errorSum = 0;
  let signalSum = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const errorValue = (test[index] ?? 0) - (reference[index] ?? 0);
    errorSum += errorValue * errorValue;
    signalSum += (reference[index] ?? 0) * (reference[index] ?? 0);
  }
  if (signalSum === 0) {
    return errorSum === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  return Math.sqrt(errorSum / signalSum);
}

/** Largest absolute error and peak amplitude of the reference (amplitude fidelity metric). */
function amplitudeError(
  reference: Float32Array,
  test: Float32Array,
): { maxError: number; peak: number } {
  let maxError = 0;
  let peak = 0;
  for (let index = 0; index < reference.length; index += 1) {
    maxError = Math.max(maxError, Math.abs((test[index] ?? 0) - (reference[index] ?? 0)));
    peak = Math.max(peak, Math.abs(reference[index] ?? 0));
  }
  return { maxError, peak };
}

function rms(samples: Float32Array): number {
  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) {
    energy += (samples[index] ?? 0) * (samples[index] ?? 0);
  }
  return Math.sqrt(energy / samples.length);
}

/** Measures the SNR infinity edge the same way the metrics module reports it. */
function snrOf(reference: Float32Array, test: Float32Array): number {
  return snrDb(Float64Array.from(reference), Float64Array.from(test.slice(0, reference.length)));
}

/**
 * HIGH-RATE CONTRACT (dispatch, Review Focus 4): at bitsPerSecond ≥ 512 kbps
 * the decoded signal must be a perceptually transparent proxy with PR error
 * ≤ 1e-2 relative RMS — measured on the seeds where the R9 rate model holds
 * (flat-spectrum random: 9.39e-5; impulse: 1.29e-4; fs 48 kHz, frame 1024).
 * The R9 rate model collapses TONAL content at high rates (sine/coirp/DC
 * pins live in the "rate-model collapse" suite below) — documented, and the
 * motivating teaching hook for per-band scale factors + F13 masking.
 */
describe("high-rate contract at 512 kbps (dispatch pin, measured)", () => {
  it("random: relative RMS error ≤ 1e-2 contract, measured 9.39e-5 pinned at 2e-4", () => {
    const samples = randomSamples();
    const decoded = encodeDecode(samples, 512000);
    const rel = relativeRms(samples, decoded);
    expect(rel).toBeLessThanOrEqual(1e-2); // the pinned contract
    expect(rel).toBeLessThanOrEqual(2e-4); // measured-value regression floor (9.39e-5)
  });

  it("impulse: relative RMS error ≤ 1e-2 contract, measured 1.29e-4 pinned at 3e-4", () => {
    const samples = impulseSamples();
    const decoded = encodeDecode(samples, 512000);
    expect(relativeRms(samples, decoded)).toBeLessThanOrEqual(3e-4);
  });

  it("random: amplitude fidelity max abs error ≤ 0.05 of peak (measured 2.2e-4, pinned 5e-4)", () => {
    const samples = randomSamples();
    const decoded = encodeDecode(samples, 512000);
    const { maxError, peak } = amplitudeError(samples, decoded);
    expect(maxError).toBeLessThanOrEqual(0.05 * peak); // the pinned contract
    expect(maxError).toBeLessThanOrEqual(5e-4 * peak);
  });

  it("impulse: amplitude fidelity max abs error ≤ 0.05 of peak (measured 1.6e-5, pinned 1e-4)", () => {
    const samples = impulseSamples();
    const decoded = encodeDecode(samples, 512000);
    const { maxError, peak } = amplitudeError(samples, decoded);
    expect(maxError).toBeLessThanOrEqual(1e-4 * peak);
  });

  it("keeps the output length at (frameCount − 1)·hop with a near-zero reconstruction tail", () => {
    const samples = randomSamples();
    const encoded = encodeMdct(samples, {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 512000,
    });
    const decoded = decodeMdct(encoded, { sampleRateHz: fs, frameLengthSamples: frame });
    const frameCount = encoded.coefficients.length;
    expect(frameCount).toBe(Math.ceil(fs / hop) + 1);
    expect(decoded.length).toBe((frameCount - 1) * hop);
    // Positions beyond the original count reconstruct the zero padding; the
    // residual there is quantization noise only (measured ≤ 1.2e-4).
    let tailMax = 0;
    for (let index = fs; index < decoded.length; index += 1) {
      tailMax = Math.max(tailMax, Math.abs(decoded[index] ?? 0));
    }
    expect(tailMax).toBeLessThanOrEqual(5e-3);
  });
});

/**
 * ROUND-TRIP CONTRACT at the exemplary rates 48/96/128 kbps (dispatch):
 * decode(encode(x)) must reproduce a flat-spectrum signal with monotone
 * quality, and the encode∘decode operator must be pass-2 stable
 * (encode(decode(encode(x))) does not explode). Measured (random, fs 48 kHz,
 * frame 1024): relRms 7.63e-2 / 3.83e-2 / 2.41e-2, SNR 22.3 / 28.3 / 32.4 dB;
 * pass-2 relRms 1.59e-2 / 1.72e-2 / 1.54e-2.
 */
describe("round-trip contract at exemplary rates 48/96/128 kbps", () => {
  const rates = [48000, 96000, 128000];

  it("reproduces random input at all three rates inside measured bands", () => {
    const samples = randomSamples();
    // Measured relRms 7.634e-2 / 3.829e-2 / 2.409e-2, pinned with ~1.6× headroom.
    const relPins: Record<number, number> = {
      48000: 0.12,
      96000: 0.06,
      128000: 0.04,
    };
    for (const bitsPerSecond of rates) {
      const decoded = encodeDecode(samples, bitsPerSecond);
      expect(relativeRms(samples, decoded)).toBeLessThanOrEqual(relPins[bitsPerSecond] ?? 1);
    }
  });

  it("is strictly monotone in rate: relRms(48k) > relRms(96k) > relRms(128k)", () => {
    const samples = randomSamples();
    const relRms48 = relativeRms(samples, encodeDecode(samples, 48000));
    const relRms96 = relativeRms(samples, encodeDecode(samples, 96000));
    const relRms128 = relativeRms(samples, encodeDecode(samples, 128000));
    expect(relRms48).toBeGreaterThan(relRms96);
    expect(relRms96).toBeGreaterThan(relRms128);
  });

  it("SNR grows with rate and stays ≥ 10 dB at 48 kbps (measured 22.3 / 28.3 / 32.4 dB)", () => {
    const samples = randomSamples();
    for (const bitsPerSecond of rates) {
      const decoded = encodeDecode(samples, bitsPerSecond);
      expect(snrOf(samples, decoded)).toBeGreaterThanOrEqual(10);
    }
    const snr48 = snrOf(samples, encodeDecode(samples, 48000));
    const snr96 = snrOf(samples, encodeDecode(samples, 96000));
    const snr128 = snrOf(samples, encodeDecode(samples, 128000));
    expect(snr48).toBeLessThan(snr96);
    expect(snr96).toBeLessThan(snr128);
  });

  it("pass-2 stability: decode(encode(decode(encode(x)))) ≈ decode(encode(x))", () => {
    const samples = randomSamples();
    for (const bitsPerSecond of rates) {
      const firstPass = encodeDecode(samples, bitsPerSecond);
      const secondPass = encodeDecode(firstPass, bitsPerSecond);
      const rel = relativeRms(firstPass, secondPass);
      expect(rel).toBeLessThanOrEqual(3.5e-2); // measured 1.59e-2 .. 1.72e-2
      expect(relativeRms(samples, firstPass)).toBeGreaterThan(0);
    }
  });

  it("impulse reproduces at the exemplary rates with SNR ≥ 10 dB (measured 20.4 / 26.2 / 29.5)", () => {
    const samples = impulseSamples();
    for (const bitsPerSecond of rates) {
      const decoded = encodeDecode(samples, bitsPerSecond);
      expect(snrOf(samples, decoded)).toBeGreaterThanOrEqual(10);
    }
  });
});

/**
 * RATE-ORDERING: bitsPerSample (total Huffman bits per original sample)
 * must strictly increase with the requested bitsPerSecond — the direction
 * R9's rate model (s = GM·2^(−B/hop)) guarantees: a larger budget shrinks
 * the step and the Huffman stream grows. The dispatch text printed the
 * opposite inequality ("bitsPerSample(128k) < bitsPerSample(48k)"), which is
 * incompatible with the same dispatch's pinned R9 rate model; the physical
 * direction is implemented here and the discrepancy is flagged in
 * .superpowers/sdd/04-codecs-and-time/progress.md for the controller.
 *
 * Measured bitsPerSample (frame 1024, fs 48 kHz): sine 5.373 / 6.252 /
 * 7.368 / 8.130 / 14.224; random 4.544 / 5.585 / 6.787 / 7.535 / 15.010;
 * impulse 2.063 / 2.086 / 2.107 / 2.123 / 2.317.
 */
describe("rate ordering: bitsPerSample strictly increases with bitsPerSecond", () => {
  const rates = [8000, 48000, 96000, 128000, 512000];

  it("strictly monotone for random, sine and impulse inputs", () => {
    for (const [label, make] of inputs) {
      if (label !== "random" && label !== "sine440" && label !== "impulse") {
        continue;
      }
      const samples = make();
      let previous = -1;
      for (const bitsPerSecond of rates) {
        const encoded = encodeMdct(samples, {
          sampleRateHz: fs,
          frameLengthSamples: frame,
          bitsPerSecond,
        });
        expect(encoded.stats.bitsPerSample, `${label} @ ${bitsPerSecond}`).toBeGreaterThan(
          previous,
        );
        previous = encoded.stats.bitsPerSample;
      }
    }
  });
});

/**
 * STATS consistency (documented formulas, module header): bitsTotal equals
 * bitLength by construction; bitsPerSample = bitsTotal/sampleCount;
 * bitrateKbps = bitsTotal·fs/sampleCount/1000 (R9's exact formula);
 * compressedSizeBytes = ceil(bitLength/8). The requested bitrate is only an
 * approximation target (R9): the GM-based step overshoots heavily-tailed
 * frames (measured 300 kbps for a requested 48 on sine; 268 vs 48 on random)
 * — exact Huffman bits are reported, per the ruling.
 */
describe("stats consistency", () => {
  it("reports the exact documented formulas for a non-empty encode", () => {
    const samples = randomSamples();
    const encoded = encodeMdct(samples, {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 128000,
    });
    expect(encoded.bitLength).toBeGreaterThan(0);
    expect(encoded.bitsTotal).toBe(encoded.bitLength);
    const bitsPerSampleRatio = encoded.stats.bitsPerSample / (encoded.bitLength / samples.length);
    expect(Math.abs(bitsPerSampleRatio - 1)).toBeLessThan(1e-9);
    const expectedKbps = (encoded.bitLength * fs) / samples.length / 1000;
    const kbpsRatio = encoded.stats.bitrateKbps / expectedKbps;
    expect(Math.abs(kbpsRatio - 1)).toBeLessThan(1e-9);
    expect(encoded.stats.compressedSizeBytes).toBe((encoded.bitLength + 7) >> 3);
    expect(encoded.bits.length).toBe(encoded.stats.compressedSizeBytes);
    // The packed stream carries the combined-low/high symbols:
    // 2 bytes per quantized coefficient (M = frameCount·hop each).
    expect(encoded.coefficients.length).toBe(Math.ceil(samples.length / hop) + 1);
    for (const frameQ of encoded.coefficients) {
      expect(frameQ.length).toBe(hop);
    }
    expect(encoded.steps.length).toBe(encoded.coefficients.length);
  });
});

/**
 * COEFFICIENT (spectrogram magnitude) reconstruction consistency — the
 * decode(encode(x)) output keeps the transform-domain magnitudes of the
 * original within an order of magnitude for the inputs the R9 model holds.
 * Documented as LOOSE (not exact) per the dispatch.
 */
describe("spectrogram magnitude order-of-magnitude preservation", () => {
  it("random @128k: max |mdct(decoded)| within [0.5, 2] of max |mdct(original)|", () => {
    const samples = randomSamples();
    const decoded = encodeDecode(samples, 128000);
    const originalSpectrum = mdct(Float64Array.from(samples), { frameLengthSamples: frame });
    const decodedSpectrum = mdct(Float64Array.from(decoded.slice(0, samples.length)), {
      frameLengthSamples: frame,
    });
    let originalMax = 0;
    let decodedMax = 0;
    for (let index = 0; index < originalSpectrum.coefficients.length; index += 1) {
      for (let k = 0; k < hop; k += 1) {
        originalMax = Math.max(
          originalMax,
          Math.abs(originalSpectrum.coefficients[index]?.[k] ?? 0),
        );
        decodedMax = Math.max(decodedMax, Math.abs(decodedSpectrum.coefficients[index]?.[k] ?? 0));
      }
    }
    const ratio = decodedMax / originalMax;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});

/**
 * LOW-RATE (8 kbps) STRUCTURAL VALIDITY (dispatch): the output is audibly
 * different (measured relRms 0.14–0.99 across inputs) but structurally
 * sound — exact length, everywhere finite, bounded energy.
 */
describe("low rate 8 kbps structural validity", () => {
  it("all inputs: exact length, finite samples, bounded RMS and peak", () => {
    for (const [label, make] of inputs) {
      const samples = make();
      const decoded = encodeDecode(samples, 8000);
      expect(decoded.length, label).toBe(Math.ceil(samples.length / hop) * hop);
      let finite = true;
      for (let index = 0; index < decoded.length; index += 1) {
        if (!Number.isFinite(decoded[index])) {
          finite = false;
        }
      }
      expect(finite, label).toBe(true);
      expect(rms(decoded), label).toBeLessThanOrEqual(3 * rms(samples));
      expect(rms(decoded), label).toBeGreaterThan(0);
      const { maxError, peak } = amplitudeError(samples, decoded);
      // Amplitude error can exceed the peak on pathological frames (clipped
      // quantizer; measured 1.22 on DC) but never 4× the reference peak.
      expect(maxError, label).toBeLessThanOrEqual(4 * peak);
    }
  });
});

/**
 * R9 RATE-MODEL COLLAPSE ON TONAL CONTENT (documented limitation, measured):
 * the pinned step s = GM·2^(−B/hop) sets the step from the geometric mean
 * over ALL nonzero coefficients; tonal frames have a 1e4–1e7 dynamic range
 * (dominant bins vs leakage floor), so the dominant coefficients QUANTIZE
 * beyond the Int16 clip (measured 40 clipped coefficients in one 440 Hz
 * sine frame at 512 kbps) and the tonal energy is lost. This is a property
 * of the pinned rate model, reproduced here as a regression tripwire: the
 * sine/chirp/DC relative-RMS errors stay ≥ 0.5 at 512 kbps. If the owner
 * amends the rate model (e.g. RMS-based steps or per-band scale factors,
 * the standard MP3/AAC remedy), these pins change WITH that ruling.
 */
describe("R9 rate-model collapse on tonal content (documented limitation)", () => {
  it("sine @512k: relRms stays in the [0.5, 1.05] collapse band (measured 0.99974)", () => {
    const samples = sineSamples();
    const decoded = encodeDecode(samples, 512000);
    const rel = relativeRms(samples, decoded);
    expect(rel).toBeGreaterThanOrEqual(0.5);
    expect(rel).toBeLessThanOrEqual(1.05);
  });

  it("chirp @512k: relRms stays in the [0.5, 1.05] collapse band (measured 0.99942)", () => {
    const samples = chirpSamples();
    const decoded = encodeDecode(samples, 512000);
    const rel = relativeRms(samples, decoded);
    expect(rel).toBeGreaterThanOrEqual(0.5);
    expect(rel).toBeLessThanOrEqual(1.05);
  });

  it("dc @512k: relRms stays in the [0.5, 1.05] collapse band (measured 0.99895)", () => {
    const samples = dcSamples();
    const decoded = encodeDecode(samples, 512000);
    const rel = relativeRms(samples, decoded);
    expect(rel).toBeGreaterThanOrEqual(0.5);
    expect(rel).toBeLessThanOrEqual(1.05);
  });
});

/**
 * UNDERFLOW CLIFF (module header, saturation bullet): bitsPerSecond 1e17 on
 * fs 48 kHz gives E = bitsPerSecond/sampleRateHz ≈ 2.08e12 ≫ 1074, so
 * stepFactor = 2^(−E) underflows to EXACTLY 0 and every nonzero frame's
 * step is 0. The index q = clip(round(C/0)) saturates at the Int16 boundary
 * via ±Infinity, yet the decode multiplies by the step (C′ = q·0 = 0), so
 * the frame is lost entirely — a defined total-loss cliff, not corruption.
 */
describe("underflow cliff: stepFactor 2^(−E) underflows to 0 at absurd rates", () => {
  it("bitsPerSecond 1e17: step 0, all indices saturated, decode all zeros at valid length", () => {
    const samples = sineSamples();
    const encoded = encodeMdct(samples, {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 1e17,
    });
    expect(encoded.coefficients.length).toBeGreaterThan(0);
    for (let f = 0; f < encoded.steps.length; f += 1) {
      expect(encoded.steps[f], `steps[${f}]`).toBe(0);
    }
    for (const frameQ of encoded.coefficients) {
      for (let k = 0; k < hop; k += 1) {
        const q = frameQ[k] ?? 0;
        expect(q === 0 || q === 32767 || q === -32768, `coefficient q=${q}`).toBe(true);
      }
    }
    const decoded = decodeMdct(encoded, { sampleRateHz: fs, frameLengthSamples: frame });
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(decoded.length).toBe((encoded.coefficients.length - 1) * hop);
    for (let index = 0; index < decoded.length; index += 1) {
      expect(decoded[index]).toBe(0);
    }
  });
});

/**
 * EDGE CASES (R14 + dispatch list): silence (step pinned to 1.0 on all-zero
 * frames, exact-zero decode output), empty input, mixed zero/nonzero frames,
 * non-multiple-of-hop lengths, and the frameLengthSamples = 4 minimum.
 */
describe("edge cases", () => {
  it("silence: step exactly 1.0 per frame, all indices 0, decode output exactly 0", () => {
    const samples = new Float32Array(fs);
    const encoded = encodeMdct(samples, {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 128000,
    });
    expect(encoded.steps.length).toBeGreaterThan(0);
    for (let index = 0; index < encoded.steps.length; index += 1) {
      expect(encoded.steps[index]).toBe(1);
    }
    for (const frameQ of encoded.coefficients) {
      for (let k = 0; k < frameQ.length; k += 1) {
        expect(frameQ[k]).toBe(0);
      }
    }
    // Huffman floor: a single-symbol alphabet still costs 1 bit/symbol.
    expect(encoded.bitLength).toBe(2 * encoded.coefficients.length * hop);
    const decoded = decodeMdct(encoded, { sampleRateHz: fs, frameLengthSamples: frame });
    expect(decoded.length).toBe((encoded.coefficients.length - 1) * hop);
    for (let index = 0; index < decoded.length; index += 1) {
      expect(decoded[index]).toBe(0);
    }
  });

  it("empty samples: empty frames, zero bits, zeros stats, decode → empty", () => {
    const encoded = encodeMdct(new Float32Array(0), {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 128000,
    });
    expect(encoded.coefficients).toEqual([]);
    expect(encoded.steps.length).toBe(0);
    expect(encoded.bitLength).toBe(0);
    expect(encoded.bitsTotal).toBe(0);
    expect(encoded.bits.length).toBe(0);
    expect(encoded.stats).toEqual({
      bitsPerSample: 0,
      bitrateKbps: 0,
      compressedSizeBytes: 0,
    });
    const decoded = decodeMdct(encoded, { sampleRateHz: fs, frameLengthSamples: frame });
    expect(decoded.length).toBe(0);
  });

  it("impulse mixes all-zero and nonzero frames: steps hold 1s and non-1s", () => {
    const samples = impulseSamples();
    const encoded = encodeMdct(samples, {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 128000,
    });
    expect(encoded.steps.some((step) => step === 1)).toBe(true);
    expect(encoded.steps.some((step) => step !== 1)).toBe(true);
  });

  it("length not a multiple of hop: frame count and round-trip prefix hold", () => {
    const length = 3 * hop + 7; // 1543 < frame
    const next = mulberry32(7);
    const samples = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      samples[index] = next() * 2 - 1;
    }
    const encoded = encodeMdct(samples, {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 512000,
    });
    expect(encoded.coefficients.length).toBe(Math.ceil(length / hop) + 1);
    const decoded = decodeMdct(encoded, { sampleRateHz: fs, frameLengthSamples: frame });
    expect(decoded.length).toBe((encoded.coefficients.length - 1) * hop);
    const rel = relativeRms(samples, decoded);
    expect(rel).toBeLessThanOrEqual(1e-3); // measured 5.3e-5-scale on random input
  });

  it("frameLengthSamples = 4 (minimum) round-trips a deterministic 4-sample signal", () => {
    const samples = Float32Array.of(0.5, -0.25, 0.75, -0.5);
    const encoded = encodeMdct(samples, {
      sampleRateHz: fs,
      frameLengthSamples: 4,
      bitsPerSecond: 512000,
    });
    const decoded = decodeMdct(encoded, { sampleRateHz: fs, frameLengthSamples: 4 });
    expect(decoded.length).toBe(4);
    const rel = relativeRms(samples, decoded);
    expect(rel).toBeLessThanOrEqual(0.02); // measured ~1e-15-scale scale at 512 kbps hop 2
  });
});

/**
 * GUARDS (R14): non-finite samples and non-Float32Array input → TypeError;
 * non-positive/non-finite sampleRateHz/bitsPerSecond → RangeError;
 * frameLengthSamples validation is delegated to mdct (typed message).
 */
describe("input guards", () => {
  it("rejects non-Float32Array samples with the pinned TypeError", () => {
    expectExactTypeError(
      () =>
        encodeMdct(Float64Array.of(0.1) as unknown as Float32Array, {
          sampleRateHz: fs,
          frameLengthSamples: frame,
          bitsPerSecond: 128000,
        }),
      "encodeMdct: samples must be a Float32Array",
    );
  });

  it("rejects non-finite samples with the indexed TypeError", () => {
    const samples = randomSamples();
    samples[5] = Number.NaN;
    expectExactTypeError(
      () =>
        encodeMdct(samples, { sampleRateHz: fs, frameLengthSamples: frame, bitsPerSecond: 128000 }),
      "encodeMdct: samples[5] is not finite (NaN)",
    );
    const infinite = randomSamples();
    infinite[9] = Number.POSITIVE_INFINITY;
    expectExactTypeError(
      () =>
        encodeMdct(infinite, {
          sampleRateHz: fs,
          frameLengthSamples: frame,
          bitsPerSecond: 128000,
        }),
      "encodeMdct: samples[9] is not finite (Infinity)",
    );
  });

  it("rejects invalid sampleRateHz/bitsPerSecond with the pinned RangeErrors", () => {
    const samples = randomSamples();
    for (const badRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectExactRangeError(
        () =>
          encodeMdct(samples, {
            sampleRateHz: badRate,
            frameLengthSamples: frame,
            bitsPerSecond: 128000,
          }),
        `encodeMdct: sampleRateHz must be finite and > 0 (got ${badRate})`,
      );
    }
    for (const badRate of [0, -5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expectExactRangeError(
        () =>
          encodeMdct(samples, {
            sampleRateHz: fs,
            frameLengthSamples: frame,
            bitsPerSecond: badRate,
          }),
        `encodeMdct: bitsPerSecond must be finite and > 0 (got ${badRate})`,
      );
    }
  });

  it("delegates frameLengthSamples validation to mdct (typed message)", () => {
    const samples = randomSamples();
    expectExactRangeError(
      () => encodeMdct(samples, { sampleRateHz: fs, frameLengthSamples: 2, bitsPerSecond: 128000 }),
      "mdct: frameLengthSamples must be an even integer >= 4 (got 2)",
    );
    expectExactRangeError(
      () => encodeMdct(samples, { sampleRateHz: fs, frameLengthSamples: 3, bitsPerSecond: 128000 }),
      "mdct: frameLengthSamples must be an even integer >= 4 (got 3)",
    );
  });
});

/**
 * DECODE GUARDS and STREAM CORRUPTION: typed container guards, the cascade
 * of huffmanDecode errors (truncated bitstream / invalid huffman code /
 * invalid huffman codebook), and the decoded-byte-count container check.
 */
describe("decode guards and stream corruption", () => {
  function sampleEncoded(): MdctCodecEncoded {
    return encodeMdct(randomSamples(), {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 128000,
    });
  }

  it("rejects malformed container fields with the pinned TypeErrors", () => {
    const encoded = sampleEncoded();
    expectExactTypeError(
      () =>
        decodeMdct(
          { ...encoded, bits: 7 as unknown as Uint8Array },
          { sampleRateHz: fs, frameLengthSamples: frame },
        ),
      "decodeMdct: encoded.bits must be a Uint8Array",
    );
    expectExactTypeError(
      () =>
        decodeMdct(
          { ...encoded, codebook: { codeLengths: "x" as unknown as Uint8Array } },
          { sampleRateHz: fs, frameLengthSamples: frame },
        ),
      "decodeMdct: encoded.codebook.codeLengths must be a Uint8Array",
    );
    expectExactTypeError(
      () =>
        decodeMdct(
          { ...encoded, coefficients: 9 as unknown as Float64Array[] },
          { sampleRateHz: fs, frameLengthSamples: frame },
        ),
      "decodeMdct: encoded.coefficients must be an array",
    );
    expectExactTypeError(
      () =>
        decodeMdct(
          { ...encoded, steps: "x" as unknown as Float64Array },
          { sampleRateHz: fs, frameLengthSamples: frame },
        ),
      "decodeMdct: encoded.steps must be a Float64Array",
    );
  });

  it("rejects invalid sampleRateHz/frameLengthSamples/bitLength with pinned RangeErrors", () => {
    const encoded = sampleEncoded();
    expectExactRangeError(
      () => decodeMdct(encoded, { sampleRateHz: 0, frameLengthSamples: frame }),
      "decodeMdct: sampleRateHz must be finite and > 0 (got 0)",
    );
    expectExactRangeError(
      () => decodeMdct(encoded, { sampleRateHz: fs, frameLengthSamples: 3 }),
      "decodeMdct: frameLengthSamples must be an even integer >= 4 (got 3)",
    );
    expectExactRangeError(
      () =>
        decodeMdct({ ...encoded, bitLength: 1.5 }, { sampleRateHz: fs, frameLengthSamples: frame }),
      "decodeMdct: encoded.bitLength must be a non-negative integer (got 1.5)",
    );
  });

  it("rejects steps/frame-count mismatch and short coefficient frames", () => {
    const encoded = sampleEncoded();
    expectExactRangeError(
      () =>
        decodeMdct(
          { ...encoded, steps: new Float64Array(encoded.steps.length + 1) },
          { sampleRateHz: fs, frameLengthSamples: frame },
        ),
      `decodeMdct: encoded.steps holds ${encoded.steps.length + 1} entries for ${encoded.coefficients.length} frames`,
    );
    const shortFrame = encoded.coefficients.map((frameQ, index) =>
      index === 0 ? frameQ.slice(0, hop - 1) : frameQ,
    );
    expectExactRangeError(
      () =>
        decodeMdct(
          { ...encoded, coefficients: shortFrame },
          { sampleRateHz: fs, frameLengthSamples: frame },
        ),
      `decodeMdct: encoded.coefficients[0] holds ${hop - 1} coefficients, expected hop ${hop}`,
    );
  });

  it("propagates the truncated-bitstream error from a cut stream", () => {
    const encoded = sampleEncoded();
    const truncated = encoded.bits.slice(0, Math.max(0, encoded.bits.length - 3));
    expectExactRangeError(
      () =>
        decodeMdct(
          { ...encoded, bits: truncated },
          { sampleRateHz: fs, frameLengthSamples: frame },
        ),
      "truncated bitstream",
    );
  });

  it("propagates the invalid-code error when a silenced stream bit flips", () => {
    const silence = encodeMdct(new Float32Array(fs), {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 128000,
    });
    // Silence encodes every symbol 0x00 with a 1-bit code "0"; flipping the
    // first bit makes the bounded walk miss every leaf (plan-04 T2 error).
    const corrupted = Uint8Array.from(silence.bits);
    corrupted[0] = 0x80;
    expectExactRangeError(
      () =>
        decodeMdct(
          { ...silence, bits: corrupted },
          { sampleRateHz: fs, frameLengthSamples: frame },
        ),
      "invalid huffman code",
    );
  });
});

/**
 * DETERMINISM and IMMUTABILITY (Review Focus 2 style + dispatch): the same
 * input encodes to byte-identical streams; decoding is a pure read of the
 * container; nothing mutates inputs or the container.
 */
describe("determinism and immutability", () => {
  it("encodes the same input to byte-identical streams twice", () => {
    const samples = randomSamples();
    const first = encodeMdct(samples, {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 128000,
    });
    const second = encodeMdct(samples, {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 128000,
    });
    expect(second.bits).toEqual(first.bits);
    expect(second.bitLength).toBe(first.bitLength);
    expect(second.codebook.codeLengths).toEqual(first.codebook.codeLengths);
    expect(Array.from(second.steps)).toEqual(Array.from(first.steps));
    expect(second.stats).toEqual(first.stats);
  });

  it("decodes the same container to identical output twice, without mutating it", () => {
    const samples = randomSamples();
    const encoded = encodeMdct(samples, {
      sampleRateHz: fs,
      frameLengthSamples: frame,
      bitsPerSecond: 128000,
    });
    const stepsSnapshot = Float64Array.from(encoded.steps);
    const coefficientsSnapshot = encoded.coefficients.map((frameQ) => Float64Array.from(frameQ));
    const bitsSnapshot = Uint8Array.from(encoded.bits);
    const first = decodeMdct(encoded, { sampleRateHz: fs, frameLengthSamples: frame });
    const second = decodeMdct(encoded, { sampleRateHz: fs, frameLengthSamples: frame });
    expect(Array.from(second)).toEqual(Array.from(first));
    expect(Array.from(encoded.steps)).toEqual(Array.from(stepsSnapshot));
    expect(encoded.coefficients.map((frame) => Array.from(frame))).toEqual(
      coefficientsSnapshot.map((frame) => Array.from(frame)),
    );
    expect(Array.from(encoded.bits)).toEqual(Array.from(bitsSnapshot));
  });

  it("never mutates its input samples and returns fresh arrays", () => {
    const samples = randomSamples();
    const snapshot = Float32Array.from(samples);
    const params = { sampleRateHz: fs, frameLengthSamples: frame, bitsPerSecond: 128000 };
    const encoded = encodeMdct(samples, params);
    expect(Array.from(samples)).toEqual(Array.from(snapshot));
    // The coefficients readout is a fresh array per encode: mutating one
    // result must not influence a fresh encode of the same input.
    encoded.coefficients[0]?.fill(55);
    expect(Array.from(encoded.coefficients[0] ?? [])).toContain(55);
    const fresh = encodeMdct(samples, params);
    expect(Array.from(fresh.coefficients[0] ?? [])).not.toContain(55);
    const decoded = decodeMdct(fresh, { sampleRateHz: fs, frameLengthSamples: frame });
    decoded[0] = 99;
    expect(Array.from(samples)).toEqual(Array.from(snapshot));
  });
});
