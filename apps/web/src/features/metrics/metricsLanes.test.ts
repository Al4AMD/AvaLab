import { describe, expect, it } from "vitest";

import type { ChannelMode } from "../../lib/channel";
import { type MetricsSource, selectMetricsLanes } from "./metricsLanes";

function source(lanes: readonly Float32Array[], sampleRateHz = 48_000): MetricsSource {
  return {
    samples:
      lanes.length > 1 ? new Float32Array(lanes[0]?.length ?? 0) : (lanes[0] ?? new Float32Array()),
    channels: lanes,
    sampleRateHz,
  };
}

function mode(mode: ChannelMode): ChannelMode {
  return mode;
}

describe("selectMetricsLanes", () => {
  it("reports a missing processed source", () => {
    const result = selectMetricsLanes(source([new Float32Array(2)]), null, mode("mono"));
    expect(result).toEqual({ ok: false, problem: "missing" });
  });

  it("reports a rate mismatch", () => {
    const result = selectMetricsLanes(
      source([new Float32Array(2)], 48_000),
      source([new Float32Array(2)], 44_100),
      mode("mono"),
    );
    expect(result).toEqual({ ok: false, problem: "rateMismatch" });
  });

  it("reports a mono length mismatch", () => {
    const result = selectMetricsLanes(
      source([new Float32Array(2)]),
      source([new Float32Array(3)]),
      mode("mono"),
    );
    expect(result).toEqual({ ok: false, problem: "lengthMismatch" });
  });

  it("reports missing processed lanes instead of falling back", () => {
    const result = selectMetricsLanes(
      source([new Float32Array(2), new Float32Array(2)]),
      source([new Float32Array(2)]),
      mode("right"),
    );
    expect(result).toEqual({ ok: false, problem: "channelsMismatch" });
  });

  it("selects mono samples without copying", () => {
    const original = source([new Float32Array([1, 2]), new Float32Array([3, 4])]);
    const processed = source([new Float32Array([5, 6])]);
    const result = selectMetricsLanes(original, processed, mode("mono"));
    if (!result.ok) {
      throw new Error("expected selection");
    }
    expect(result.lanes).toHaveLength(1);
    expect(result.lanes[0]?.id).toBe("mono");
    expect(result.lanes[0]?.reference).toBe(original.samples);
    expect(result.lanes[0]?.test).toBe(processed.samples);
  });

  it("selects the requested lane without copying", () => {
    const original = source([new Float32Array([1, 2]), new Float32Array([3, 4])]);
    const processed = source([new Float32Array([5, 6]), new Float32Array([7, 8])]);
    const result = selectMetricsLanes(original, processed, mode("right"));
    if (!result.ok) {
      throw new Error("expected selection");
    }
    expect(result.lanes).toHaveLength(1);
    expect(result.lanes[0]?.id).toBe("right");
    expect(result.lanes[0]?.reference).toBe(original.channels[1]);
    expect(result.lanes[0]?.test).toBe(processed.channels[1]);
  });

  it("returns left then right for both", () => {
    const original = source([new Float32Array(2), new Float32Array(2)]);
    const processed = source([new Float32Array(2), new Float32Array(2)]);
    const result = selectMetricsLanes(original, processed, mode("both"));
    if (!result.ok) {
      throw new Error("expected selection");
    }
    expect(result.lanes.map((lane) => lane.id)).toEqual(["left", "right"]);
  });
});
