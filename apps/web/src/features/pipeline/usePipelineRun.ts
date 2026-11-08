/**
 * F15 worker runner. The view never touches PCM: this hook asks the session
 * store for the selected excerpt, lets the worker execute the graph, and
 * exposes only stage summaries and the concatenated output buffer. Installing
 * an output copies that output's slice into the processed-playback lane.
 *
 * D-056 Phase 5 runs the same validated graph on every selected lane. Outputs
 * are combined only when their rate and length match; the graph, URL schema
 * and mono path are unchanged.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { ChannelMode, LaneIndex } from "../../lib/channel";
import type { PipelineOutput, PipelineStageSummary } from "../../session/ops";
import { DspRpcError } from "../../session/rpc";
import { useSessionStore } from "../../session/store";
import { type PipelineRange, type PipelineState, pipelineParamsError } from "./pipelineState";

export type PipelineRunStatus = "idle" | "running" | "ready" | "error";

export type PipelineRunResult = {
  /** First-lane payload; existing plots read this field. */
  readonly samples: Float32Array;
  readonly laneSamples: readonly Float32Array[];
  readonly stages: readonly PipelineStageSummary[];
  readonly laneStages: readonly (readonly PipelineStageSummary[])[];
  readonly outputs: readonly PipelineOutput[];
  readonly laneOutputs: readonly (readonly PipelineOutput[])[];
  readonly totalElapsedMs: number;
  readonly startSample: number;
  readonly endSample: number;
};

export type PipelineRunViewState = {
  readonly status: PipelineRunStatus;
  readonly result: PipelineRunResult | null;
  readonly errorCode: string | null;
};

export type PipelineInstallResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "noResult" | "missingOutput" | "install" };

export type PipelineRunController = PipelineRunViewState & {
  readonly run: () => void;
  readonly cancel: () => void;
  readonly installOutput: (outputId: string) => PipelineInstallResult;
};

function laneSelection(mode: ChannelMode): readonly LaneIndex[] {
  switch (mode) {
    case "both":
      return [0, 1];
    case "right":
      return [1];
    default:
      return [0];
  }
}

function gridsMatch(left: readonly PipelineOutput[], right: readonly PipelineOutput[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((output, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      other.nodeId === output.nodeId &&
      other.sampleRateHz === output.sampleRateHz &&
      other.sampleCount === output.sampleCount
    );
  });
}

