import type { AudioChannels } from "@avalab/dsp";

import {
  type ChannelLaneId,
  type ChannelMode,
  channelSignals,
  displayedLanes,
  laneIndexForSingleMode,
} from "../../lib/channel";

export type MetricsLaneProblem = "missing" | "rateMismatch" | "lengthMismatch" | "channelsMismatch";

export type MetricsSource = {
  readonly samples: Float32Array;
  readonly channels: AudioChannels;
  readonly sampleRateHz: number;
};

export type MetricsLanePair = {
  readonly id: ChannelLaneId;
  readonly reference: Float32Array;
  readonly test: Float32Array;
};

export type MetricsLaneSelection =
  | { readonly ok: true; readonly lanes: readonly MetricsLanePair[] }
  | { readonly ok: false; readonly problem: MetricsLaneProblem };

function hasLane(source: MetricsSource, id: ChannelLaneId): boolean {
  const lane = laneIndexForSingleMode(id);
  return lane === null || source.channels[lane] !== undefined;
}

export function selectMetricsLanes(
  original: MetricsSource,
  processed: MetricsSource | null,
  mode: ChannelMode,
): MetricsLaneSelection {
  if (processed === null) {
    return { ok: false, problem: "missing" };
  }
  if (processed.sampleRateHz !== original.sampleRateHz) {
    return { ok: false, problem: "rateMismatch" };
  }
  const ids = displayedLanes(mode).map((lane) => lane.id);
  for (const id of ids) {
    if (!hasLane(original, id) || !hasLane(processed, id)) {
      return { ok: false, problem: "channelsMismatch" };
    }
  }
  for (const id of ids) {
    const reference = channelSignals(original, id)[0];
    const test = channelSignals(processed, id)[0];
    if (reference === undefined || test === undefined || reference.length !== test.length) {
      return { ok: false, problem: "lengthMismatch" };
    }
  }
  return {
    ok: true,
    lanes: ids.map((id) => ({
      id,
      reference: channelSignals(original, id)[0] as Float32Array,
      test: channelSignals(processed, id)[0] as Float32Array,
    })),
  };
}
