import { describe, expect, it } from "vitest";
import {
  buildSpectrumPreset,
  editSpectrum,
  type SpectrumEdit,
  type SpectrumEditTarget,
  type SpectrumPreset,
} from "../../src/index.js";
import { asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("spectrum_edit");

function signal(length: number): Float64Array {
  const samples = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin(0.31 * index) + 0.2 * Math.cos(0.07 * index);
  }
  return samples;
}

function edit(
  target: SpectrumEditTarget,
  mode: SpectrumEdit["mode"],
  value: number,
  startBin = 0,
  endBin = startBin + 1,
): SpectrumEdit {
  return { startBin, endBin, target, mode, value };
}

function expectSamplesClose(actual: Float64Array, expected: Float64Array, tolerance = 1e-9): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(Math.abs((actual[index] ?? 0) - (expected[index] ?? 0))).toBeLessThanOrEqual(tolerance);
  }
}

describe("editSpectrum identity", () => {
  it("reproduces a power-of-two input with no edits and Hermitian ON", () => {
    const input = signal(1024);
    const result = editSpectrum(input, { edits: [], hermitian: true });
    expectSamplesClose(result.samples, input, 1e-9);
    expect(result.imaginaryEnergyRatio).toBeLessThan(1e-20);
    expect(result.re.length).toBe(513);
  });

  it("reproduces a non-power-of-two input after zero-padding and truncation", () => {
    const input = signal(1000);
    const result = editSpectrum(input, { edits: [], hermitian: true });
    expectSamplesClose(result.samples, input, 1e-9);
  });

  it("accepts a larger explicit power-of-two FFT length", () => {
    const input = signal(1000);
    const result = editSpectrum(input, {
      fftLengthSamples: 2048,
      edits: [],
      hermitian: true,
    });
    expectSamplesClose(result.samples, input, 1e-9);
    expect(result.re.length).toBe(1025);
  });

  it("handles a length-one frame", () => {
    const result = editSpectrum(Float64Array.from([0.5]), { edits: [], hermitian: true });
    expect(Array.from(result.samples)).toEqual([0.5]);
    expect(result.re.length).toBe(1);
  });
});

describe("editSpectrum representation semantics", () => {
  it("treats zeroing Im on a bin-centered cosine as a no-op", () => {
    const input = new Float64Array(512);
    for (let index = 0; index < input.length; index += 1) {
      input[index] = Math.cos((2 * Math.PI * 8 * index) / input.length);
    }
    const result = editSpectrum(input, {
      edits: [edit("im", "zero", 0, 0, 257)],
      hermitian: true,
    });
    expectSamplesClose(result.samples, input, 1e-9);
  });

  it("zeroes the signal when Re is zeroed on an impulse spectrum", () => {
    const input = new Float64Array(64);
    input[0] = 1;
    const result = editSpectrum(input, {
      edits: [edit("re", "zero", 0, 0, 33)],
      hermitian: true,
    });
    expectSamplesClose(result.samples, new Float64Array(64), 1e-12);
  });

  it("keeps the phase when magnitude is edited", () => {
    const input = signal(256);
    const baseline = editSpectrum(input, { edits: [], hermitian: true });
    const edited = editSpectrum(input, {
      edits: [edit("mag", "set", 2, 7)],
      hermitian: true,
    });
    expect(edited.magnitude[7]).toBeCloseTo(2, 12);
    expect(edited.phase[7]).toBeCloseTo(baseline.phase[7] ?? 0, 12);
  });

  it("keeps the magnitude when phase is edited", () => {
    const input = signal(256);
    const baseline = editSpectrum(input, { edits: [], hermitian: true });
    const edited = editSpectrum(input, {
      edits: [edit("phase", "set", 0.5, 9)],
      hermitian: true,
    });
    expect(edited.phase[9]).toBeCloseTo(0.5, 12);
    expect(edited.magnitude[9]).toBeCloseTo(baseline.magnitude[9] ?? 0, 12);
  });

  it("zeros both Re and Im when magnitude is zeroed", () => {
    const result = editSpectrum(signal(128), {
      edits: [edit("mag", "zero", 0, 5)],
      hermitian: true,
    });
    expect(result.re[5]).toBe(0);
    expect(result.im[5]).toBe(0);
    expect(result.magnitude[5]).toBe(0);
  });

  it("sets phase to zero while keeping magnitude", () => {
    const input = signal(128);
    const baseline = editSpectrum(input, { edits: [], hermitian: true });
    const result = editSpectrum(input, {
      edits: [edit("phase", "zero", 0, 6)],
      hermitian: true,
    });
    expect(result.phase[6]).toBeCloseTo(0, 12);
    expect(result.magnitude[6]).toBeCloseTo(baseline.magnitude[6] ?? 0, 12);
  });
});

describe("editSpectrum Hermitian discipline", () => {
  it("mirrors X[L-k] = conj(X[k]) when ON and zeroes DC/Nyquist imaginary parts", () => {
    const result = editSpectrum(signal(64), {
      edits: [edit("re", "set", 0.5, 2), edit("im", "set", 0.25, 2)],
      hermitian: true,
    });
    expect(result.re[2]).toBeCloseTo(0.5, 12);
    expect(result.im[2]).toBeCloseTo(0.25, 12);
    expect(result.im[0]).toBe(0);
    expect(result.im[32]).toBe(0);
    expect(result.imaginaryEnergyRatio).toBeLessThan(1e-20);
  });

  it("leaves a complex inverse when OFF and reports the imaginary-energy ratio", () => {
    const result = editSpectrum(signal(64), {
      edits: [edit("re", "set", 1, 1)],
      hermitian: false,
    });
    expect(result.samples.length).toBe(64);
    expect(result.imaginaryEnergyRatio).toBeGreaterThan(0);
  });
});

