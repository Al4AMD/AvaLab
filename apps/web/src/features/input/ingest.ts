/**
 * Upload ingest lane (F01, Wave-2 Plan 02 Task 1).
 *
 * Flow: File → POST /api/v1/ingest (multipart) → GET /audio/{id} (canonical
 * WAV) → decode seam → mono downmix → `loadSource(..., "ingested")`.
 *
 * - Caps are the BACKEND's truth (plan Review Focus 1): duration violations
 *   arrive as the backend's 422 `duration_too_long` envelope, and the
 *   session store's own guards backstop everything else. The client
 *   pre-checks only `file.size` as a courtesy. Nothing here truncates:
 *   out-of-cap samples REJECT.
 * - Errors are typed: the backend error envelope's stable `code` becomes the
 *   rejection's `messageKey` (`input.error.<code>`; unknown codes surface
 *   verbatim through `input.error.unknown` plus `code` — never swallowed).
 *   A readable 5xx envelope is ALSO a backendCode (the server answered;
 *   e.g. `internal_error`), so its copy stays honest. A failed lane (fetch
 *   throw, or non-2xx with no readable envelope) rejects the kind
 *   "backendUnavailable" — the lane error the UI pairs with a recovery hint.
 * - Store-flag discipline (plan Review Focus 3): the store's `backendOnline`
 *   flips only on real evidence from this lane's own calls — a throw or a
 *   non-2xx WITHOUT a readable envelope proves the lane down; any envelope
 *   answer (4xx or 5xx) proves it up.
 * - Decoding sits behind the injectable `decodeWav` seam: the default
 *   browser implementation constructs its AudioContext lazily INSIDE the
 *   call (never at module load), so node unit tests — which inject fakes —
 *   never touch Web Audio. Task 2's offline lane reuses the same seam.
 */
import { api, type IngestResponse } from "../../api/client";
import { isRecordLike } from "../../session/protocol";
import type { SessionSource, SessionStore } from "../../session/store";
import { useSessionStore } from "../../session/store";

/**
 * Client-side courtesy cap for the pre-check, mirroring the backend default
 * (`apps/api/src/avalab_api/config.py` `max_upload_bytes`, env
 * `AVALAB_MAX_UPLOAD_BYTES`). No endpoint publishes the runtime value yet,
 * so only the default constant can be mirrored; the backend's 413 envelope
 * stays the truth (plan Review Focus 1). Units in the name (AGENTS §10).
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Stable backend guard codes this flow surfaces, one key each (AGENTS §7). */
const KNOWN_BACKEND_CODES: readonly string[] = [
  "file_too_large",
  "duration_too_long",
  "decode_failed",
  "not_found",
  "invalid_request",
  "internal_error",
];

/** Discriminated failure kinds carried by every ingest rejection. */
export type IngestFailureKind =
  /** Client courtesy pre-check rejected the file; no fetch was issued. */
  | "fileTooLarge"
  /** The backend answered non-2xx with a readable error envelope. */
  | "backendCode"
  /** Lane error: fetch threw or the status was ≥ 500 (spec §2.4). */
  | "backendUnavailable"
  /** The decode seam threw (a canonical WAV should never get here). */
  | "decodeFailed"
  /** The session store's `loadSource` guards rejected the decoded samples. */
  | "storeCode";

/** The structured failure an `IngestError` carries. `messageKey` is the i18n
 * key the UI renders at render time (a locale switch re-renders correctly). */
export type IngestFailure = {
  readonly kind: IngestFailureKind;
  /** Raw code for the backendCode / storeCode kinds; undefined otherwise. */
  readonly code: string | undefined;
  readonly messageKey: string;
};

/** Rejection of the ingest lane: typed, code-bearing, never a swallowed
 * network error. The UI renders `messageKey` (with `code` verbatim for the
 * unknown-code kind) and offers the offline-lane hint for
 * `kind: "backendUnavailable"`. */
export class IngestError extends Error {
  readonly kind: IngestFailureKind;
  readonly code: string | undefined;
  readonly messageKey: string;

  constructor(failure: IngestFailure, options?: { cause?: unknown }) {
    super(failure.messageKey, options);
    this.name = "IngestError";
    this.kind = failure.kind;
    this.code = failure.code;
    this.messageKey = failure.messageKey;
  }
}

/** Successful ingest outcome: the settled (immutable) session source. */
export type LoadedSource = {
  readonly ok: true;
  readonly source: Readonly<SessionSource>;
};

