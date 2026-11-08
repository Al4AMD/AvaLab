import { describe, expect, it } from "vitest";

import {
  availableChannelModes,
  type ChannelSource,
  channelModeFromSearch,
  channelModeToSearch,
  channelSignals,
  displayedLanes,
  laneIndexForSingleMode,
  singleAnalysisLane,
} from "./channel";

function source(left: Float32Array, right?: Float32Array): ChannelSource {
  const channels = right === undefined ? [left] : [left, right];
  const samples = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    samples[index] =
      right === undefined ? (left[index] ?? 0) : ((left[index] ?? 0) + (right[index] ?? 0)) / 2;
  }
  return { samples, channels };
}

describe("availableChannelModes", () => {
  it("offers only mono for a mono source", () => {
    expect(availableChannelModes(source(new Float32Array(4)), "both")).toEqual(["mono"]);
  });

  it("offers mono, left and right for single-panel stereo tools", () => {
    expect(
      availableChannelModes(source(new Float32Array(4), new Float32Array(4)), "single"),
    ).toEqual(["mono", "left", "right"]);
  });

  it("offers both channels for stacked stereo tools", () => {
    expect(availableChannelModes(source(new Float32Array(4), new Float32Array(4)), "both")).toEqual(
      ["mono", "left", "right", "both"],
    );
  });
});

describe("channelSignals", () => {
  const left = new Float32Array([1, 2]);
  const right = new Float32Array([3, 4]);
  const stereo = source(left, right);

  it("returns the mono downmix", () => {
    expect(channelSignals(stereo, "mono")).toEqual([stereo.samples]);
  });

  it("returns the stored left and right lanes without copying", () => {
    expect(channelSignals(stereo, "left")).toEqual([left]);
    expect(channelSignals(stereo, "right")).toEqual([right]);
    expect(channelSignals(stereo, "both")).toEqual([left, right]);
  });

  it("falls back to the only lane for a mono source", () => {
    const mono = source(left);
    expect(channelSignals(mono, "right")).toEqual([left]);
  });
});

describe("displayedLanes", () => {
  it("labels the stacked lanes left then right", () => {
    expect(displayedLanes("both")).toEqual([
      { id: "left", lane: 0 },
      { id: "right", lane: 1 },
    ]);
  });

  it("maps single-panel modes to one lane", () => {
    expect(displayedLanes("mono")).toEqual([{ id: "mono", lane: 0 }]);
    expect(displayedLanes("left")).toEqual([{ id: "left", lane: 0 }]);
    expect(displayedLanes("right")).toEqual([{ id: "right", lane: 1 }]);
  });
});

describe("laneIndexForSingleMode", () => {
  it("maps left to lane 0 and right to lane 1", () => {
    expect(laneIndexForSingleMode("mono")).toBe(0);
    expect(laneIndexForSingleMode("left")).toBe(0);
    expect(laneIndexForSingleMode("right")).toBe(1);
    expect(laneIndexForSingleMode("both")).toBeNull();
  });
});

describe("singleAnalysisLane", () => {
  it("uses the downmix for mono and a playback lane otherwise", () => {
    expect(singleAnalysisLane("mono")).toBe("mono");
    expect(singleAnalysisLane("left")).toBe(0);
    expect(singleAnalysisLane("right")).toBe(1);
  });
});

describe("channel URL codec", () => {
  it("parses known values and defaults unknown values to mono", () => {
    expect(channelModeFromSearch(new URLSearchParams("ch=right"))).toBe("right");
    expect(channelModeFromSearch(new URLSearchParams("ch=both"))).toBe("both");
    expect(channelModeFromSearch(new URLSearchParams("ch=sideways"))).toBe("mono");
    expect(channelModeFromSearch(new URLSearchParams())).toBe("mono");
  });

  it("omits mono from the URL", () => {
    expect(channelModeToSearch("mono")).toBeNull();
    expect(channelModeToSearch("left")).toBe("left");
  });
});