describe("buildSpectrumPreset", () => {
  it("returns full-band zeroIm and zeroRe edits", () => {
    expect(buildSpectrumPreset("zeroIm", 5, 1)).toEqual([
      { startBin: 0, endBin: 5, target: "im", mode: "zero", value: 0 },
    ]);
    expect(buildSpectrumPreset("zeroRe", 5, 1)).toEqual([
      { startBin: 0, endBin: 5, target: "re", mode: "zero", value: 0 },
    ]);
  });

  it("makes magnitudeOnly and zeroPhase the same reconstruction", () => {
    const input = signal(256);
    const magnitudeOnly = editSpectrum(input, {
      edits: buildSpectrumPreset("magnitudeOnly", 129, 3),
      hermitian: true,
    });
    const zeroPhase = editSpectrum(input, {
      edits: buildSpectrumPreset("zeroPhase", 129, 3),
      hermitian: true,
    });
    expectSamplesClose(magnitudeOnly.samples, zeroPhase.samples, 1e-12);
  });

  it("builds a deterministic linear phase profile", () => {
    const edits = buildSpectrumPreset("linearPhase", 4, 0);
    expect(edits.length).toBe(4);
    expect(edits[0]?.value).toBe(0);
    expect(edits[3]?.value).toBeCloseTo((-Math.PI * 3) / 4, 12);
  });

  it("builds deterministic random phases from the seed", () => {
    const first = buildSpectrumPreset("randomPhase", 8, 42);
    const second = buildSpectrumPreset("randomPhase", 8, 42);
    const other = buildSpectrumPreset("randomPhase", 8, 43);
    expect(first).toEqual(second);
    expect(first).not.toEqual(other);
    expect(first.length).toBe(8);
  });

  it("rejects an unknown preset, a bad bin count and a non-integer seed", () => {
    expect(() => buildSpectrumPreset("bogus" as never, 4, 1)).toThrow(RangeError);
    expect(() => buildSpectrumPreset("zeroPhase", 0, 1)).toThrow(RangeError);
    expect(() => buildSpectrumPreset("randomPhase", 4, 1.5)).toThrow(RangeError);
  });
});

describe("editSpectrum golden presets", () => {
  it("pins the fixture names and tolerance", () => {
    expect(golden.algorithm).toBe("spectrum_edit");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "zeroIm_fixed8",
      "zeroRe_fixed8",
      "zeroPhase_fixed8",
      "magnitudeOnly_fixed8",
      "phaseOnly_fixed8",
    ]);
    for (const goldenCase of golden.cases) {
      expect(goldenCase.tolerance).toEqual({ rtol: 1e-12, atol: 0 });
    }
  });

  it.each(golden.cases)("matches the NumPy reference for $name", (goldenCase: GoldenCase) => {
    const preset = goldenCase.params.preset;
    if (typeof preset !== "string") {
      throw new Error(`params.preset of ${goldenCase.name} is not a string`);
    }
    const fftLengthSamples = goldenCase.params.fftLengthSamples;
    if (typeof fftLengthSamples !== "number") {
      throw new Error(`params.fftLengthSamples of ${goldenCase.name} is not a number`);
    }
    const input = Float64Array.from(goldenCase.input.samples);
    const result = editSpectrum(input, {
      fftLengthSamples,
      edits: buildSpectrumPreset(preset as SpectrumPreset, fftLengthSamples / 2 + 1, 1),
      hermitian: true,
    });
    const expected = asNumberArray(goldenCase.expected.samples, "expected.samples");
    expectSamplesClose(result.samples, Float64Array.from(expected), 1e-12);
  });
});

describe("editSpectrum guards", () => {
  it("rejects empty, non-finite and invalid edit inputs", () => {
    expect(() => editSpectrum(new Float64Array(0), { edits: [], hermitian: true })).toThrow(
      RangeError,
    );
    expect(() =>
      editSpectrum(Float64Array.from([0, Number.NaN]), { edits: [], hermitian: true }),
    ).toThrow(TypeError);
    expect(() =>
      editSpectrum(signal(8), { fftLengthSamples: 12, edits: [], hermitian: true }),
    ).toThrow(RangeError);
    expect(() =>
      editSpectrum(signal(8), { fftLengthSamples: 4, edits: [], hermitian: true }),
    ).toThrow(RangeError);
    expect(() =>
      editSpectrum(signal(8), {
        edits: [edit("re", "set", 1, -1, 2)],
        hermitian: true,
      }),
    ).toThrow(RangeError);
    expect(() =>
      editSpectrum(signal(8), {
        edits: [edit("re", "set", 1, 3, 2)],
        hermitian: true,
      }),
    ).toThrow(RangeError);
    expect(() =>
      editSpectrum(signal(8), {
        edits: [edit("re", "set", Number.POSITIVE_INFINITY, 0, 1)],
        hermitian: true,
      }),
    ).toThrow(RangeError);
    expect(() =>
      editSpectrum(signal(8), {
        edits: [{ ...edit("re", "set", 1), target: "bogus" as never }],
        hermitian: true,
      }),
    ).toThrow(RangeError);
    expect(() =>
      editSpectrum(signal(8), {
        edits: [{ ...edit("re", "set", 1), mode: "bogus" as never }],
        hermitian: true,
      }),
    ).toThrow(RangeError);
  });

  it("clamps an edit range that starts past the spectrum", () => {
    const input = signal(16);
    const result = editSpectrum(input, {
      edits: [edit("re", "set", 1, 20, 30)],
      hermitian: true,
    });
    expectSamplesClose(result.samples, input, 1e-9);
  });
});
