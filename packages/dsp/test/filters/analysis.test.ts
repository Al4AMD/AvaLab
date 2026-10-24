import { describe, expect, it } from "vitest";
import type { Complex, FreqzOptions } from "../../src/index.js";
import {
  designFirWindow,
  freqz,
  groupDelaySamples,
  impulseResponse,
  isStable,
  magnitudeDb,
  polesZeros,
  stepResponse,
  unwrapPhase,
} from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("filter_analysis");
const SAMPLE_RATE_HZ = 48000;
const NUM_POINTS = 512;
const STEP_SAMPLES = 64;
/**
 * At a transmission zero |H| = 0, the phase is undefined: independent
 * evaluations can return a residual phase anywhere on the unit circle. The
 * phase comparison therefore masks bins where |H| is at or below this floor.
 */
const PHASE_MAGNITUDE_FLOOR = 1e-6;
/**
 * The group-delay estimate divides a phase difference by Δω; near a zero the
 * phase is ill-conditioned and the finite difference is not meaningful. Only
 * bins whose own and neighbouring magnitudes exceed this floor are compared.
 */
const GROUP_DELAY_MAGNITUDE_FLOOR = 1e-3;
const LINEAR_PHASE_GROUP_DELAY_SAMPLES = 15;

interface Root {
  re: number;
  im: number;
}

const filterCases = golden.cases.filter((goldenCase) => goldenCase.params.kind === "filter");
const rootsCase = golden.cases.find((goldenCase) => goldenCase.params.kind === "roots");
if (rootsCase === undefined) {
  throw new Error("filter_analysis fixture is missing the distinct-root case");
}
const wrappedPhaseCase = golden.cases.find(
  (goldenCase) => goldenCase.params.kind === "wrappedPhase",
);
if (wrappedPhaseCase === undefined) {
  throw new Error("filter_analysis fixture is missing the wrapped-phase case");
}

function bOf(goldenCase: GoldenCase): Float64Array {
  return Float64Array.from(asNumberArray(goldenCase.params.b, `${goldenCase.name}.params.b`));
}

function aOf(goldenCase: GoldenCase): Float64Array {
  return Float64Array.from(asNumberArray(goldenCase.params.a, `${goldenCase.name}.params.a`));
}

function optionsOf(goldenCase: GoldenCase): FreqzOptions {
  return {
    numPoints: asNumber(goldenCase.params.numPoints, `${goldenCase.name}.params.numPoints`),
    sampleRateHz: asNumber(
      goldenCase.params.sampleRateHz,
      `${goldenCase.name}.params.sampleRateHz`,
    ),
  };
}

function expectedArrayOf(goldenCase: GoldenCase, key: string): number[] {
  return asNumberArray(goldenCase.expected[key], `${goldenCase.name}.expected.${key}`);
}

function expectedRootsOf(goldenCase: GoldenCase, prefix: "poles" | "zeros"): Root[] {
  const re = expectedArrayOf(goldenCase, `${prefix}Re`);
  const im = expectedArrayOf(goldenCase, `${prefix}Im`);
  return re.map((value, index) => ({ re: value, im: im[index] ?? Number.NaN }));
}

function rootsOf(complex: Complex): Root[] {
  return Array.from(complex.re, (re, index) => ({
    re,
    im: complex.im[index] ?? Number.NaN,
  }));
}

function sortKey(root: Root): readonly [number, number, number] {
  return [Math.round(Math.hypot(root.re, root.im) * 1e12), root.re, root.im];
}

function sortedRoots(roots: readonly Root[]): Root[] {
  return [...roots].sort((left, right) => {
    const leftKey = sortKey(left);
    const rightKey = sortKey(right);
    for (let index = 0; index < leftKey.length; index += 1) {
      const difference = (leftKey[index] ?? 0) - (rightKey[index] ?? 0);
      if (difference !== 0) {
        return difference;
      }
    }
    return 0;
  });
}

