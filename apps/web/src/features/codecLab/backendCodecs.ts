/**
 * Real-codec lane (F04, Wave-4 Plan 03 Task 1).
 *
 * The browser DSP path stays the default for hand-written codecs. This lane
 * only owns the backend round-trip: upload the selected mono 16-bit PCM
 * excerpt, ask ffmpeg to encode it, fetch the canonical WAV result, and align
 * it to the same Int16 grid the backend used. One upload is cached per
 * excerpt identity so A/B codec runs on the same excerpt do not re-upload.
 */
import { encodeWavPcm16, floatToInt16Pcm, inputHashFnv1a64, int16PcmToFloat } from "@avalab/dsp";

import type {
  CodecEncodeRequest,
  CodecEncodeResponse,
  CodecName,
  HealthResponse,
  IngestResponse,
} from "../../api/client";
import { api } from "../../api/client";
import { isRecordLike } from "../../session/protocol";
import {
  browserDecodeWav,
  type DecodeWav,
  type IngestCallResult,
  monoDownmix,
} from "../input/ingest";

export const REAL_CODEC_NAMES = ["wav", "flac", "mp3", "aac", "opus", "vorbis"] as const;
const UPLOAD_CACHE_LIMIT = 8;
const BITRATE_CODECS = ["mp3", "aac", "opus"] as const;

const KNOWN_BACKEND_CODES = new Set([
  "file_too_large",
  "duration_too_long",
  "decode_failed",
  "not_found",
  "invalid_request",
  "internal_error",
  "codec_unavailable",
  "encode_failed",
]);

export type RealCodecName = CodecName;

export type RealCodecParams = {
  readonly codec: RealCodecName;
  readonly bitrateKbps?: number;
  readonly quality?: number;
  readonly compressionLevel?: number;
};

export type RealCodecInput = {
  /** The selected excerpt (already sliced); never the whole source file. */
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
  readonly startSample: number;
  readonly endSample: number;
};

export type RealCodecClient = {
  POST(
    path: "/ingest",
    options: { body: FormData; signal?: AbortSignal },
  ): Promise<IngestCallResult<IngestResponse>>;
  POST(
    path: "/codec/encode",
    options: { body: CodecEncodeRequest; signal?: AbortSignal },
  ): Promise<IngestCallResult<CodecEncodeResponse>>;
  GET(
    path: "/audio/{audio_id}",
    options: {
      params: { path: { audio_id: string } };
      signal?: AbortSignal;
    },
  ): Promise<IngestCallResult<ArrayBuffer>>;
};

export type RealCodecStats = {
  readonly resultAudioId: string;
  readonly sizeBytes: number;
  readonly bitrateKbps: number;
  readonly encodeMs: number;
  readonly codecDelaySamples: number;
  readonly referenceStartSample: number;
  readonly alignedSampleCount: number;
  readonly durationSeconds: number;
  readonly sampleRateHz: number;
  readonly bitExact: boolean;
  readonly lossless: boolean;
};

export type RealCodecRun = {
  readonly decoded: Float32Array;
  readonly reference: Float32Array;
  readonly stats: RealCodecStats;
};

export type RealCodecFailure =
  | { readonly kind: "backendCode"; readonly code: string; readonly messageKey: string }
  | { readonly kind: "backendUnavailable"; readonly messageKey: string }
  | { readonly kind: "decodeFailed"; readonly messageKey: string }
  | { readonly kind: "alignment_mismatch"; readonly messageKey: string };

export class RealCodecError extends Error {
  readonly kind: RealCodecFailure["kind"];
  readonly code: string | undefined;
  readonly messageKey: string;

  constructor(failure: RealCodecFailure, options?: { cause?: unknown }) {
    super(failure.messageKey, options);
    this.name = "RealCodecError";
    this.kind = failure.kind;
    this.code = failure.kind === "backendCode" ? failure.code : undefined;
    this.messageKey = failure.messageKey;
  }
}

export type RealCodecOptions = {
  readonly client?: RealCodecClient;
  readonly decodeWav?: DecodeWav;
  readonly signal?: AbortSignal;
};

