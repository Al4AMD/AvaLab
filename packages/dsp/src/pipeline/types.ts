/**
 * Purpose: versioned DAG DSL for the F15 pipeline builder.
 *
 * Shape: exactly one source feeds a directed acyclic graph of processing
 * nodes. Every non-source node has exactly one incoming edge; fan-out to
 * independent branches is allowed, merging is not. At most two output nodes
 * carry audio to the result. Positions are UI metadata and never affect
 * execution or validation except for being finite.
 *
 * Edge cases: IDs are opaque non-empty strings; the validator owns the
 * structural rules and returns typed errors instead of throwing.
 */

import type { CodecLabCodec } from "../codecs/codecLabTypes.js";
import type { SyntheticIrKind } from "../systems/impulseResponse.js";

export type XY = { readonly x: number; readonly y: number };

/** Shared with the F11 filter op; `sampleRateHz` is replaced by the upstream
 * rate during pipeline execution. */
export type FilterApplyParams = {
  b: number[];
  a: number[];
  fir: boolean;
  sampleRateHz: number;
  compensateDelay: boolean;
};

/** Shared with the F10 reverb op; `sampleRateHz`, `startSample` and
 * `endSample` are replaced by the pipeline's upstream context. */
export type ReverbIrParams = {
  kind: SyntheticIrKind;
  durationSeconds: number;
  rt60Seconds: number;
  seed: number;
};

export type ReverbProcessParams = {
  sampleRateHz: number;
  startSample: number;
  endSample: number;
  ir: ReverbIrParams;
  uploadedIrSampleCount: number;
  uploadedIrSampleRateHz?: number;
  preDelayMs: number;
  wetMix: number;
  method: "fft" | "direct";
};

export type PipelineNode =
  | { id: string; kind: "source"; params: Record<string, never>; position: XY }
  | {
      id: string;
      kind: "resample";
      params: { targetRateHz: number; antiAlias: boolean };
      position: XY;
    }
  | { id: string; kind: "filter"; params: FilterApplyParams; position: XY }
  | {
      id: string;
      kind: "quantize";
      params: { bits: number; dither: boolean; seed: number };
      position: XY;
    }
  | {
      id: string;
      kind: "codec";
      params: {
        codec: CodecLabCodec;
        mdctBitsPerSecond: number;
        psychoacoustic: boolean;
        referenceSplDb: number;
      };
      position: XY;
    }
  | { id: string; kind: "reverb"; params: ReverbProcessParams; position: XY }
  | { id: string; kind: "reverse"; params: Record<string, never>; position: XY }
  | {
      id: string;
      kind: "timeStretch";
      params: { speedFactor: number; pitchSemitones: number };
      position: XY;
    }
  | { id: string; kind: "output"; params: { label: string }; position: XY };

export type PipelineEdge = { readonly id: string; readonly from: string; readonly to: string };

export type PipelineGraph = {
  readonly version: 1;
  readonly nodes: readonly PipelineNode[];
  readonly edges: readonly PipelineEdge[];
};

export const PIPELINE_MAX_NODES = 24;
export const PIPELINE_MAX_OUTPUTS = 2;
