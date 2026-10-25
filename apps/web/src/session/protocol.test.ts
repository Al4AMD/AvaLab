/**
 * protocol tests: canonical params codec (stable keys, locale-free numbers,
 * strict type rejection) and the boundary record check.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { canonicalJson, isRecordLike, type TransferablePayload } from "./protocol";

describe("canonicalJson", () => {
  it("encodes scalars stably", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson("")).toBe('""');
    expect(canonicalJson("a&b/c")).toBe('"a&b/c"');
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
    expect(canonicalJson(0)).toBe("0");
    expect(canonicalJson(1234.5)).toBe("1234.5");
    expect(canonicalJson(1e-7)).toBe("1e-7");
    expect(canonicalJson(-0)).toBe("0"); // -0 and 0 are the same sound value
  });

  it("sorts object keys lexicographically at every level", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { b: 1, a: 2 }, a: [{ y: 2, x: 1 }] })).toBe(
      '{"a":[{"x":1,"y":2}],"z":{"a":2,"b":1}}',
    );
  });

  it("is order-insensitive: reordered keys encode identically", () => {
    const forward = canonicalJson({ a: 1, b: 2, c: [3, 4] });
    const reordered = canonicalJson({ c: [3, 4], b: 2, a: 1 });
    expect(forward).toBe(reordered);
  });

  it("uses locale-independent number formatting", () => {
    // String(), never toLocaleString: "1,234.5" or "۱٬۲۳۴٫۵" must not appear.
    expect(canonicalJson({ n: 1000000, f: 0.5 })).toBe('{"f":0.5,"n":1000000}');
  });

  it("encodes arrays positionally (order matters inside arrays)", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
    expect(canonicalJson([1, 2])).toBe("[1,2]");
  });

  it("rejects non-finite numbers and undefined", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalJson(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson({ ok: 1, bad: undefined })).toThrow(TypeError);
  });

  it("rejects non-JSON value types", () => {
    const noop = () => {};
    expect(() => canonicalJson(noop)).toThrow(TypeError);
    expect(() => canonicalJson(Symbol("s"))).toThrow(TypeError);
    expect(() => canonicalJson(10n)).toThrow(TypeError);
    expect(() => canonicalJson(new Map())).toThrow(TypeError);
    expect(() => canonicalJson(new Date(0))).toThrow(TypeError);
  });
});

describe("isRecordLike", () => {
  it("accepts plain records and arrays (callers narrow fields further)", () => {
    expect(isRecordLike({})).toBe(true);
    expect(isRecordLike([])).toBe(true);
    expect(isRecordLike([1, 2])).toBe(true);
  });

  it("rejects primitives and null", () => {
    expect(isRecordLike(null)).toBe(false);
    expect(isRecordLike(undefined)).toBe(false);
    expect(isRecordLike(1)).toBe(false);
    expect(isRecordLike("x")).toBe(false);
    expect(isRecordLike(true)).toBe(false);
  });
});

describe("type-level: TransferablePayload descriptor", () => {
  it("is a byte-range view over a buffer", () => {
    expectTypeOf<TransferablePayload>().toEqualTypeOf<{
      buffer: ArrayBuffer;
      byteOffset: number;
      byteLength: number;
    }>();
  });
});