function backendCodeFailure(code: string): RealCodecError {
  return new RealCodecError({
    kind: "backendCode",
    code,
    messageKey: KNOWN_BACKEND_CODES.has(code) ? `codecLab.error.${code}` : "codecLab.error.unknown",
  });
}

function backendUnavailable(cause?: unknown): RealCodecError {
  return new RealCodecError(
    { kind: "backendUnavailable", messageKey: "codecLab.error.backend_unavailable" },
    cause === undefined ? undefined : { cause },
  );
}

function readEnvelopeCode(error: unknown): string | null {
  if (!isRecordLike(error) || !isRecordLike(error.error)) {
    return null;
  }
  return typeof error.error.code === "string" ? error.error.code : null;
}

async function request<T>(
  call: () => Promise<IngestCallResult<T>>,
  required: true,
): Promise<{ data: T }>;
async function request<T>(
  call: () => Promise<IngestCallResult<T>>,
  required: false,
): Promise<{ data: T | undefined }>;
async function request<T>(
  call: () => Promise<IngestCallResult<T>>,
  required: boolean,
): Promise<{ data: T | undefined }> {
  let result: IngestCallResult<T>;
  try {
    result = await call();
  } catch (cause) {
    throw backendUnavailable(cause);
  }
  if (!result.response.ok || (required && result.data === undefined)) {
    const code = readEnvelopeCode(result.error);
    throw code === null ? backendUnavailable() : backendCodeFailure(code);
  }
  return { data: result.data };
}

function uploadForm(input: RealCodecInput): FormData {
  const { samples, sampleRateHz, startSample, endSample } = input;
  if (samples.length === 0) {
    throw new RangeError("real-codec: empty excerpt");
  }
  if (
    !Number.isInteger(startSample) ||
    !Number.isInteger(endSample) ||
    startSample < 0 ||
    endSample <= startSample
  ) {
    throw new RangeError(
      `real-codec: invalid excerpt range [${String(startSample)}, ${String(endSample)})`,
    );
  }
  if (!Number.isInteger(sampleRateHz) || sampleRateHz <= 0 || sampleRateHz > 96_000) {
    throw new RangeError(
      `real-codec: sampleRateHz must be an integer in (0, 96000] (got ${String(sampleRateHz)})`,
    );
  }
  const wav = encodeWavPcm16(samples, { sampleRateHz });
  const bytes = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.append("file", new File([bytes], "excerpt.wav", { type: "audio/wav" }));
  return form;
}

const uploads = new Map<string, Promise<string>>();

function rememberUpload(key: string, promise: Promise<string>): Promise<string> {
  uploads.set(key, promise);
  if (uploads.size > UPLOAD_CACHE_LIMIT) {
    const oldest = uploads.keys().next().value;
    if (oldest !== undefined && oldest !== key) {
      uploads.delete(oldest);
    }
  }
  return promise;
}

/** Drop cached uploads (tests and a hard reset; production keeps the LRU). */
export function clearRealCodecUploads(): void {
  uploads.clear();
}

async function uploadExcerpt(
  client: RealCodecClient,
  input: RealCodecInput,
  form: FormData,
  signal: AbortSignal | undefined,
): Promise<string> {
  const key = `${inputHashFor(input)}:${input.startSample}:${input.endSample}:${input.sampleRateHz}`;
  const cached = uploads.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const promise = request(() => client.POST("/ingest", { body: form, signal }), true)
    .then(({ data }) => data.audio_id)
    .catch((error: unknown) => {
      uploads.delete(key);
      throw error;
    });
  rememberUpload(key, promise);
  return promise;
}

function inputHashFor(input: RealCodecInput): string {
  // `samples` IS the excerpt; the range/rate stay in the key so the same
  // bytes at a different source position or rate cannot alias.
  return inputHashFnv1a64(input.samples);
}

/** Backend-advertised codecs in their advertised order; unknown names drop. */
export function availableRealCodecs(health: HealthResponse | null): CodecName[] {
  const codecs = health?.codecs;
  if (!Array.isArray(codecs)) {
    return [];
  }
  return codecs.filter((name): name is CodecName =>
    (REAL_CODEC_NAMES as readonly string[]).includes(name),
  );
}

