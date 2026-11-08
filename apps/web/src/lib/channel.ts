import type { AudioChannels } from "@avalab/dsp";

export const CHANNEL_QUERY_KEY = "ch";
export const CHANNEL_MODES = ["mono", "left", "right", "both"] as const;
export type ChannelMode = (typeof CHANNEL_MODES)[number];
export type LaneIndex = 0 | 1;
export type ChannelLaneId = "mono" | "left" | "right";
export type ChannelToolSupport = "single" | "both";
/** A playback lane, or the mono analysis downmix (`SessionSource.samples`). */
export type AnalysisLane = LaneIndex | "mono";

export type ChannelSource = {
  readonly samples: Float32Array;
  readonly channels: AudioChannels;
};

export type DisplayedLane = {
  readonly id: ChannelLaneId;
  readonly lane: LaneIndex;
};

const SINGLE_PANEL_MODES = ["mono", "left", "right"] as const;

function isChannelMode(value: string | null): value is ChannelMode {
  return value !== null && (CHANNEL_MODES as readonly string[]).includes(value);
}

export function availableChannelModes(
  source: ChannelSource | null,
  support: ChannelToolSupport,
): readonly ChannelMode[] {
  if (source === null || source.channels.length < 2) {
    return ["mono"];
  }
  return support === "both" ? ["mono", "left", "right", "both"] : SINGLE_PANEL_MODES;
}

export function channelSignals(source: ChannelSource, mode: ChannelMode): readonly Float32Array[] {
  const left = source.channels[0] ?? source.samples;
  const right = source.channels[1] ?? left;
  switch (mode) {
    case "mono":
      return [source.samples];
    case "left":
      return [left];
    case "right":
      return [right];
    case "both":
      return source.channels.length > 1 ? [left, right] : [left];
  }
}

export function displayedLanes(mode: ChannelMode): readonly DisplayedLane[] {
  switch (mode) {
    case "mono":
      return [{ id: "mono", lane: 0 }];
    case "left":
      return [{ id: "left", lane: 0 }];
    case "right":
      return [{ id: "right", lane: 1 }];
    case "both":
      return [
        { id: "left", lane: 0 },
        { id: "right", lane: 1 },
      ];
  }
}

export function laneIndexForSingleMode(mode: ChannelMode): LaneIndex | null {
  return mode === "both" ? null : mode === "right" ? 1 : 0;
}

/** The single-panel analysis source: mono uses the downmix, not channel 0. */
export function singleAnalysisLane(mode: ChannelMode): AnalysisLane {
  switch (mode) {
    case "mono":
      return "mono";
    case "right":
      return 1;
    case "left":
    case "both":
      return 0;
  }
}

export function channelModeFromSearch(params: URLSearchParams): ChannelMode {
  const value = params.get(CHANNEL_QUERY_KEY);
  return isChannelMode(value) ? value : "mono";
}

export function channelModeToSearch(mode: ChannelMode): string | null {
  return mode === "mono" ? null : mode;
}