/** Structural decode result: a real Web Audio `AudioBuffer` satisfies it. */
export type DecodedAudio = {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
};

/** Decode seam (plan Task 1/2): canonical WAV bytes → decoded audio. */
export type DecodeWav = (wavBytes: ArrayBuffer) => Promise<DecodedAudio>;

/** Default browser decode. One AudioContext per call, closed immediately —
 * no shared module state, and the constructor reference lives only in the
 * call body, so node tests that never call this never touch Web Audio. */
export function browserDecodeWav(wavBytes: ArrayBuffer): Promise<DecodedAudio> {
  const context = new AudioContext();
  return context.decodeAudioData(wavBytes).finally(() => {
    void context.close();
  });
}

/**
 * F01: analysis runs on a mono downmix (mean across channels). Mono input is
 * a plain copy; the result owns its bytes so the decoded buffer can be
 * released after load. Channel views are hoisted once (no per-sample
 * getChannelData calls).
 */
export function monoDownmix(decoded: DecodedAudio): Float32Array {
  const views: Float32Array[] = [];
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    views.push(decoded.getChannelData(channel));
  }
  const first = views[0];
  if (first === undefined) {
    return new Float32Array(0); // degenerate 0-channel seam fake; empty lane
  }
  if (views.length <= 1) {
    return first.slice();
  }
  const mixed = new Float32Array(first.length);
  for (let index = 0; index < mixed.length; index += 1) {
    let sum = 0;
    for (const view of views) {
      sum += view[index] ?? 0;
    }
    mixed[index] = sum / views.length;
  }
  return mixed;
}

/** Result triple of an openapi-fetch-style call (narrowed seam). `error` is
 * the parsed non-2xx body when openapi-fetch could parse it — read through
 * `envelopeCode`, never rendered raw. */
export type IngestCallResult<TData> = {
  readonly data?: TData;
  readonly error?: unknown;
  readonly response: Response;
};

/** Narrow client seam: exactly the two calls the ingest lane makes. */
export type IngestClient = {
  POST(path: "/ingest", options: { body: FormData }): Promise<IngestCallResult<IngestResponse>>;
  GET(
    path: "/audio/{audio_id}",
    options: { params: { path: { audio_id: string } } },
  ): Promise<IngestCallResult<ArrayBuffer>>;
};

/**
 * Adapter from the shared typed client to the narrow seam. It absorbs the
 * two generated-schema quirks at a single cast point (see schema.d.ts):
 * FastAPI emits the multipart part as a plain `string` schema while the
 * runtime body is FormData, and the WAV route's payload is declared
 * `unknown` while `parseAs: "arrayBuffer"` yields the bytes.
 */
const defaultClient: IngestClient = {
  async POST(path, options) {
    const { data, error, response } = await api.POST(path, {
      body: { file: options.body } as unknown as { file: string },
    });
    return { data, error, response };
  },
  async GET(path, options) {
    const { data, error, response } = await api.GET(path, {
      params: options.params,
      parseAs: "arrayBuffer",
    });
    return { data: data as ArrayBuffer | undefined, error, response };
  },
};

/** Narrow store seam for the lane (app singleton and test stores satisfy it
 * structurally). */
export type IngestStore = {
  getState(): Pick<
    SessionStore,
    "loadSource" | "markBackendReachable" | "markBackendUnreachable" | "original"
  >;
};

/** Options of `ingestFile`: seams default to the app singletons; tests and
 * future lanes (recording, offline shim) inject their own. */
export type IngestOptions = {
  readonly client?: IngestClient;
  readonly decodeWav?: DecodeWav;
  readonly maxUploadBytes?: number;
  readonly store?: IngestStore;
};

/** Non-2xx mapping (plan Task 1): a READABLE error envelope = the backend
 * answered with a stable code (known → `input.error.<code>`, unknown →
 * verbatim through `input.error.unknown`). This includes a 5xx envelope
 * (e.g. `internal_error`): the server answered, so it is reachable and the
 * copy must not claim a connection problem. An unreadable/absent envelope
 * = the lane itself failed → "backendUnavailable". */
function callFailure(call: IngestCallResult<unknown>): IngestError {
  const code = envelopeCode(call.error);
  if (code !== null) {
    if (KNOWN_BACKEND_CODES.includes(code)) {
      return new IngestError({ kind: "backendCode", code, messageKey: `input.error.${code}` });
    }
    return new IngestError({ kind: "backendCode", code, messageKey: "input.error.unknown" });
  }
  return laneUnavailable();
}