function expectArrayClose(
  actual: Float64Array,
  expected: readonly number[],
  rtol: number,
  atol: number,
  label: string,
  mask?: readonly boolean[],
): number {
  expect(actual.length, `${label} length`).toBe(expected.length);
  if (mask !== undefined) {
    expect(mask.length, `${label} mask length`).toBe(expected.length);
  }
  let compared = 0;
  for (let index = 0; index < expected.length; index += 1) {
    if (mask !== undefined && mask[index] !== true) {
      continue;
    }
    compared += 1;
    const actualValue = actual[index] ?? Number.NaN;
    const expectedValue = expected[index] ?? Number.NaN;
    const difference = Math.abs(actualValue - expectedValue);
    const allowed = Math.max(atol, rtol * Math.abs(expectedValue));
    expect(
      difference,
      `${label}[${index}]: |${actualValue} - ${expectedValue}| = ${difference} exceeds ${allowed}`,
    ).toBeLessThanOrEqual(allowed);
  }
  return compared;
}

function expectRootsClose(
  actual: readonly Root[],
  expected: readonly Root[],
  rtol: number,
  atol: number,
  label: string,
): void {
  expect(actual.length, `${label} length`).toBe(expected.length);
  // Match each expected root to its nearest unused actual root. The golden
  // order is pinned, but a conjugate pair's real parts can differ by one ulp
  // in the independent solvers; matching by position would then compare
  // z with conj(z). Distances are still the pinned root-to-root tolerance.
  const remaining = [...actual];
  for (const expectedRoot of sortedRoots(expected)) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (candidate === undefined) {
        continue;
      }
      const distance = Math.hypot(candidate.re - expectedRoot.re, candidate.im - expectedRoot.im);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    const allowed = Math.max(atol, rtol * Math.hypot(expectedRoot.re, expectedRoot.im));
    expect(
      bestDistance,
      `${label}: nearest root to (${expectedRoot.re}, ${expectedRoot.im}) is ${bestDistance} > ${allowed}`,
    ).toBeLessThanOrEqual(allowed);
    remaining.splice(bestIndex, 1);
  }
}

function evaluateDescending(coefficients: readonly number[], value: Root): Root {
  let re = coefficients[0] ?? 0;
  let im = 0;
  for (let index = 1; index < coefficients.length; index += 1) {
    const nextRe = re * value.re - im * value.im + (coefficients[index] ?? 0);
    const nextIm = re * value.im + im * value.re;
    re = nextRe;
    im = nextIm;
  }
  return { re, im };
}

/**
 * Numerator residual `|B(z)| / max(1, |z|)^degree` at each returned root.
 * For repeated roots this property, the root count and the cluster location
 * replace the (ill-conditioned) root-to-root check.
 */
function numeratorResidual(coefficients: readonly number[], roots: readonly Root[]): number {
  const degree = coefficients.length - 1;
  let worst = 0;
  for (const root of roots) {
    const value = evaluateDescending(coefficients, root);
    const scale = Math.max(1, Math.hypot(root.re, root.im)) ** degree;
    const residual = Math.hypot(value.re, value.im) / scale;
    worst = Math.max(worst, residual);
  }
  return worst;
}

function phaseMaskOf(goldenCase: GoldenCase): boolean[] {
  return expectedArrayOf(goldenCase, "magnitude").map(
    (magnitude) => magnitude > PHASE_MAGNITUDE_FLOOR,
  );
}

function groupDelayMaskOf(goldenCase: GoldenCase): boolean[] {
  const magnitude = expectedArrayOf(goldenCase, "magnitude");
  return magnitude.map((value, index) => {
    if (!(value > GROUP_DELAY_MAGNITUDE_FLOOR)) {
      return false;
    }
    const previous = index > 0 ? magnitude[index - 1] : undefined;
    const next = index + 1 < magnitude.length ? magnitude[index + 1] : undefined;
    return (
      (previous === undefined || previous > GROUP_DELAY_MAGNITUDE_FLOOR) &&
      (next === undefined || next > GROUP_DELAY_MAGNITUDE_FLOOR)
    );
  });
}

function expectThrows(
  action: () => unknown,
  errorType: typeof TypeError | typeof RangeError,
  messagePart: string,
): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(errorType);
  expect(thrown instanceof Error ? thrown.message : "").toContain(messagePart);
}

function complexOf(re: readonly number[], im: readonly number[]): Complex {
  return { re: Float64Array.from(re), im: Float64Array.from(im) };
}

