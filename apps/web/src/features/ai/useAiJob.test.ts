import { describe, expect, it } from "vitest";

import type { AiClient, AiJobEvent } from "./aiClient";
import { createAiJobController } from "./useAiJob";

const INPUT = {
  samples: new Float32Array([0, 0.25, -0.25]),
  sampleRateHz: 48_000,
  startSample: 0,
  endSample: 3,
};

function fakeClient(overrides: Partial<AiClient> = {}): AiClient {
  return {
    getModels: async () => ({ models: [] }),
    uploadExcerpt: async () => "audio-1",
    startJob: async () => ({ job_id: "job-1" }),
    streamJob: async () => {},
    cancelJob: async () => {},
    ...overrides,
  };
}

function progress(value: number): AiJobEvent {
  return { event: "progress", progress: value, result: null, code: null };
}

function done(result: Record<string, unknown>): AiJobEvent {
  return { event: "done", progress: null, result, code: null };
}

function failure(code: string): AiJobEvent {
  return { event: "error", progress: null, result: null, code };
}

describe("AI job controller", () => {
  it("moves idle → uploading → running → done", async () => {
    const client = fakeClient({
      streamJob: async (_jobId, onEvent) => {
        onEvent(progress(0.5));
        onEvent(done({ kind: "audio", result_audio_id: "result-1" }));
      },
    });
    const controller = createAiJobController(client);
    const statuses: string[] = [];
    controller.subscribe(() => {
      const status = controller.getState().status;
      if (statuses.at(-1) !== status) {
        statuses.push(status);
      }
    });

    await controller.run("denoise", INPUT);

    expect(statuses).toEqual(["uploading", "running", "done"]);
    expect(controller.getState()).toMatchObject({
      status: "done",
      progress: 1,
      result: { kind: "audio", result_audio_id: "result-1" },
      errorKey: null,
    });
  });

  it("keeps the last progress when the stream reports an error", async () => {
    const client = fakeClient({
      streamJob: async (_jobId, onEvent) => {
        onEvent(progress(0.4));
        onEvent(failure("ml_failed"));
      },
    });
    const controller = createAiJobController(client);

    await controller.run("asr", INPUT);

    expect(controller.getState()).toMatchObject({
      status: "error",
      progress: 0.4,
      errorKey: "ai.error.ml_failed",
      errorCode: "ml_failed",
    });
  });

  it("cancels a running job and ignores later events", async () => {
    let releaseStream: (() => void) | null = null;
    let emit: ((event: AiJobEvent) => void) | null = null;
    const client = fakeClient({
      streamJob: async (_jobId, onEvent) => {
        emit = onEvent;
        await new Promise<void>((resolve) => {
          releaseStream = resolve;
        });
      },
      cancelJob: async () => {
        releaseStream?.();
      },
    });
    const controller = createAiJobController(client);
    const running = controller.run("separation", INPUT);
    await viWaitFor(() => expect(controller.getState().status).toBe("running"));

    await controller.cancel();
    expect(controller.getState().status).toBe("cancelled");

    (emit as ((event: AiJobEvent) => void) | null)?.(done({ kind: "stems" }));
    await running;
    expect(controller.getState().status).toBe("cancelled");
  });

  it("does not update state after disposal", async () => {
    let resolveUpload: ((audioId: string) => void) | null = null;
    const client = fakeClient({
      uploadExcerpt: () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        }),
    });
    const controller = createAiJobController(client);
    const running = controller.run("denoise", INPUT);
    expect(controller.getState().status).toBe("uploading");

    controller.dispose();
    (resolveUpload as ((audioId: string) => void) | null)?.("audio-1");
    await running;

    expect(controller.getState().status).toBe("uploading");
  });
});

async function viWaitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  assertion();
}
