import { describe, expect, it } from "vitest";

import {
  type LaneParams,
  laneParamsLinked,
  relinkLaneParams,
  resolveLaneParams,
  setPrimaryLane,
  setRightLane,
  unlinkLaneParams,
} from "./laneParams";

describe("resolveLaneParams", () => {
  it("mirrors the primary object for both lanes when linked", () => {
    const primary = { cutoffHz: 440 };

    const resolved = resolveLaneParams({ primary });

    expect(resolved.left).toBe(primary);
    expect(resolved.right).toBe(primary);
  });

  it("keeps distinct lane objects when the right override exists", () => {
    const primary = { cutoffHz: 440 };
    const right = { cutoffHz: 880 };

    const resolved = resolveLaneParams({ primary, right });

    expect(resolved.left).toBe(primary);
    expect(resolved.right).toBe(right);
  });
});

describe("laneParamsLinked", () => {
  it("is true only when the right override is absent", () => {
    expect(laneParamsLinked({ primary: 1 })).toBe(true);
    expect(laneParamsLinked({ primary: 1, right: 2 })).toBe(false);
  });
});

describe("unlinkLaneParams", () => {
  it("copies primary into right without mutating the input", () => {
    const primary = { cutoffHz: 440 };
    const params: LaneParams<{ cutoffHz: number }> = { primary };

    const unlinked = unlinkLaneParams(params);

    expect(unlinked).not.toBe(params);
    expect(unlinked.primary).toBe(primary);
    expect(unlinked.right).toBe(primary);
    expect(params.right).toBeUndefined();
  });

  it("preserves an existing right override", () => {
    const primary = { cutoffHz: 440 };
    const right = { cutoffHz: 880 };
    const params = { primary, right };

    expect(unlinkLaneParams(params)).toBe(params);
  });
});

describe("relinkLaneParams", () => {
  it("drops right and keeps primary", () => {
    const primary = { cutoffHz: 440 };
    const params = { primary, right: { cutoffHz: 880 } };

    const relinked = relinkLaneParams(params);

    expect(relinked.primary).toBe(primary);
    expect(relinked.right).toBeUndefined();
    expect(params.right).toBeDefined();
  });
});

describe("setPrimaryLane", () => {
  it("preserves an existing right override", () => {
    const right = { cutoffHz: 880 };

    const updated = setPrimaryLane({ primary: { cutoffHz: 440 }, right }, { cutoffHz: 220 });

    expect(updated.primary).toEqual({ cutoffHz: 220 });
    expect(updated.right).toBe(right);
  });
});

describe("setRightLane", () => {
  it("adds a right override without touching primary", () => {
    const primary = { cutoffHz: 440 };

    const updated = setRightLane({ primary }, { cutoffHz: 880 });

    expect(updated.primary).toBe(primary);
    expect(updated.right).toEqual({ cutoffHz: 880 });
  });
});