describe("filter_analysis fixture", () => {
  it("loads the committed golden fixture with the pinned cases", () => {
    expect(golden.algorithm).toBe("filter_analysis");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "butterworth_lowpass_order4_fc4000_fs48000",
      "rbj_lowpass_fc1000_q0.7071_fs48000",
      "fir_lowpass_31_hamming_fc4000_fs48000_distinct_zeros",
      "wrapped_phase_sequence",
    ]);
    expect(filterCases).toHaveLength(2);
    expect(filterCases.map((goldenCase) => goldenCase.name)).toEqual([
      "butterworth_lowpass_order4_fc4000_fs48000",
      "rbj_lowpass_fc1000_q0.7071_fs48000",
    ]);
  });

  it("pins the reference tolerances", () => {
    for (const goldenCase of filterCases) {
      expect(goldenCase.tolerance.rtol).toBe(1e-9);
    }
    expect(rootsCase.tolerance.rtol).toBe(1e-8);
    expect(wrappedPhaseCase.tolerance.rtol).toBe(1e-12);
  });
});

describe("freqz", () => {
  it.each(filterCases)("uses an inclusive grid from 0 to Nyquist for $name", (goldenCase) => {
    const actual = freqz(bOf(goldenCase), aOf(goldenCase), optionsOf(goldenCase));
    expect(actual.frequencyHz.length).toBe(NUM_POINTS);
    expect(actual.frequencyHz[0]).toBe(0);
    expect(actual.frequencyHz[NUM_POINTS - 1]).toBe(SAMPLE_RATE_HZ / 2);
    const expectedStep = SAMPLE_RATE_HZ / 2 / (NUM_POINTS - 1);
    for (let index = 1; index < NUM_POINTS; index += 1) {
      expect(actual.frequencyHz[index]).toBeGreaterThan(actual.frequencyHz[index - 1] ?? 0);
      expect(
        Math.abs((actual.frequencyHz[index] ?? 0) - index * expectedStep),
        `frequencyHz[${index}]`,
      ).toBeLessThanOrEqual(1e-9);
    }
  });

  it.each(filterCases)("matches scipy freqz magnitude for $name", (goldenCase) => {
    const actual = freqz(bOf(goldenCase), aOf(goldenCase), optionsOf(goldenCase));
    expectArrayClose(
      actual.magnitude,
      expectedArrayOf(goldenCase, "magnitude"),
      goldenCase.tolerance.rtol,
      goldenCase.tolerance.atol,
      `${goldenCase.name} magnitude`,
    );
  });

  it.each(filterCases)(
    "matches scipy wrapped phase where it is defined for $name",
    (goldenCase) => {
      const actual = freqz(bOf(goldenCase), aOf(goldenCase), optionsOf(goldenCase));
      const compared = expectArrayClose(
        actual.phaseRad,
        expectedArrayOf(goldenCase, "phaseWrapped"),
        1e-9,
        1e-12,
        `${goldenCase.name} phaseRad`,
        phaseMaskOf(goldenCase),
      );
      // The zero at z = -1 removes only a handful of bins (deep stopband).
      expect(compared).toBeGreaterThan(400);
    },
  );

  it("rejects a filter with a pole on the unit circle", () => {
    expectThrows(
      () =>
        freqz(Float64Array.of(1), Float64Array.of(1, -1), {
          numPoints: 3,
          sampleRateHz: SAMPLE_RATE_HZ,
        }),
      RangeError,
      "pole on the unit circle at 0 Hz",
    );
  });

  it("returns a flat unit response for b = a = [1]", () => {
    const actual = freqz(Float64Array.of(1), Float64Array.of(1), {
      numPoints: 16,
      sampleRateHz: SAMPLE_RATE_HZ,
    });
    for (let index = 0; index < 16; index += 1) {
      expect(actual.magnitude[index]).toBe(1);
      expect(actual.phaseRad[index]).toBe(0);
    }
  });
});

describe("magnitudeDb", () => {
  it("converts linear magnitudes to decibels and maps zero to -Infinity", () => {
    const result = magnitudeDb(Float64Array.of(1, 0.1, 0.001, 0));
    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(-20, 12);
    expect(result[2]).toBeCloseTo(-60, 12);
    expect(result[3]).toBe(Number.NEGATIVE_INFINITY);
  });

  it("rejects non-finite and negative magnitudes", () => {
    expectThrows(
      () => magnitudeDb(Float64Array.of(1, Number.NaN)),
      TypeError,
      "magnitude[1] must be finite",
    );
    expectThrows(
      () => magnitudeDb(Float64Array.of(-1)),
      RangeError,
      "magnitude[0] must be non-negative",
    );
    expectThrows(
      () => magnitudeDb([1] as unknown as Float64Array),
      TypeError,
      "must be a Float64Array",
    );
  });
});