export function usePipelineRun(
  state: PipelineState,
  range: PipelineRange,
  channelMode: ChannelMode,
): PipelineRunController {
  const graph = state.graph;
  const original = useSessionStore((session) => session.original);
  const [view, setView] = useState<PipelineRunViewState>({
    status: "idle",
    result: null,
    errorCode: null,
  });
  const runIdRef = useRef(0);
  const ticketKeysRef = useRef<string[]>([]);
  const previousGraphRef = useRef(graph);
  const previousSourceRef = useRef(original);
  const previousModeRef = useRef(channelMode);

  const cancelTickets = useCallback(() => {
    for (const key of ticketKeysRef.current) {
      useSessionStore.getState().cancel(key);
    }
    ticketKeysRef.current = [];
  }, []);

  useEffect(() => {
    const graphChanged = previousGraphRef.current !== graph;
    const sourceChanged = previousSourceRef.current !== original;
    const modeChanged = previousModeRef.current !== channelMode;
    previousGraphRef.current = graph;
    previousSourceRef.current = original;
    previousModeRef.current = channelMode;
    if (!graphChanged && !sourceChanged && !modeChanged) {
      return;
    }
    runIdRef.current += 1;
    cancelTickets();
    setView({ status: "idle", result: null, errorCode: null });
  }, [cancelTickets, channelMode, graph, original]);

  useEffect(() => cancelTickets, [cancelTickets]);

  const run = useCallback(() => {
    if (original === null || !state.validation.ok || pipelineParamsError(graph) !== null) {
      return;
    }
    if (range.endSample <= range.startSample) {
      return;
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const lanes = laneSelection(channelMode);
    const tickets = lanes.map((lane) => {
      const params = {
        graph,
        sampleRateHz: original.sampleRateHz,
        startSample: range.startSample,
        endSample: range.endSample,
      };
      return channelMode === "mono"
        ? useSessionStore
            .getState()
            .deriveWithSourceSlice("pipelineRun", params, range.startSample, range.endSample)
        : useSessionStore
            .getState()
            .deriveWithSourceSliceLane(
              "pipelineRun",
              params,
              range.startSample,
              range.endSample,
              lane,
            );
    });
    ticketKeysRef.current = tickets.map((ticket) => ticket.key);
    setView({ status: "running", result: null, errorCode: null });

    Promise.all(tickets.map((ticket) => ticket.outcome)).then(
      (outcomes) => {
        if (runIdRef.current !== runId) {
          return;
        }
        ticketKeysRef.current = [];
        const settled = outcomes.filter(
          (outcome): outcome is Exclude<(typeof outcomes)[number], { cancelled: true }> =>
            !("cancelled" in outcome),
        );
        if (settled.length !== outcomes.length) {
          setView({ status: "idle", result: null, errorCode: null });
          return;
        }
        if (settled.some((outcome) => outcome.payload === undefined)) {
          setView({ status: "error", result: null, errorCode: "badPayload" });
          return;
        }
        const laneSamples = settled.map(
          (outcome) =>
            new Float32Array(
              outcome.payload?.buffer ?? new ArrayBuffer(0),
              outcome.payload?.byteOffset ?? 0,
              (outcome.payload?.byteLength ?? 0) / 4,
            ),
        );
        const laneOutputs = settled.map((outcome) => [...outcome.meta.outputs]);
        const laneStages = settled.map((outcome) => [...outcome.meta.stages]);
        const firstOutputs = laneOutputs[0] ?? [];
        if (laneOutputs.some((outputs) => !gridsMatch(firstOutputs, outputs))) {
          setView({ status: "error", result: null, errorCode: "gridMismatch" });
          return;
        }
        setView({
          status: "ready",
          result: {
            samples: laneSamples[0] ?? new Float32Array(0),
            laneSamples,
            stages: laneStages[0] ?? [],
            laneStages,
            outputs: firstOutputs,
            laneOutputs,
            totalElapsedMs: settled.reduce((sum, outcome) => sum + outcome.meta.totalElapsedMs, 0),
            startSample: range.startSample,
            endSample: range.endSample,
          },
          errorCode: null,
        });
      },
      (error: unknown) => {
        if (runIdRef.current !== runId) {
          return;
        }
        ticketKeysRef.current = [];
        setView({
          status: "error",
          result: null,
          errorCode: error instanceof DspRpcError ? error.code : "failed",
        });
      },
    );
  }, [channelMode, graph, original, range.endSample, range.startSample, state.validation.ok]);

  const cancel = useCallback(() => {
    cancelTickets();
    runIdRef.current += 1;
    setView({ status: "idle", result: null, errorCode: null });
  }, [cancelTickets]);

  const installOutput = useCallback(
    (outputId: string): PipelineInstallResult => {
      const result = view.result;
      if (result === null) {
        return { ok: false, reason: "noResult" };
      }
      const output = result.outputs.find((candidate) => candidate.nodeId === outputId);
      if (output === undefined) {
        return { ok: false, reason: "missingOutput" };
      }
      const lanes = result.laneSamples.map((samples) =>
        samples.slice(output.offsetSamples, output.offsetSamples + output.sampleCount),
      );
      const first = lanes[0];
      if (first === undefined) {
        return { ok: false, reason: "install" };
      }
      const installed = useSessionStore
        .getState()
        .setProcessed(
          lanes.length > 1 ? lanes : first,
          output.sampleRateHz,
          `pipeline:${output.label}`,
        );
      return installed.ok ? { ok: true } : { ok: false, reason: "install" };
    },
    [view.result],
  );

  return { ...view, run, cancel, installOutput };
}
