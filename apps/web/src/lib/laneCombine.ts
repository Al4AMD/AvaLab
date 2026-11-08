import type { AudioChannels } from "@avalab/dsp";

import type { ChannelMode } from "./channel";

export type LaneResults = {
  readonly mono?: Float32Array;
  readonly left?: Float32Array;
  readonly right?: Float32Array;
};

function hasResultLength(result: Float32Array | undefined, length: number): result is Float32Array {
  return result !== undefined && result.length === length;
}

function hasSourceRange(
  source: AudioChannels,
  startSample: number,
  resultLengthSamples: number,
): boolean {
  const endSample = startSample + resultLengthSamples;
  return source.every((lane) => endSample <= lane.length);
}

export function combineLaneOutputs(mode: ChannelMode, results: LaneResults): AudioChannels | null {
  switch (mode) {
    case "mono":
      return results.mono === undefined || results.mono.length === 0 ? null : [results.mono];
    case "left":
      return results.left === undefined || results.left.length === 0 ? null : [results.left];
    case "right":
      return results.right === undefined || results.right.length === 0 ? null : [results.right];
    case "both": {
      const left = results.left;
      const right = results.right;
      if (left === undefined || right === undefined || left.length === 0) {
        return null;
      }
      return left.length === right.length ? [left, right] : null;
    }
  }
}

export function combineLaneResults(
  mode: ChannelMode,
  source: AudioChannels,
  startSample: number,
  resultLengthSamples: number,
  results: LaneResults,
): AudioChannels | null {
  if (
    !Number.isInteger(startSample) ||
    !Number.isInteger(resultLengthSamples) ||
    startSample < 0 ||
    resultLengthSamples <= 0 ||
    source.length === 0
  ) {
    return null;
  }

  const endSample = startSample + resultLengthSamples;

  switch (mode) {
    case "mono": {
      if (!hasSourceRange(source.slice(0, 1), startSample, resultLengthSamples)) {
        return null;
      }
      return hasResultLength(results.mono, resultLengthSamples) ? [results.mono] : null;
    }
    case "left": {
      if (!hasSourceRange(source, startSample, resultLengthSamples)) {
        return null;
      }
      if (!hasResultLength(results.left, resultLengthSamples)) {
        return null;
      }
      if (source.length < 2) {
        return [results.left];
      }
      return [results.left, source[1]?.slice(startSample, endSample) ?? new Float32Array()];
    }
    case "right": {
      if (!hasSourceRange(source, startSample, resultLengthSamples)) {
        return null;
      }
      if (!hasResultLength(results.right, resultLengthSamples)) {
        return null;
      }
      if (source.length < 2) {
        return [results.right];
      }
      return [source[0]?.slice(startSample, endSample) ?? new Float32Array(), results.right];
    }
    case "both": {
      if (!hasSourceRange(source, startSample, resultLengthSamples) || source.length < 2) {
        return null;
      }
      if (
        !hasResultLength(results.left, resultLengthSamples) ||
        !hasResultLength(results.right, resultLengthSamples)
      ) {
        return null;
      }
      return [results.left, results.right];
    }
  }
}