describe("unwrapPhase", () => {
  it("matches numpy.unwrap for the synthetic wrapped sequence", () => {
    const actual = unwrapPhase(
      Float64Array.from(expectedArrayOf(wrappedPhaseCase, "wrappedPhase")),
    );
    expectArrayClose(
      actual,
      expectedArrayOf(wrappedPhaseCase, "unwrappedPhase"),
      wrappedPhaseCase.tolerance.rtol,
      wrappedPhaseCase.tolerance.atol,
      "wrapped_phase_sequence",
    );
  });

  it.each(filterCases)("matches numpy.unwrap of the scipy phase for $name", (goldenCase) => {
    const actual = unwrapPhase(Float64Array.from(expectedArrayOf(goldenCase, "phaseWrapped")));
    expectArrayClose(
      actual,
      expectedArrayOf(goldenCase, "phaseUnwrapped"),
      1e-12,
      1e-12,
      `${goldenCase.name} phaseUnwrapped`,
    );
  });

  it("handles empty, single and exact +pi/-pi boundaries", () => {
    expect(Array.from(unwrapPhase(new Float64Array(0)))).toEqual([]);
    expect(Array.from(unwrapPhase(Float64Array.of(2.5)))).toEqual([2.5]);
    expect(Array.from(unwrapPhase(Float64Array.of(Math.PI, -Math.PI)))).toEqual([Math.PI, Math.PI]);
  });

  it("rejects non-finite phase values", () => {
    expectThrows(
      () => unwrapPhase(Float64Array.of(0, Number.POSITIVE_INFINITY)),
      TypeError,
      "phase[1] must be finite",
    );
  });
});

describe("groupDelaySamples", () => {
  it.each(filterCases)("matches the pinned finite difference for $name", (goldenCase) => {
    const actual = groupDelaySamples(bOf(goldenCase), aOf(goldenCase), optionsOf(goldenCase));
    const compared = expectArrayClose(
      actual,
      expectedArrayOf(goldenCase, "groupDelaySamples"),
      1e-9,
      1e-12,
      `${goldenCase.name} groupDelaySamples`,
      groupDelayMaskOf(goldenCase),
    );
    expect(compared).toBeGreaterThan(300);
  });

  it("reports a one-sample delay for H(z) = z^-1", () => {
    const actual = groupDelaySamples(Float64Array.of(0, 1), Float64Array.of(1), {
      numPoints: 16,
      sampleRateHz: SAMPLE_RATE_HZ,
    });
    for (let index = 0; index < actual.length; index += 1) {
      expect(Math.abs((actual[index] ?? 0) - 1)).toBeLessThanOrEqual(1e-12);
    }
  });

  it("reports the linear-phase group delay of a symmetric FIR", () => {
    const taps = designFirWindow({
      band: "lowpass",
      cutoffHz: [4000],
      taps: 31,
      sampleRateHz: SAMPLE_RATE_HZ,
      windowFilter: { kind: "hamming" },
    });
    const actual = groupDelaySamples(taps, Float64Array.of(1), {
      numPoints: NUM_POINTS,
      sampleRateHz: SAMPLE_RATE_HZ,
    });
    for (let index = 0; index < NUM_POINTS; index += 1) {
      const frequencyHz = (index * (SAMPLE_RATE_HZ / 2)) / (NUM_POINTS - 1);
      if (frequencyHz <= 3000) {
        expect(
          Math.abs((actual[index] ?? 0) - LINEAR_PHASE_GROUP_DELAY_SAMPLES),
          `groupDelaySamples[${index}]`,
        ).toBeLessThanOrEqual(1e-6);
      }
    }
  });
});

