import { describe, expect, it } from "vitest";
import { i0, kaiser, type WindowKind, window, windowSymmetric } from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("windows");

const WINDOW_KINDS: readonly WindowKind[] = ["rect", "hann", "hamming", "blackman"];

function valueAt(values: Float64Array, index: number, label = "values"): number {
  const value: number | undefined = values[index];
  if (value === undefined) {
    throw new Error(`${label}[${index}] read out of bounds`);
  }
  return value;
}

function paramNumber(goldenCase: GoldenCase, key: string): number {
  return asNumber(goldenCase.params[key], `params.${key} of ${goldenCase.name}`);
}

function asWindowKind(value: unknown): WindowKind {
  for (const kind of WINDOW_KINDS) {
    if (value === kind) {
      return kind;
    }
  }
  throw new Error(`golden fixture kind is not a window kind: ${String(value)}`);
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

function expectSymmetric(values: Float64Array): void {
  const length = values.length;
  for (let n = 0; n < length; n += 1) {
    expectClose(
      valueAt(values, n),
      valueAt(values, length - 1 - n),
      { rtol: 0, atol: 1e-12 },
      `symmetry w[${n}] vs w[${length - 1 - n}]`,
    );
  }
}

describe("windows fixture", () => {
  it("loads the committed windows fixture", () => {
    expect(golden.algorithm).toBe("windows");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "periodic_rect_len64",
      "periodic_hann_len64",
      "periodic_hamming_len64",
      "periodic_blackman_len64",
      "periodic_rect_len2",
      "periodic_hann_len2",
      "periodic_hamming_len2",
      "periodic_blackman_len2",
      "symmetric_rect_len64",
      "symmetric_hann_len64",
      "symmetric_hamming_len64",
      "symmetric_blackman_len64",
      "kaiser_len64_beta8.6",
      "kaiser_len2_beta8.6",
      "i0_probe_x0.0",
      "i0_probe_x1.0",
      "i0_probe_x8.6",
      "i0_probe_x12.0",
    ]);
  });
});

describe("window / kaiser / i0 (golden)", () => {
  it.each(golden.cases)("matches scipy for $name", (goldenCase: GoldenCase) => {
    if (typeof goldenCase.params.kind === "string") {
      const kindValue = goldenCase.params.kind;
      const length = paramNumber(goldenCase, "length");
      const expected = asNumberArray(goldenCase.expected.w, "expected.w");
      const actual =
        kindValue === "kaiser"
          ? kaiser(length, paramNumber(goldenCase, "beta"))
          : goldenCase.params.sym === true
            ? windowSymmetric(asWindowKind(kindValue), length)
            : window(asWindowKind(kindValue), length);

      expect(actual.length).toBe(expected.length);
      expected.forEach((value, n) => {
        expectClose(valueAt(actual, n), value, goldenCase.tolerance, `w[${n}]`);
      });
      return;
    }

    const x = paramNumber(goldenCase, "x");
    expectClose(
      i0(x),
      asNumber(goldenCase.expected.value, "expected.value"),
      goldenCase.tolerance,
      `i0(${x})`,
    );
  });
});

describe("windowSymmetric (golden)", () => {
  const symmetricCases = golden.cases.filter((goldenCase) => goldenCase.params.sym === true);

  it("covers all four kinds at length 64", () => {
    expect(symmetricCases.map((goldenCase) => goldenCase.name)).toEqual([
      "symmetric_rect_len64",
      "symmetric_hann_len64",
      "symmetric_hamming_len64",
      "symmetric_blackman_len64",
    ]);
  });

  it.each(symmetricCases)(
    "matches the scipy sym=True values for $name",
    (goldenCase: GoldenCase) => {
      const kind = asWindowKind(goldenCase.params.kind);
      const length = paramNumber(goldenCase, "length");
      const expected = asNumberArray(goldenCase.expected.w, "expected.w");
      const actual = windowSymmetric(kind, length);

      expect(actual.length).toBe(expected.length);
      expected.forEach((value, n) => {
        expectClose(valueAt(actual, n), value, goldenCase.tolerance, `w[${n}]`);
      });
    },
  );
});

