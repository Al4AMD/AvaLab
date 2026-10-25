/**
 * url-state tests: stable ordering, locale-free numbers, repeated-key arrays,
 * round-trips, and rejection of unknown value types.
 */
import { describe, expect, it } from "vitest";

import { decodeParams, encodeParams } from "./url-state";

describe("encodeParams", () => {
  it("emits sorted keys and skips nothing", () => {
    expect(encodeParams({ b: "2", a: "1", c: "3" })).toBe("a=1&b=2&c=3");
  });

  it("stringifies numbers via explicit String(), locale-free", () => {
    expect(encodeParams({ w: 1024, n: -7 })).toBe("n=-7&w=1024");
    expect(encodeParams({ x: 1234.5, y: 0.001, z: -0.25 })).toBe("x=1234.5&y=0.001&z=-0.25");
  });

  it("never uses locale-specific separators for large numbers", () => {
    // 1_000_000 would be "1,000,000" or "۱٬۰۰۰٬۰۰۰" via toLocaleString.
    expect(encodeParams({ n: 1000000 })).toBe("n=1000000");
  });

  it("encodes arrays as repeated keys", () => {
    expect(encodeParams({ tags: ["a", "b", "c"] })).toBe("tags=a&tags=b&tags=c");
    expect(encodeParams({ bins: [1, 2] })).toBe("bins=1&bins=2");
  });

  it("URL-encodes reserved characters", () => {
    // URLSearchParams form-encodes: space "+" here, decoded back as " " (see round-trip test).
    expect(encodeParams({ q: "a&b=c d" })).toBe("q=a%26b%3Dc+d");
  });

  it("passes the empty record through as an empty string", () => {
    expect(encodeParams({})).toBe("");
  });

  it("rejects unknown value types", () => {
    expect(() => encodeParams({ ok: true as never })).toThrow(TypeError);
    expect(() => encodeParams({ bad: null as never })).toThrow(TypeError);
    expect(() => encodeParams({ bad: undefined as never })).toThrow(TypeError);
    expect(() => encodeParams({ bad: { nested: 1 } as never })).toThrow(TypeError);
    expect(() => encodeParams({ bad: [["deep"]] as never })).toThrow(TypeError);
  });

  it("rejects non-finite numbers", () => {
    expect(() => encodeParams({ bad: Number.NaN })).toThrow(TypeError);
    expect(() => encodeParams({ bad: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => encodeParams({ bad: [1, Number.NEGATIVE_INFINITY] })).toThrow(TypeError);
  });
});

describe("decodeParams", () => {
  it("decodes single occurrences as strings", () => {
    expect(decodeParams("a=1&b=x")).toEqual({ a: "1", b: "x" });
  });

  it("decodes repeated keys as string arrays", () => {
    expect(decodeParams("tags=a&tags=b")).toEqual({ tags: ["a", "b"] });
  });

  it("accepts a leading ? and returns the empty record for empty input", () => {
    expect(decodeParams("?a=1")).toEqual({ a: "1" });
    expect(decodeParams("")).toEqual({});
    expect(decodeParams("?")).toEqual({});
  });

  it("decodes URL-encoded characters back", () => {
    expect(decodeParams("q=a%26b%3Dc+d")).toEqual({ q: "a&b=c d" });
  });

  it("outputs sorted keys", () => {
    const decoded = decodeParams("c=3&a=1");
    expect(Object.keys(decoded)).toEqual(["a", "c"]);
  });
});

describe("round-trip", () => {
  it("strings round-trip exactly", () => {
    const record = { name: "hann", note: "a&b=c d/e", unicode: "فاen" };
    const query = encodeParams(record);
    expect(decodeParams(query)).toEqual(record);
  });

  it("numbers round-trip through their textual form (locale-free)", () => {
    const query = encodeParams({ window: 1024, gain: -12.5, tiny: 1e-7 });
    expect(query).toBe("gain=-12.5&tiny=1e-7&window=1024");
    // The generic codec is textual by design (see module docstring): decoders
    // get the exact string a number produced, never a locale-mangled one.
    expect(decodeParams(query)).toEqual({
      gain: "-12.5",
      tiny: "1e-7",
      window: "1024",
    });
  });

  it("repeated-key arrays round-trip value-for-value", () => {
    const record = { bins: ["1", "2", "3"], imu: ["x", "y"] };
    expect(decodeParams(encodeParams(record))).toEqual(record);
    // Numeric arrays arrive back in their textual form (see module docstring):
    expect(decodeParams(encodeParams({ bins: [1, 2, 3] }))).toEqual({
      bins: ["1", "2", "3"],
    });
  });

  it("is stable: the same record always encodes to the same string", () => {
    const first = encodeParams({ z: 2, a: [1, 2], m: "s" });
    const second = encodeParams({ m: "s", z: 2, a: [1, 2] });
    expect(first).toBe("a=1&a=2&m=s&z=2");
    expect(first).toBe(second);
  });
});
