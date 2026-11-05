/**
 * AI-lab backend client (F14, Wave-5 Plan 01 Task 5).
 *
 * The generated OpenAPI client does not know the ML routes yet, so this lane
 * uses plain `fetch` behind a small injectable seam. SSE is parsed here (no
 * new dependency). Errors keep the backend's stable code and an i18n key;
 * audio bytes never enter the URL or job payload.
 */
import { encodeWavPcm16 } from "@avalab/dsp";

import { resolveBaseUrl } from "../../api/client";
import { isRecordLike } from "../../session/protocol";
import { AI_TASKS, type AiTask, aiTaskFromBackend, backendTask } from "./aiState";
import { appendSseChunk } from "./sseStream";

export const AI_MAX_EXCERPT_SECONDS = 30;

export type AiModelState = "available" | "missing" | "loading" | "error";

export type AiModelInfo = {
  readonly task: AiTask;
  readonly model_id: string;
  readonly revision: string;
  readonly license: string;
  readonly size_bytes: number;
  readonly state: AiModelState;
};

export type AiModelsResponse = {
  readonly ml_enabled: boolean;
  readonly models: readonly AiModelInfo[];
};

export type AiExcerptInput = {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
  readonly startSample: number;
  readonly endSample: number;
};

export type AiJobRequest = {
  readonly audio_id: string;
  readonly params?: Record<string, unknown>;
};

export type AiJobEventName = "progress" | "done" | "error" | "cancelled";

export type AiJobEvent = {
  readonly event: AiJobEventName;
  readonly progress: number | null;
  readonly result: Record<string, unknown> | null;
  readonly code: string | null;
};

export type AiClient = {
  getModels(): Promise<AiModelsResponse>;
  uploadExcerpt(input: AiExcerptInput): Promise<string>;
  startJob(task: AiTask, body: AiJobRequest): Promise<{ job_id: string }>;
  streamJob(jobId: string, onEvent: (event: AiJobEvent) => void): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
};

export type AiFetch = (url: string, init?: RequestInit) => Promise<Response>;

const KNOWN_ERROR_CODES = new Set([
  "model_unavailable",
  "job_not_found",
  "job_cancelled",
  "ml_failed",
  "ml_busy",
  "not_found",
  "invalid_request",
  "internal_error",
  "duration_too_long",
  "decode_failed",
  "file_too_large",
]);

/** Map a stable backend/job code to a translatable key. */
export function aiErrorKey(code: string | null | undefined): string {
  return code !== null && code !== undefined && KNOWN_ERROR_CODES.has(code)
    ? `ai.error.${code}`
    : "ai.error.unknown";
}

/** Typed client failure: the UI renders `messageKey`, never a raw message. */
export class AiClientError extends Error {
  readonly code: string | undefined;
  readonly messageKey: string;

  constructor(messageKey: string, code?: string, options?: { cause?: unknown }) {
    super(messageKey, options);
    this.name = "AiClientError";
    this.code = code;
    this.messageKey = messageKey;
  }
}

function backendUnavailable(cause?: unknown): AiClientError {
  return new AiClientError(
    "ai.error.backend_unavailable",
    undefined,
    cause === undefined ? undefined : { cause },
  );
}

function protocolError(): AiClientError {
  return new AiClientError("ai.error.protocol");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecordLike(value) && !Array.isArray(value);
}

function readEnvelopeCode(body: unknown): string | null {
  if (!isPlainRecord(body) || !isPlainRecord(body.error)) {
    return null;
  }
  return typeof body.error.code === "string" ? body.error.code : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestJson(fetchFn: AiFetch, url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, init);
  } catch (cause) {
    throw backendUnavailable(cause);
  }
  const body = await readJson(response);
  if (!response.ok) {
    const code = readEnvelopeCode(body);
    throw new AiClientError(aiErrorKey(code), code ?? undefined);
  }
  return body;
}

function validateExcerpt(input: AiExcerptInput): void {
  const { samples, sampleRateHz, startSample, endSample } = input;
  if (samples.length === 0) {
    throw new RangeError("ai: empty excerpt");
  }
  if (
    !Number.isInteger(startSample) ||
    !Number.isInteger(endSample) ||
    startSample < 0 ||
    endSample <= startSample
  ) {
    throw new RangeError(
      `ai: invalid excerpt range [${String(startSample)}, ${String(endSample)})`,
    );
  }
  if (!Number.isInteger(sampleRateHz) || sampleRateHz <= 0 || sampleRateHz > 96_000) {
    throw new RangeError(
      `ai: sampleRateHz must be an integer in (0, 96000] (got ${String(sampleRateHz)})`,
    );
  }
  const durationSeconds = (endSample - startSample) / sampleRateHz;
  if (durationSeconds > AI_MAX_EXCERPT_SECONDS) {
    throw new AiClientError("ai.error.excerpt_too_long", "invalid_request");
  }
}

function excerptForm(input: AiExcerptInput): FormData {
  validateExcerpt(input);
  const wav = encodeWavPcm16(input.samples, { sampleRateHz: input.sampleRateHz });
  const bytes = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.append("file", new File([bytes], "excerpt.wav", { type: "audio/wav" }));
  return form;
}