describe("window properties", () => {
  it("periodic hann has w[0] = 0", () => {
    const values = window("hann", 64);
    expect(Math.abs(valueAt(values, 0))).toBeLessThanOrEqual(1e-15);
  });

  it.each(WINDOW_KINDS)("symmetric %s is symmetric", (kind: WindowKind) => {
    expectSymmetric(windowSymmetric(kind, 64));
    expectSymmetric(windowSymmetric(kind, 63));
  });

  it.each(WINDOW_KINDS)("peak of %s stays within [0, 1] for both variants", (kind: WindowKind) => {
    for (const values of [window(kind, 64), windowSymmetric(kind, 64)]) {
      let peak = Number.NEGATIVE_INFINITY;
      let trough = Number.POSITIVE_INFINITY;
      for (const value of values) {
        peak = Math.max(peak, value);
        trough = Math.min(trough, value);
      }
      expect(peak).toBeLessThanOrEqual(1 + 1e-12);
      expect(trough).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("symmetric hann has zero endpoints", () => {
    const values = windowSymmetric("hann", 64);
    expect(Math.abs(valueAt(values, 0))).toBeLessThanOrEqual(1e-15);
    expect(Math.abs(valueAt(values, 63))).toBeLessThanOrEqual(1e-15);
  });

  it("rect is all ones for both variants", () => {
    expect(Array.from(window("rect", 8))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(Array.from(windowSymmetric("rect", 8))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("periodic hann satisfies COLA at 50% hop", () => {
    const hop = 32;
    const frameCount = 8;
    const values = window("hann", 64);
    const summed = new Float64Array((frameCount - 1) * hop + values.length);
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let n = 0; n < values.length; n += 1) {
        summed[frame * hop + n] = valueAt(summed, frame * hop + n) + valueAt(values, n);
      }
    }
    for (let n = hop; n <= (frameCount - 1) * hop; n += 1) {
      expectClose(valueAt(summed, n), 1, { rtol: 0, atol: 1e-12 }, `COLA summed[${n}]`);
    }
  });
});

describe("kaiser properties", () => {
  it("is symmetric for even and odd lengths", () => {
    expectSymmetric(kaiser(64, 8.6));
    expectSymmetric(kaiser(63, 8.6));
  });

  it("has a unit peak and non-negative samples", () => {
    for (const beta of [0, 8.6, 14]) {
      const values = kaiser(64, beta);
      let peak = Number.NEGATIVE_INFINITY;
      let trough = Number.POSITIVE_INFINITY;
      for (const value of values) {
        peak = Math.max(peak, value);
        trough = Math.min(trough, value);
      }
      expect(peak).toBeLessThanOrEqual(1 + 1e-12);
      expect(trough).toBeGreaterThanOrEqual(0);
    }
  });

  it("is all ones for beta = 0", () => {
    for (const value of kaiser(16, 0)) {
      expect(value).toBe(1);
    }
  });

  it("is even in beta", () => {
    expect(Array.from(kaiser(32, 8.6))).toEqual(Array.from(kaiser(32, -8.6)));
  });

  it("returns a fresh array on every call", () => {
    const first = kaiser(8, 8.6);
    const second = kaiser(8, 8.6);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe("i0 properties", () => {
  it("returns 1 at the origin", () => {
    expect(i0(0)).toBe(1);
  });

  it("is even", () => {
    for (const x of [1, 8.6, 12]) {
      expect(i0(-x)).toBe(i0(x));
    }
  });
});

describe("window edge cases", () => {
  const invalidLengths = [0, 1, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY];

  it.each(invalidLengths)("throws RangeError for window length %s", (length: number) => {
    expect(() => window("hann", length)).toThrow(RangeError);
    expect(() => windowSymmetric("hann", length)).toThrow(RangeError);
    expect(() => kaiser(length, 8.6)).toThrow(RangeError);
  });

  it("accepts length 2", () => {
    expect(window("hann", 2).length).toBe(2);
    expect(windowSymmetric("hann", 2).length).toBe(2);
    expect(kaiser(2, 8.6).length).toBe(2);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws TypeError for kaiser beta %s",
    (beta: number) => {
      expect(() => kaiser(8, beta)).toThrow(TypeError);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws TypeError for i0 argument %s",
    (x: number) => {
      expect(() => i0(x)).toThrow(TypeError);
    },
  );

  it("throws RangeError for an unknown runtime window kind", () => {
    const bogus = "bogus" as unknown as WindowKind;
    expect(() => window(bogus, 8)).toThrow(RangeError);
    expect(() => windowSymmetric(bogus, 8)).toThrow(RangeError);
  });

  it("returns a fresh array on every call", () => {
    for (const make of [() => window("hann", 8), () => windowSymmetric("hann", 8)]) {
      const first = make();
      const second = make();
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    }
  });
});