describe("impulseResponse and stepResponse", () => {
  it.each(filterCases)("matches scipy lfilter step response for $name", (goldenCase) => {
    const actual = stepResponse(bOf(goldenCase), aOf(goldenCase), STEP_SAMPLES);
    expectArrayClose(
      actual,
      expectedArrayOf(goldenCase, "stepResponseSamples"),
      1e-12,
      1e-12,
      `${goldenCase.name} stepResponseSamples`,
    );
  });

  it.each(filterCases)("keeps h[n] = s[n] - s[n-1] for $name", (goldenCase) => {
    const b = bOf(goldenCase);
    const a = aOf(goldenCase);
    const impulse = impulseResponse(b, a, STEP_SAMPLES);
    const step = stepResponse(b, a, STEP_SAMPLES);
    for (let index = 0; index < STEP_SAMPLES; index += 1) {
      const previous = index === 0 ? 0 : (step[index - 1] ?? 0);
      expect(
        Math.abs((impulse[index] ?? 0) - ((step[index] ?? 0) - previous)),
        `impulseResponse[${index}]`,
      ).toBeLessThanOrEqual(1e-12);
    }
  });

  it("returns an empty response for n = 0", () => {
    expect(impulseResponse(Float64Array.of(1), Float64Array.of(1), 0)).toHaveLength(0);
    expect(stepResponse(Float64Array.of(1), Float64Array.of(1), 0)).toHaveLength(0);
  });
});

describe("polesZeros", () => {
  it.each(filterCases)("matches scipy poles for $name", (goldenCase) => {
    const actual = polesZeros(bOf(goldenCase), aOf(goldenCase));
    expectRootsClose(
      rootsOf(actual.poles),
      expectedRootsOf(goldenCase, "poles"),
      1e-8,
      1e-12,
      `${goldenCase.name} poles`,
    );
    expect(rootsOf(actual.poles).length).toBeGreaterThan(0);
  });

  it.each(filterCases)(
    "places repeated zeros at the known cluster and keeps the monic residual small for $name",
    (goldenCase) => {
      const b = bOf(goldenCase);
      const actual = polesZeros(b, aOf(goldenCase));
      const zeros = rootsOf(actual.zeros);
      const multiplicity = asNumber(
        goldenCase.expected.zeroMultiplicity,
        `${goldenCase.name}.expected.zeroMultiplicity`,
      );
      const clusterRe = asNumber(
        goldenCase.expected.zeroClusterRe,
        `${goldenCase.name}.expected.zeroClusterRe`,
      );
      const clusterIm = asNumber(
        goldenCase.expected.zeroClusterIm,
        `${goldenCase.name}.expected.zeroClusterIm`,
      );
      expect(zeros.length).toBe(multiplicity);
      for (const zero of zeros) {
        expect(
          Math.hypot(zero.re - clusterRe, zero.im - clusterIm),
          `${goldenCase.name} repeated zero cluster`,
        ).toBeLessThanOrEqual(1e-3);
      }
      expect(numeratorResidual(Array.from(b), zeros)).toBeLessThanOrEqual(1e-8);
    },
  );

  it("matches numpy.roots for the distinct FIR zeros designed by designFirWindow", () => {
    const taps = designFirWindow({
      band: "lowpass",
      cutoffHz: [4000],
      taps: 31,
      sampleRateHz: SAMPLE_RATE_HZ,
      windowFilter: { kind: "hamming" },
    });
    expectArrayClose(
      taps,
      asNumberArray(rootsCase.params.b, `${rootsCase.name}.params.b`),
      rootsCase.tolerance.rtol,
      rootsCase.tolerance.atol,
      "fir taps",
    );
    const actual = polesZeros(taps, Float64Array.of(1));
    expect(actual.poles.re).toHaveLength(0);
    expect(actual.poles.im).toHaveLength(0);
    expectRootsClose(
      rootsOf(actual.zeros),
      expectedRootsOf(rootsCase, "zeros"),
      rootsCase.tolerance.rtol,
      rootsCase.tolerance.atol,
      "fir zeros",
    );
  });

  it("recovers the simple roots of a known polynomial", () => {
    // z^4 - 1.45 z^3 + 1.175 z^2 - 0.1 z - 0.125
    //   = (z - 0.5)(z + 0.25)(z - 0.6 - 0.8j)(z - 0.6 + 0.8j)
    const coefficients = Float64Array.of(1, -1.45, 1.175, -0.1, -0.125);
    const actual = polesZeros(coefficients, Float64Array.of(1));
    expect(actual.poles.re).toHaveLength(0);
    expect(actual.poles.im).toHaveLength(0);
    expectRootsClose(
      rootsOf(actual.zeros),
      [
        { re: 0.5, im: 0 },
        { re: -0.25, im: 0 },
        { re: 0.6, im: 0.8 },
        { re: 0.6, im: -0.8 },
      ],
      1e-8,
      1e-12,
      "known polynomial zeros",
    );
  });

  it("is deterministic and does not mutate its inputs", () => {
    const goldenCase = filterCases[0];
    if (goldenCase === undefined) {
      throw new Error("filter_analysis fixture has no filter case");
    }
    const b = bOf(goldenCase);
    const a = aOf(goldenCase);
    const originalB = Array.from(b);
    const originalA = Array.from(a);
    const first = polesZeros(b, a);
    const second = polesZeros(b, a);
    expect(Array.from(first.poles.re)).toEqual(Array.from(second.poles.re));
    expect(Array.from(first.poles.im)).toEqual(Array.from(second.poles.im));
    expect(Array.from(first.zeros.re)).toEqual(Array.from(second.zeros.re));
    expect(Array.from(first.zeros.im)).toEqual(Array.from(second.zeros.im));
    expect(Array.from(b)).toEqual(originalB);
    expect(Array.from(a)).toEqual(originalA);
  });
});