/** Encode the selected excerpt with a real backend codec and align it. */
export async function runRealCodec(
  input: RealCodecInput,
  params: RealCodecParams,
  options: RealCodecOptions = {},
): Promise<RealCodecRun> {
  const { client = defaultClient, decodeWav = browserDecodeWav, signal } = options;
  const form = uploadForm(input);
  const audioId = await uploadExcerpt(client, input, form, signal);
  const codecParams: Record<string, number> = {};
  if (
    (BITRATE_CODECS as readonly string[]).includes(params.codec) &&
    params.bitrateKbps !== undefined
  ) {
    codecParams.bitrate_kbps = params.bitrateKbps;
  }
  if (params.codec === "vorbis" && params.quality !== undefined) {
    codecParams.quality = params.quality;
  }
  if (params.codec === "flac" && params.compressionLevel !== undefined) {
    codecParams.compression_level = params.compressionLevel;
  }
  const encoded = await request(
    () =>
      client.POST("/codec/encode", {
        body: { audio_id: audioId, codec: params.codec, params: codecParams },
        signal,
      }),
    true,
  );

  const bytes = await request(
    () =>
      client.GET("/audio/{audio_id}", {
        params: { path: { audio_id: encoded.data.result_audio_id } },
        signal,
      }),
    true,
  );

  let decoded: Float32Array;
  try {
    decoded = monoDownmix(await decodeWav(bytes.data));
  } catch (cause) {
    throw new RealCodecError(
      { kind: "decodeFailed", messageKey: "codecLab.error.decode_failed" },
      { cause },
    );
  }

  const aligned = encoded.data.aligned_sample_count;
  const referenceStart = encoded.data.reference_start_sample;
  if (!Number.isInteger(aligned) || aligned <= 0 || !Number.isInteger(referenceStart)) {
    throw new RealCodecError({
      kind: "alignment_mismatch",
      messageKey: "codecLab.error.alignment_mismatch",
    });
  }
  if (decoded.length < aligned) {
    throw new RealCodecError({
      kind: "alignment_mismatch",
      messageKey: "codecLab.error.alignment_mismatch",
    });
  }

  const reference = int16PcmToFloat(floatToInt16Pcm(input.samples));
  if (referenceStart < 0 || referenceStart + aligned > reference.length) {
    throw new RealCodecError({
      kind: "alignment_mismatch",
      messageKey: "codecLab.error.alignment_mismatch",
    });
  }

  return {
    decoded: decoded.subarray(0, aligned),
    reference: reference.subarray(referenceStart, referenceStart + aligned),
    stats: {
      resultAudioId: encoded.data.result_audio_id,
      sizeBytes: encoded.data.size_bytes,
      bitrateKbps: encoded.data.bitrate_kbps,
      encodeMs: encoded.data.encode_ms,
      codecDelaySamples: encoded.data.codec_delay_samples,
      referenceStartSample: referenceStart,
      alignedSampleCount: aligned,
      durationSeconds: encoded.data.duration_s,
      sampleRateHz: encoded.data.sample_rate_hz,
      bitExact: encoded.data.bit_exact,
      lossless: encoded.data.lossless,
    },
  };
}

const defaultClient = {
  async POST(
    path: "/ingest" | "/codec/encode",
    options: { body: FormData | CodecEncodeRequest; signal?: AbortSignal },
  ): Promise<IngestCallResult<IngestResponse | CodecEncodeResponse>> {
    if (path === "/ingest") {
      const { data, error, response } = await api.POST(path, {
        body: { file: options.body } as unknown as { file: string },
        signal: options.signal,
      });
      return { data, error, response };
    }
    const { data, error, response } = await api.POST(path, {
      body: options.body as CodecEncodeRequest,
      signal: options.signal,
    });
    return { data, error, response };
  },
  async GET(
    path: "/audio/{audio_id}",
    options: {
      params: { path: { audio_id: string } };
      signal?: AbortSignal;
    },
  ): Promise<IngestCallResult<ArrayBuffer>> {
    const { data, error, response } = await api.GET(path, {
      params: options.params,
      parseAs: "arrayBuffer",
      signal: options.signal,
    });
    return { data: data as ArrayBuffer | undefined, error, response };
  },
} as unknown as RealCodecClient;
