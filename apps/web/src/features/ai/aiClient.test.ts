import { describe, expect, it, vi } from "vitest";

import { AiClientError, aiErrorKey, createAiClient } from "./aiClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const BASE_URL = "http://api.test/api/v1";

describe("AI client excerpt upload", () => {
  it("rejects excerpts longer than 30 s before any request", async () => {
    const fetchFn = vi.fn();
    const client = createAiClient({ baseUrl: BASE_URL, fetch: fetchFn });
    const samples = new Float32Array(31_000);

    await expect(
      client.uploadExcerpt({
        samples,
        sampleRateHz: 1000,
        startSample: 0,
        endSample: 31_000,
      }),
    ).rejects.toMatchObject({ messageKey: "ai.error.excerpt_too_long" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("uploads a WAV excerpt and returns its audio id", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${BASE_URL}/ingest`);
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      return jsonResponse({ audio_id: "audio-1" });
    });
    const client = createAiClient({ baseUrl: BASE_URL, fetch: fetchFn });

    const audioId = await client.uploadExcerpt({
      samples: new Float32Array([0, 0.5, -0.5]),
      sampleRateHz: 48_000,
      startSample: 0,
      endSample: 3,
    });

    expect(audioId).toBe("audio-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("AI client models", () => {
  it("maps backend task ids to the public tab ids", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe(`${BASE_URL}/models`);
      return jsonResponse({
        ml_enabled: true,
        models: [
          {
            task: "neural_codec",
            model_id: "facebook/encodec_48khz",
            revision: "abc",
            license: "MIT",
            size_bytes: 76_292_186,
            state: "missing",
          },
        ],
      });
    });
    const client = createAiClient({ baseUrl: BASE_URL, fetch: fetchFn });

    await expect(client.getModels()).resolves.toEqual({
      ml_enabled: true,
      models: [
        {
          task: "neural-codec",
          model_id: "facebook/encodec_48khz",
          revision: "abc",
          license: "MIT",
          size_bytes: 76_292_186,
          state: "missing",
        },
      ],
    });
  });
});

describe("AI client jobs", () => {
  it("validates the job body and maps neural-codec to the backend path", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ job_id: "job-1" }, 202),
    );
    const client = createAiClient({ baseUrl: BASE_URL, fetch: fetchFn });

    await expect(client.startJob("asr", { audio_id: " " })).rejects.toThrow(TypeError);
    await expect(
      client.startJob("asr", {
        audio_id: "audio-1",
        params: [] as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow(TypeError);

    await expect(
      client.startJob("neural-codec", { audio_id: "audio-1", params: { bandwidth: 6 } }),
    ).resolves.toEqual({ job_id: "job-1" });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE_URL}/ml/neural_codec`);
    expect(JSON.parse(String(init?.body))).toEqual({
      audio_id: "audio-1",
      params: { bandwidth: 6 },
    });
  });

  it("maps backend envelope codes to stable i18n keys", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { code: "model_unavailable", message: "missing" } }, 503),
    );
    const client = createAiClient({ baseUrl: BASE_URL, fetch: fetchFn });

    const error = await client
      .startJob("denoise", { audio_id: "audio-1" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiClientError);
    expect(error).toMatchObject({
      code: "model_unavailable",
      messageKey: "ai.error.model_unavailable",
    });
    expect(aiErrorKey("ml_busy")).toBe("ai.error.ml_busy");
    expect(aiErrorKey("not_a_code")).toBe("ai.error.unknown");
  });

  it("parses split SSE frames, comments and multiple events per chunk", async () => {
    const chunks = [
      ": keepalive\n\n",
      'data: {"event":"progress","progress":0.25}\n\ndata: {"event":"do',
      'ne","result":{"kind":"audio","result_audio_id":"result-1"}}\n\n',
    ];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toEqual({ Accept: "text/event-stream" });
      return sseResponse(chunks);
    });
    const client = createAiClient({ baseUrl: BASE_URL, fetch: fetchFn });
    const events: string[] = [];
    let doneResult: unknown = null;

    await client.streamJob("job-1", (event) => {
      events.push(event.event);
      if (event.event === "done") {
        doneResult = event.result;
      }
    });

    expect(events).toEqual(["progress", "done"]);
    expect(doneResult).toEqual({ kind: "audio", result_audio_id: "result-1" });
  });

  it("cancels through DELETE /jobs/{id}", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("DELETE");
      return jsonResponse({ cancelled: true });
    });
    const client = createAiClient({ baseUrl: BASE_URL, fetch: fetchFn });

    await client.cancelJob("job-1");

    expect(fetchFn).toHaveBeenCalledWith(`${BASE_URL}/jobs/job-1`, { method: "DELETE" });
  });
});