describe("isStable", () => {
  it.each(filterCases)("accepts the designed filter poles for $name", (goldenCase) => {
    const poles = polesZeros(bOf(goldenCase), aOf(goldenCase)).poles;
    expect(isStable(poles)).toBe(true);
  });

  it("treats an empty pole set as stable", () => {
    expect(isStable(complexOf([], []))).toBe(true);
  });

  it("uses the strict |z| < 1 - tolerance rule", () => {
    expect(isStable(complexOf([0.5], [0]))).toBe(true);
    expect(isStable(complexOf([1], [0]))).toBe(false);
    expect(isStable(complexOf([1], [1e-3]))).toBe(false);
    expect(isStable(complexOf([1 + 1e-9], [0]))).toBe(false);
    expect(isStable(complexOf([1 - 1e-6], [0]), 1e-6)).toBe(false);
    expect(isStable(complexOf([1 - 1e-6], [0]), 1e-7)).toBe(true);
    expect(isStable(complexOf([0], [1.0001]))).toBe(false);
  });

  it("rejects malformed pole data", () => {
    expectThrows(() => isStable(complexOf([0.5], [0, 0])), RangeError, "equal lengths");
    expectThrows(() => isStable(complexOf([Number.NaN], [0])), TypeError, "pole[0] must be finite");
    expectThrows(
      () => isStable(complexOf([0.5], [0]), -1),
      RangeError,
      "tolerance must be finite and >= 0",
    );
  });
});

describe("filter analysis guards", () => {
  it("rejects invalid coefficient arrays and options", () => {
    const b = Float64Array.of(1);
    const a = Float64Array.of(1);
    const options: FreqzOptions = { numPoints: 16, sampleRateHz: SAMPLE_RATE_HZ };
    expectThrows(() => freqz(new Float64Array(0), a, options), RangeError, "must not be empty");
    expectThrows(() => freqz(b, new Float64Array(0), options), RangeError, "must not be empty");
    expectThrows(
      () => freqz(Float64Array.of(Number.NaN), a, options),
      TypeError,
      "b[0] must be finite",
    );
    expectThrows(
      () => freqz(b, Float64Array.of(0, 1), options),
      RangeError,
      "a[0] must be non-zero",
    );
    expectThrows(
      () => freqz(b, a, { numPoints: 1, sampleRateHz: SAMPLE_RATE_HZ }),
      RangeError,
      "numPoints must be an integer >= 2",
    );
    expectThrows(
      () => freqz(b, a, { numPoints: 2.5, sampleRateHz: SAMPLE_RATE_HZ }),
      RangeError,
      "numPoints must be an integer >= 2",
    );
    expectThrows(
      () => freqz(b, a, { numPoints: 16, sampleRateHz: 0 }),
      RangeError,
      "sampleRateHz must be finite and > 0",
    );
    expectThrows(
      () => freqz(b, a, null as unknown as FreqzOptions),
      RangeError,
      "options must be an object",
    );
  });

  it("rejects invalid response lengths", () => {
    expectThrows(
      () => impulseResponse(Float64Array.of(1), Float64Array.of(1), -1),
      RangeError,
      "n must be a non-negative integer",
    );
    expectThrows(
      () => stepResponse(Float64Array.of(1), Float64Array.of(1), 1.5),
      RangeError,
      "n must be a non-negative integer",
    );
  });
});
