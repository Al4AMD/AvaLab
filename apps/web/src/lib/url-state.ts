/**
 * Stable, locale-free URL↔parameter codec for tool state (spec §2.5, F16 groundwork).
 *
 * Keys are always emitted sorted (lexicographic, locale-independent) so identical
 * parameter sets produce identical query strings (stable share URLs / cache keys).
 * Everything rides `URLSearchParams` only: repeated keys carry arrays, numbers are
 * stringified through explicit `String()` — never `toLocaleString` — so the output
 * is locale-independent ("1234.5", never "1,234.5" or "۱٫۲۳۴٫۵").
 *
 * Decoding is textual on purpose: the generic codec cannot know whether "?w=1024"
 * was the number 1024 or the string "1024", so it always returns strings (arrays
 * when a key repeats). Type restoration belongs to each tool's own
 * `searchToParams` pair (spec §2.5). No React/DOM coupling: pure functions only.
 *
 * Unknown value types (boolean, null, objects, nested structures, non-finite
 * numbers) are rejected with TypeError — never silently stringified.
 */

export type UrlParamValue = string | number;
export type UrlParamInput = UrlParamValue | readonly UrlParamValue[];
export type UrlParamsInput = Record<string, UrlParamInput>;
export type UrlParamsDecoded = Record<string, string | readonly string[]>;

/** Record → query string. Stable order: keys sorted lexicographically, per-key value order preserved. */
export function encodeParams(record: UrlParamsInput): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    // noUncheckedIndexedAccess makes a plain Record lookup possibly
    // undefined; a present-but-undefined value is still an unknown type
    // here and must be rejected, not skipped.
    if (value === undefined) {
      throw new TypeError(
        "url-state: URL parameter value must be string or finite number, got undefined",
      );
    }
    for (const item of flatValue(value)) {
      params.append(key, String(item));
    }
  }
  return params.toString();
}

/** Query string (leading "?" allowed, per URLSearchParams) → Record of scalar-string entries. */
export function decodeParams(search: string): UrlParamsDecoded {
  const params = new URLSearchParams(search);
  const buckets = new Map<string, string[]>();
  for (const [key, value] of params) {
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [value]);
    } else {
      bucket.push(value);
    }
  }
  const decoded: UrlParamsDecoded = {};
  for (const key of [...buckets.keys()].sort()) {
    const values = buckets.get(key);
    if (values !== undefined) {
      decoded[key] = values.length === 1 ? (values[0] ?? "") : values;
    }
  }
  return decoded;
}

/** Exactly one scalar per array element; anything else is a TypeError. */
function flatValue(value: UrlParamInput): readonly UrlParamValue[] {
  if (Array.isArray(value)) {
    return value.map(assertScalar);
  }
  return [assertScalar(value)];
}

function assertScalar(value: unknown): UrlParamValue {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new TypeError(
    `url-state: URL parameter value must be string or finite number, got ${String(value)}`,
  );
}