/** Extract the stable `code` from a parsed error envelope
 * (`{"error":{"code":…}}`, wave-0 model); null when absent/unreadable. */
function envelopeCode(error: unknown): string | null {
  if (!isRecordLike(error) || !isRecordLike(error.error)) {
    return null;
  }
  const code = error.error.code;
  return typeof code === "string" && code !== "" ? code : null;
}

function laneUnavailable(cause?: unknown): IngestError {
  return new IngestError(
    { kind: "backendUnavailable", code: undefined, messageKey: "input.error.backendUnavailable" },
    { cause },
  );
}

async function requestIngest(client: IngestClient, form: FormData): Promise<IngestResponse> {
  const call = await client.POST("/ingest", { body: form });
  if (call.response.ok && call.data !== undefined) {
    return call.data;
  }
  throw callFailure(call);
}

async function requestCanonicalWav(client: IngestClient, audioId: string): Promise<ArrayBuffer> {
  const call = await client.GET("/audio/{audio_id}", { params: { path: { audio_id: audioId } } });
  if (call.response.ok && call.data !== undefined) {
    return call.data;
  }
  throw callFailure(call);
}

/**
 * Upload one file through the ingest lane (plan Task 1). Resolves to the
 * settled session source; REJECTS `IngestError` on every failure path
 * (courtesy size pre-check, backend envelope code, lane down, decode seam
 * throw, store guard backstop). The store's derived cache and jobs are
 * emptied by the successful `loadSource` — a new source never inherits the
 * previous source's results.
 */
export async function ingestFile(file: File, options: IngestOptions = {}): Promise<LoadedSource> {
  const {
    client = defaultClient,
    decodeWav = browserDecodeWav,
    maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
    store = useSessionStore,
  } = options;
  if (!Number.isFinite(maxUploadBytes) || maxUploadBytes <= 0) {
    throw new TypeError("ingestFile: maxUploadBytes must be a positive finite number of bytes");
  }

  // Courtesy pre-check only: the backend's runtime cap is the truth (its 413
  // envelope carries file_too_large); this merely avoids shipping bytes that
  // cannot be accepted. Duration is NOT pre-checkable and stays the
  // backend's call.
  if (file.size > maxUploadBytes) {
    throw new IngestError({
      kind: "fileTooLarge",
      code: undefined,
      messageKey: "input.error.file_too_large",
    });
  }

  let ingest: IngestResponse;
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    ingest = await requestIngest(client, form);
  } catch (error) {
    if (!(error instanceof IngestError)) {
      // No response at all (network throw): the honest offline evidence.
      store.getState().markBackendUnreachable();
      throw laneUnavailable(error);
    }
    // The lane answered its own verdict: flip the flag on that evidence.
    if (error.kind === "backendCode") {
      store.getState().markBackendReachable();
    } else {
      store.getState().markBackendUnreachable();
    }
    throw error;
  }
  store.getState().markBackendReachable();

  let wavBytes: ArrayBuffer;
  try {
    wavBytes = await requestCanonicalWav(client, ingest.audio_id);
  } catch (error) {
    // Same kind-based flip as the POST catch: an envelope answer (e.g.
    // not_found or internal_error) is reachability evidence, a lane failure
    // is disconnection evidence — on BOTH calls, not the POST only.
    if (!(error instanceof IngestError)) {
      store.getState().markBackendUnreachable();
      throw laneUnavailable(error);
    }
    if (error.kind === "backendCode") {
      store.getState().markBackendReachable();
    } else {
      store.getState().markBackendUnreachable();
    }
    throw error;
  }

  let decoded: DecodedAudio;
  try {
    decoded = await decodeWav(wavBytes);
  } catch (error) {
    throw new IngestError(
      { kind: "decodeFailed", code: undefined, messageKey: "input.error.decode_failed" },
      { cause: error },
    );
  }

  const load = store
    .getState()
    .loadSource(monoDownmix(decoded), decoded.sampleRate, file.name, "ingested");
  if (!load.ok) {
    throw new IngestError({
      kind: "storeCode",
      code: load.code,
      messageKey: `input.error.${load.code}`,
    });
  }
  const settled = store.getState().original;
  if (settled === null) {
    // loadSource returned ok, so the source is set; this branch exists for
    // the null-narrowing only.
    throw new IngestError({
      kind: "storeCode",
      code: "invalidType",
      messageKey: "input.error.invalidType",
    });
  }
  return { ok: true, source: settled };
}
