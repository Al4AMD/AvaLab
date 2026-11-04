/**
 * AI job hook and controller (F14, Wave-5 Plan 01 Task 5).
 *
 * The controller is plain TypeScript so the lifecycle is testable without a
 * DOM: upload → start job → stream events. `useAiJob` only subscribes React
 * to that snapshot. A superseded run or a deactivated controller ignores its
 * late events, so nothing writes state after unmount (StrictMode-safe).
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  type AiClient,
  AiClientError,
  type AiExcerptInput,
  type AiJobEvent,
  type AiJobEventName,
  aiClient,
  aiErrorKey,
} from "./aiClient";
import type { AiTask } from "./aiState";

export type AiJobStatus = "idle" | "uploading" | "running" | "done" | "error" | "cancelled";

export type AiJobState = {
  readonly status: AiJobStatus;
  readonly progress: number;
  readonly result: Record<string, unknown> | null;
  readonly errorKey: string | null;
  readonly errorCode: string | null;
};

export type AiJobController = {
  readonly getState: () => AiJobState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly run: (
    task: AiTask,
    input: AiExcerptInput,
    params?: Record<string, unknown>,
  ) => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly setActive: (active: boolean) => void;
  readonly dispose: () => void;
};

const INITIAL_STATE: AiJobState = {
  status: "idle",
  progress: 0,
  result: null,
  errorKey: null,
  errorCode: null,
};

function errorKeyFor(error: unknown): string {
  if (error instanceof AiClientError) {
    return error.messageKey;
  }
  return "ai.error.failed";
}

function errorCodeFor(error: unknown): string | null {
  return error instanceof AiClientError && error.code !== undefined ? error.code : null;
}

export function createAiJobController(client: AiClient): AiJobController {
  let state: AiJobState = INITIAL_STATE;
  let generation = 0;
  let active = true;
  let disposed = false;
  let currentJobId: string | null = null;
  const listeners = new Set<() => void>();

  function update(patch: Partial<AiJobState>): void {
    if (disposed || !active) {
      return;
    }
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener();
    }
  }

  function current(runGeneration: number): boolean {
    return !disposed && active && runGeneration === generation;
  }

  function handleTerminal(name: AiJobEventName, event: AiJobEvent): void {
    if (name === "progress") {
      update({ progress: event.progress ?? state.progress });
      return;
    }
    currentJobId = null;
    if (name === "done") {
      update({
        status: "done",
        progress: 1,
        result: event.result,
        errorKey: null,
        errorCode: null,
      });
    } else if (name === "cancelled") {
      update({ status: "cancelled", result: null, errorKey: null, errorCode: null });
    } else {
      update({
        status: "error",
        result: null,
        errorKey: aiErrorKey(event.code),
        errorCode: event.code,
      });
    }
  }

  async function run(
    task: AiTask,
    input: AiExcerptInput,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    if (disposed || !active) {
      return;
    }
    const runGeneration = ++generation;
    currentJobId = null;
    update({ status: "uploading", progress: 0, result: null, errorKey: null, errorCode: null });
    try {
      const audioId = await client.uploadExcerpt(input);
      if (!current(runGeneration)) {
        return;
      }
      const started = await client.startJob(task, { audio_id: audioId, params });
      if (!current(runGeneration)) {
        return;
      }
      currentJobId = started.job_id;
      update({ status: "running" });

      let terminal = false;
      await client.streamJob(started.job_id, (event) => {
        if (!current(runGeneration)) {
          return;
        }
        handleTerminal(event.event, event);
        if (event.event !== "progress") {
          terminal = true;
        }
      });
      if (!current(runGeneration)) {
        return;
      }
      currentJobId = null;
      if (!terminal) {
        update({ status: "error", errorKey: "ai.error.stream_ended", errorCode: null });
      }
    } catch (error) {
      if (!current(runGeneration)) {
        return;
      }
      currentJobId = null;
      update({ status: "error", errorKey: errorKeyFor(error), errorCode: errorCodeFor(error) });
    }
  }

  async function cancel(): Promise<void> {
    if (disposed || !active || (state.status !== "uploading" && state.status !== "running")) {
      return;
    }
    generation += 1;
    const jobId = currentJobId;
    currentJobId = null;
    if (jobId !== null) {
      try {
        await client.cancelJob(jobId);
      } catch {
        // The job may have reached a terminal state first; the UI still
        // leaves the running lane instead of pretending it is alive.
      }
    }
    update({ status: "cancelled", result: null, errorKey: null, errorCode: null });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run,
    cancel,
    setActive(next) {
      if (disposed) {
        return;
      }
      active = next;
      if (!next) {
        generation += 1;
      }
    },
    dispose() {
      disposed = true;
      active = false;
      generation += 1;
      listeners.clear();
    },
  };
}

export type UseAiJob = AiJobState & {
  readonly run: AiJobController["run"];
  readonly cancel: AiJobController["cancel"];
};

/** Subscribe a component to its own controller. */
export function useAiJob(client: AiClient = aiClient): UseAiJob {
  const controllerRef = useRef<AiJobController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createAiJobController(client);
  }
  const controller = controllerRef.current;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  useEffect(() => {
    controller.setActive(true);
    return () => {
      controller.setActive(false);
    };
  }, [controller]);

  return { ...state, run: controller.run, cancel: controller.cancel };
}
