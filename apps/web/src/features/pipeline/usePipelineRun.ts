/**
 * F15 worker runner. The view never touches PCM: this hook asks the session
 * store for the selected excerpt, lets the worker execute the graph, and
 * exposes only stage summaries and the concatenated output buffer. Installing
 * an output copies that output's slice into the processed-playback lane.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { PipelineOutput, PipelineStageSummary } from "../../session/ops";
import { DspRpcError } from "../../session/rpc";
import { useSessionStore } from "../../session/store";
import { type PipelineRange, type PipelineState, pipelineParamsError } from "./pipelineState";

export type PipelineRunStatus = "idle" | "running" | "ready" | "error";

export type PipelineRunResult = {
  readonly samples: Float32Array;
  readonly stages: readonly PipelineStageSummary[];
  readonly outputs: readonly PipelineOutput[];
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

export function usePipelineRun(state: PipelineState, range: PipelineRange): PipelineRunController {
  const graph = state.graph;
  const original = useSessionStore((session) => session.original);
  const [view, setView] = useState<PipelineRunViewState>({
    status: "idle",
    result: null,
    errorCode: null,
  });
  const runIdRef = useRef(0);
  const ticketKeyRef = useRef<string | null>(null);
  const previousGraphRef = useRef(graph);
  const previousSourceRef = useRef(original);

  useEffect(() => {
    const graphChanged = previousGraphRef.current !== graph;
    const sourceChanged = previousSourceRef.current !== original;
    previousGraphRef.current = graph;
    previousSourceRef.current = original;
    if (!graphChanged && !sourceChanged) {
      return;
    }
    runIdRef.current += 1;
    const key = ticketKeyRef.current;
    ticketKeyRef.current = null;
    if (key !== null) {
      useSessionStore.getState().cancel(key);
    }
    setView({ status: "idle", result: null, errorCode: null });
  }, [graph, original]);

  useEffect(
    () => () => {
      const key = ticketKeyRef.current;
      ticketKeyRef.current = null;
      if (key !== null) {
        useSessionStore.getState().cancel(key);
      }
    },
    [],
  );

  const run = useCallback(() => {
    if (original === null || !state.validation.ok || pipelineParamsError(graph) !== null) {
      return;
    }
    if (range.endSample <= range.startSample) {
      return;
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const ticket = useSessionStore.getState().deriveWithSourceSlice(
      "pipelineRun",
      {
        graph,
        sampleRateHz: original.sampleRateHz,
        startSample: range.startSample,
        endSample: range.endSample,
      },
      range.startSample,
      range.endSample,
    );
    ticketKeyRef.current = ticket.key;
    setView({ status: "running", result: null, errorCode: null });

    ticket.outcome.then(
      (outcome) => {
        if (runIdRef.current !== runId) {
          return;
        }
        ticketKeyRef.current = null;
        if ("cancelled" in outcome) {
          setView({ status: "idle", result: null, errorCode: null });
          return;
        }
        const payload = outcome.payload;
        if (payload === undefined) {
          setView({ status: "error", result: null, errorCode: "badPayload" });
          return;
        }
        setView({
          status: "ready",
          result: {
            samples: new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
            stages: outcome.meta.stages,
            outputs: outcome.meta.outputs,
            totalElapsedMs: outcome.meta.totalElapsedMs,
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
        ticketKeyRef.current = null;
        setView({
          status: "error",
          result: null,
          errorCode: error instanceof DspRpcError ? error.code : "failed",
        });
      },
    );
  }, [graph, original, range.endSample, range.startSample, state.validation.ok]);

  const cancel = useCallback(() => {
    const key = ticketKeyRef.current;
    if (key !== null) {
      useSessionStore.getState().cancel(key);
    }
    ticketKeyRef.current = null;
    runIdRef.current += 1;
    setView({ status: "idle", result: null, errorCode: null });
  }, []);

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
      const samples = result.samples.slice(
        output.offsetSamples,
        output.offsetSamples + output.sampleCount,
      );
      const installed = useSessionStore
        .getState()
        .setProcessed(samples, output.sampleRateHz, `pipeline:${output.label}`);
      return installed.ok ? { ok: true } : { ok: false, reason: "install" };
    },
    [view.result],
  );

  return { ...view, run, cancel, installOutput };
}