function normaliseModel(entry: unknown): AiModelInfo {
  if (!isPlainRecord(entry) || typeof entry.task !== "string") {
    throw protocolError();
  }
  const task = aiTaskFromBackend(entry.task);
  const state = entry.state;
  if (
    task === null ||
    typeof entry.model_id !== "string" ||
    typeof entry.revision !== "string" ||
    typeof entry.license !== "string" ||
    typeof entry.size_bytes !== "number" ||
    (state !== "available" && state !== "missing" && state !== "loading" && state !== "error")
  ) {
    throw protocolError();
  }
  return {
    task,
    model_id: entry.model_id,
    revision: entry.revision,
    license: entry.license,
    size_bytes: entry.size_bytes,
    state,
  };
}

function normaliseEvent(frame: string): AiJobEvent | null {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") {
      continue;
    }
    const raw = colon === -1 ? "" : line.slice(colon + 1);
    dataLines.push(raw.startsWith(" ") ? raw.slice(1) : raw);
  }
  if (dataLines.length === 0) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    throw protocolError();
  }
  if (!isPlainRecord(payload)) {
    throw protocolError();
  }
  const event = payload.event;
  if (event !== "progress" && event !== "done" && event !== "error" && event !== "cancelled") {
    throw protocolError();
  }
  const progress = payload.progress;
  const result = payload.result;
  const code = payload.code;
  if (
    (progress !== undefined && progress !== null && typeof progress !== "number") ||
    (result !== undefined && result !== null && !isPlainRecord(result)) ||
    (code !== undefined && code !== null && typeof code !== "string")
  ) {
    throw protocolError();
  }
  return {
    event,
    progress: typeof progress === "number" ? progress : null,
    result: isPlainRecord(result) ? result : null,
    code: typeof code === "string" ? code : null,
  };
}

function isTerminal(event: AiJobEvent): boolean {
  return event.event === "done" || event.event === "error" || event.event === "cancelled";
}

export type AiClientOptions = {
  readonly baseUrl?: string;
  readonly fetch?: AiFetch;
};

/** Build a client; tests inject `fetch` and `baseUrl`. */
export function createAiClient(options: AiClientOptions = {}): AiClient {
  const fetchFn: AiFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  function url(path: string): string {
    const base = (options.baseUrl ?? resolveBaseUrl()).replace(/\/$/, "");
    return `${base}${path}`;
  }

  return {
    async getModels(): Promise<AiModelsResponse> {
      const body = await requestJson(fetchFn, url("/models"));
      if (!isPlainRecord(body) || !Array.isArray(body.models)) {
        throw protocolError();
      }
      const mlEnabled = typeof body.ml_enabled === "boolean" ? body.ml_enabled : true;
      return { ml_enabled: mlEnabled, models: body.models.map(normaliseModel) };
    },

    async uploadExcerpt(input): Promise<string> {
      const body = await requestJson(fetchFn, url("/ingest"), {
        method: "POST",
        body: excerptForm(input),
      });
      if (!isPlainRecord(body) || typeof body.audio_id !== "string" || body.audio_id === "") {
        throw protocolError();
      }
      return body.audio_id;
    },

    async startJob(task, jobBody): Promise<{ job_id: string }> {
      if (!(AI_TASKS as readonly string[]).includes(task)) {
        throw new TypeError(`ai: unknown task ${String(task)}`);
      }
      if (typeof jobBody.audio_id !== "string" || jobBody.audio_id.trim() === "") {
        throw new TypeError("ai: audio_id must be a non-empty string");
      }
      if (jobBody.params !== undefined && !isPlainRecord(jobBody.params)) {
        throw new TypeError("ai: params must be a plain object");
      }
      const body = await requestJson(fetchFn, url(`/ml/${backendTask(task)}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_id: jobBody.audio_id, params: jobBody.params ?? {} }),
      });
      if (!isPlainRecord(body) || typeof body.job_id !== "string" || body.job_id === "") {
        throw protocolError();
      }
      return { job_id: body.job_id };
    },

    async streamJob(jobId, onEvent): Promise<void> {
      let response: Response;
      try {
        response = await fetchFn(url(`/jobs/${encodeURIComponent(jobId)}/events`), {
          headers: { Accept: "text/event-stream" },
        });
      } catch (cause) {
        throw backendUnavailable(cause);
      }
      if (!response.ok) {
        const body = await readJson(response);
        const code = readEnvelopeCode(body);
        throw new AiClientError(aiErrorKey(code), code ?? undefined);
      }
      if (response.body === null) {
        throw protocolError();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer = appendSseChunk(buffer, decoder.decode(value, { stream: true }));
          let separator = buffer.indexOf("\n\n");
          while (separator !== -1) {
            const frame = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            const event = normaliseEvent(frame);
            if (event !== null) {
              onEvent(event);
              if (isTerminal(event)) {
                return;
              }
            }
            separator = buffer.indexOf("\n\n");
          }
        }
        buffer += decoder.decode();
        const event = normaliseEvent(buffer);
        if (event !== null) {
          onEvent(event);
          if (isTerminal(event)) {
            return;
          }
        }
      } finally {
        reader.releaseLock();
      }
      throw new AiClientError("ai.error.stream_ended");
    },

    async cancelJob(jobId): Promise<void> {
      await requestJson(fetchFn, url(`/jobs/${encodeURIComponent(jobId)}`), {
        method: "DELETE",
      });
    },
  };
}

/** Shared app client. */
export const aiClient: AiClient = createAiClient();
