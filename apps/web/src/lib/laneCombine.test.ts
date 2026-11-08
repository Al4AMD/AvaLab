import { describe, expect, it } from "vitest";

import { combineLaneOutputs, combineLaneResults } from "./laneCombine";

function lanes(left: number[], right?: number[]): readonly Float32Array[] {
  const leftLane = new Float32Array(left);
  return right === undefined ? [leftLane] : [leftLane, new Float32Array(right)];
}

describe("combineLaneResults", () => {
  it("returns the mono result as one channel", () => {
    const source = lanes([10, 11, 12], [20, 21, 22]);
    const mono = new Float32Array([5, 6]);

    const combined = combineLaneResults("mono", source, 1, 2, { mono });

    expect(combined).toHaveLength(1);
    expect(combined?.[0]).toBe(mono);
  });

  it("pairs a processed left lane with a copied right passthrough", () => {
    const source = lanes([10, 11, 12], [20, 21, 22]);
    const left = new Float32Array([7, 8]);

    const combined = combineLaneResults("left", source, 1, 2, { left });

    expect(combined?.[0]).toBe(left);
    expect(combined?.[1]).toEqual(new Float32Array([21, 22]));
    expect(combined?.[1]).not.toBe(source[1]);
  });

  it("pairs a copied left passthrough with a processed right lane", () => {
    const source = lanes([10, 11, 12], [20, 21, 22]);
    const right = new Float32Array([7, 8]);

    const combined = combineLaneResults("right", source, 1, 2, { right });

    expect(combined?.[0]).toEqual(new Float32Array([11, 12]));
    expect(combined?.[0]).not.toBe(source[0]);
    expect(combined?.[1]).toBe(right);
  });

  it("returns both processed lanes in left/right order", () => {
    const source = lanes([10, 11, 12], [20, 21, 22]);
    const left = new Float32Array([7, 8]);
    const right = new Float32Array([9, 10]);

    expect(combineLaneResults("both", source, 1, 2, { left, right })).toEqual([left, right]);
  });

  it("returns one processed channel for a mono source in a single-lane mode", () => {
    const source = lanes([10, 11, 12]);
    const left = new Float32Array([7, 8]);
    const right = new Float32Array([9, 10]);

    expect(combineLaneResults("left", source, 1, 2, { left })).toEqual([left]);
    expect(combineLaneResults("right", source, 1, 2, { right })).toEqual([right]);
  });

  it("rejects a missing result lane", () => {
    const source = lanes([10, 11, 12], [20, 21, 22]);

    expect(combineLaneResults("left", source, 0, 2, {})).toBeNull();
    expect(combineLaneResults("both", source, 0, 2, { left: new Float32Array(2) })).toBeNull();
  });

  it("rejects a result whose length differs from the requested length", () => {
    const source = lanes([10, 11, 12], [20, 21, 22]);

    expect(combineLaneResults("left", source, 0, 2, { left: new Float32Array(1) })).toBeNull();
    expect(
      combineLaneResults("both", source, 0, 2, {
        left: new Float32Array(2),
        right: new Float32Array(3),
      }),
    ).toBeNull();
  });

  it("rejects an out-of-range start or zero length", () => {
    const source = lanes([10, 11, 12], [20, 21, 22]);
    const result = new Float32Array(2);

    expect(combineLaneResults("left", source, 2, 2, { left: result })).toBeNull();
    expect(combineLaneResults("left", source, -1, 2, { left: result })).toBeNull();
    expect(combineLaneResults("left", source, 0, 0, { left: result })).toBeNull();
    expect(combineLaneResults("left", source, 0.5, 2, { left: result })).toBeNull();
  });

  it("does not mutate source lanes", () => {
    const source = lanes([10, 11, 12], [20, 21, 22]);
    const before = source.map((lane) => Array.from(lane));

    combineLaneResults("both", source, 1, 2, {
      left: new Float32Array([7, 8]),
      right: new Float32Array([9, 10]),
    });

    expect(source.map((lane) => Array.from(lane))).toEqual(before);
  });
});

describe("combineLaneOutputs", () => {
  it("returns the processed output for single-lane modes", () => {
    const mono = new Float32Array([1, 2]);
    const left = new Float32Array([3, 4]);
    const right = new Float32Array([5, 6]);

    expect(combineLaneOutputs("mono", { mono })).toEqual([mono]);
    expect(combineLaneOutputs("left", { left })).toEqual([left]);
    expect(combineLaneOutputs("right", { right })).toEqual([right]);
  });

  it("returns both outputs when the lengths match", () => {
    const left = new Float32Array([1, 2]);
    const right = new Float32Array([3, 4]);

    expect(combineLaneOutputs("both", { left, right })).toEqual([left, right]);
  });

  it("rejects missing, empty, or mismatched outputs", () => {
    expect(combineLaneOutputs("mono", {})).toBeNull();
    expect(combineLaneOutputs("left", { left: new Float32Array(0) })).toBeNull();
    expect(combineLaneOutputs("right", {})).toBeNull();
    expect(combineLaneOutputs("both", { left: new Float32Array([1]) })).toBeNull();
    expect(
      combineLaneOutputs("both", {
        left: new Float32Array([1, 2]),
        right: new Float32Array([3]),
      }),
    ).toBeNull();
    expect(
      combineLaneOutputs("both", { left: new Float32Array(0), right: new Float32Array(0) }),
    ).toBeNull();
  });
});
