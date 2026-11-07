import { floatToInt16Pcm } from "@avalab/dsp";
import { beforeEach, describe, expect, it } from "vitest";

import type { CodecEncodeRequest, CodecEncodeResponse, IngestResponse } from "../../api/client";
import type { DecodedAudio, DecodeWav } from "../input/ingest";
import {
  availableRealCodecs,
  clearRealCodecUploads,
  type RealCodecClient,
  RealCodecError,
  type RealCodecInput,
  runRealCodec,
} from "./backendCodecs";

type Call<T> = { data?: T; error?: unknown; response: Response };

function ok<T>(data: T): Call<T> {
  return { data, response: new Response(null, { status: 200 }) };
}

function envelope(code: string, status = 422): Call<never> {
  return {
    error: { error: { code, message: "backend detail" } },
    response: new Response(null, { status }),
  };
}

function encodeBody(overrides: Partial<CodecEncodeResponse> = {}): CodecEncodeResponse {
  return {
    result_audio_id: "result-id",
    size_bytes: 4096,
    bitrate_kbps: 128,
    encode_ms: 12.5,
    codec_delay_samples: 37,
    reference_start_sample: 0,
    aligned_sample_count: 4,
    duration_s: 0.1,
    sample_rate_hz: 48_000,
    channels: 1,
    bit_exact: true,
    lossless: true,
    ...overrides,
  };
}

function fakeClient(options?: {
  readonly decoded?: Float32Array[];
  readonly encode?: CodecEncodeResponse;
  readonly ingestError?: unknown;
  readonly encodeError?: unknown;
  readonly fetchAudioError?: unknown;
  readonly encodeResult?: Call<CodecEncodeResponse>;
}): RealCodecClient & {
  readonly ingestCalls: FormData[];
  readonly encodeCalls: CodecEncodeRequest[];
  readonly audioCalls: string[];
} {
  const ingestCalls: FormData[] = [];
  const encodeCalls: CodecEncodeRequest[] = [];
  const audioCalls: string[] = [];
  return {
    ingestCalls,
    encodeCalls,
    audioCalls,
    async POST(path: "/ingest" | "/codec/encode", callOptions: unknown) {
      if (path === "/ingest") {
        if (options?.ingestError !== undefined) {
          throw options.ingestError;
        }
        const form = (callOptions as { body: FormData }).body;
        ingestCalls.push(form);
        return ok<IngestResponse>({
          audio_id: `id-${ingestCalls.length}`,
          duration_s: 0.1,
          sample_rate_hz: 48_000,
          channels: 1,
          size_bytes: 100,
        });
      }
      if (options?.encodeError !== undefined) {
        throw options.encodeError;
      }
      const body = (callOptions as { body: CodecEncodeRequest }).body;
      encodeCalls.push(body);
      return options?.encodeResult ?? ok(options?.encode ?? encodeBody());
    },
    async GET(_path: "/audio/{audio_id}", callOptions: unknown) {
      if (options?.fetchAudioError !== undefined) {
        throw options.fetchAudioError;
      }
      const audioId = (callOptions as { params: { path: { audio_id: string } } }).params.path
        .audio_id;
      audioCalls.push(audioId);
      return ok(new ArrayBuffer(8));
    },
  } as unknown as RealCodecClient & {
    readonly ingestCalls: FormData[];
    readonly encodeCalls: CodecEncodeRequest[];
    readonly audioCalls: string[];
  };
}

function fakeDecode(channels: Float32Array[]): DecodeWav {
  return async (): Promise<DecodedAudio> => ({
    sampleRate: 48_000,
    numberOfChannels: channels.length,
    getChannelData(channel: number): Float32Array {
      const view = channels[channel];
      if (view === undefined) {
        throw new RangeError("missing fake channel");
      }
      return view;
    },
  });
}

const INPUT: RealCodecInput = {
  samples: new Float32Array([0.1, 0.2, 0.3, 0.4]),
  sampleRateHz: 48_000,
  startSample: 0,
  endSample: 4,
};

const LEFT = new Float32Array([0.1, 0.2, 0.3, 0.4]);
const RIGHT = new Float32Array([-0.1, -0.2, -0.3, -0.4]);
const STEREO_INPUT: RealCodecInput = {
  ...INPUT,
  channels: [LEFT, RIGHT],
};

async function uploadedChannels(file: File): Promise<{
  readonly channels: number;
  readonly samples: Int16Array;
}> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  return {
    channels: view.getUint16(22, true),
    samples: new Int16Array(bytes.buffer.slice(44)),
  };
}

beforeEach(() => {
  clearRealCodecUploads();
});

describe("runRealCodec upload cache", () => {
  it("uploads the selected excerpt once for identical runs", async () => {
    const client = fakeClient({ decoded: [new Float32Array([0.2, 0.3, 0.4, 0])] });

    await runRealCodec(
      INPUT,
      { codec: "flac" },
      {
        client,
        decodeWav: fakeDecode([new Float32Array([0.2, 0.3, 0.4, 0])]),
      },
    );
    await runRealCodec(
      INPUT,
      { codec: "flac" },
      {
        client,
        decodeWav: fakeDecode([new Float32Array([0.2, 0.3, 0.4, 0])]),
      },
    );

    expect(client.ingestCalls).toHaveLength(1);
    expect(client.encodeCalls).toHaveLength(2);
    const uploaded = client.ingestCalls[0]?.get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).size).toBe(44 + 2 * 4);
  });

  it("uploads separately for a different excerpt", async () => {
    const client = fakeClient({ decoded: [new Float32Array([0.2, 0.3, 0.4, 0])] });
    const decodeWav = fakeDecode([new Float32Array([0.2, 0.3, 0.4, 0])]);

    await runRealCodec(INPUT, { codec: "flac" }, { client, decodeWav });
    await runRealCodec(
      { ...INPUT, samples: new Float32Array([0.9, 0.8, 0.7, 0.6]) },
      { codec: "flac" },
      { client, decodeWav },
    );

    expect(client.ingestCalls).toHaveLength(2);
  });

  it("drops a failed upload from the cache so a retry re-uploads", async () => {
    const failure = new TypeError("network down");
    const client = fakeClient({ ingestError: failure });
    const decodeWav = fakeDecode([new Float32Array([0.2, 0.3, 0.4, 0])]);

    await expect(
      runRealCodec(INPUT, { codec: "flac" }, { client, decodeWav }),
    ).rejects.toMatchObject({ kind: "backendUnavailable" });
    await expect(
      runRealCodec(INPUT, { codec: "flac" }, { client: fakeClient(), decodeWav }),
    ).resolves.toBeDefined();
  });
});

describe("runRealCodec response mapping", () => {
  it("copies backend stats and slices the Int16 reference window", async () => {
    const client = fakeClient({
      decoded: [new Float32Array([0.3, 0.4])],
      encode: encodeBody({
        reference_start_sample: 1,
        aligned_sample_count: 2,
        size_bytes: 1234,
        bitrate_kbps: 64,
        codec_delay_samples: 9,
        bit_exact: false,
        lossless: false,
      }),
    });

    const run = await runRealCodec(
      INPUT,
      { codec: "mp3", bitrateKbps: 64 },
      { client, decodeWav: fakeDecode([new Float32Array([0.3, 0.4])]) },
    );

    expect(run.stats).toMatchObject({
      resultAudioId: "result-id",
      sizeBytes: 1234,
      bitrateKbps: 64,
      encodeMs: 12.5,
      codecDelaySamples: 9,
      referenceStartSample: 1,
      alignedSampleCount: 2,
      bitExact: false,
      lossless: false,
    });
    expect(run.decoded).toEqual(new Float32Array([0.3, 0.4]));
    expect(run.reference[0]).toBeCloseTo(0.2, 4);
    expect(run.reference[1]).toBeCloseTo(0.3, 4);
    expect(client.encodeCalls[0]?.params).toEqual({ bitrate_kbps: 64 });
  });

  it("trims extra decoded padding but rejects a short result", async () => {
    const client = fakeClient({
      decoded: [new Float32Array([0.3, 0.4, 0.9])],
      encode: encodeBody({ reference_start_sample: 0, aligned_sample_count: 2 }),
    });
    await expect(
      runRealCodec(
        INPUT,
        { codec: "opus" },
        {
          client,
          decodeWav: fakeDecode([new Float32Array([0.3, 0.4, 0.9])]),
        },
      ),
    ).resolves.toMatchObject({ decoded: new Float32Array([0.3, 0.4]) });

    const shortClient = fakeClient({
      decoded: [new Float32Array([0.3])],
      encode: encodeBody({ reference_start_sample: 0, aligned_sample_count: 2 }),
    });
    await expect(
      runRealCodec(
        INPUT,
        { codec: "opus" },
        {
          client: shortClient,
          decodeWav: fakeDecode([new Float32Array([0.3])]),
        },
      ),
    ).rejects.toMatchObject({ kind: "alignment_mismatch" });
  });
});

describe("runRealCodec errors", () => {
  it("maps a readable envelope code to a typed backendCode error", async () => {
    const client = fakeClient({
      decoded: [new Float32Array([0.2, 0.3, 0.4])],
      encodeResult: envelope("codec_unavailable"),
    });

    await expect(
      runRealCodec(
        INPUT,
        { codec: "vorbis" },
        {
          client,
          decodeWav: fakeDecode([new Float32Array([0.2, 0.3, 0.4])]),
        },
      ),
    ).rejects.toMatchObject({
      kind: "backendCode",
      code: "codec_unavailable",
      messageKey: "codecLab.error.codec_unavailable",
    });
  });

  it("maps a fetch throw to backendUnavailable", async () => {
    const client = fakeClient({
      decoded: [new Float32Array([0.2, 0.3, 0.4])],
      fetchAudioError: new TypeError("offline"),
    });
    await expect(
      runRealCodec(
        INPUT,
        { codec: "flac" },
        {
          client,
          decodeWav: fakeDecode([new Float32Array([0.2, 0.3, 0.4])]),
        },
      ),
    ).rejects.toMatchObject({ kind: "backendUnavailable" });
  });

  it("maps a decode seam throw to decodeFailed", async () => {
    const client = fakeClient({ decoded: [new Float32Array([0.2])] });
    const decodeWav: DecodeWav = async () => {
      throw new Error("bad wav");
    };
    const error = await runRealCodec(INPUT, { codec: "flac" }, { client, decodeWav }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(RealCodecError);
    expect((error as RealCodecError).kind).toBe("decodeFailed");
  });
});

describe("availableRealCodecs", () => {
  it("filters unknown names and preserves backend order", () => {
    expect(
      availableRealCodecs({
        status: "ok",
        version: "1",
        ffmpeg: true,
        codecs: ["mp3", "bogus", "wav", "flac"],
      }),
    ).toEqual(["mp3", "wav", "flac"]);
    expect(availableRealCodecs(null)).toEqual([]);
  });
});

describe("runRealCodec stereo", () => {
  it("uploads two interleaved channels when the excerpt is stereo", async () => {
    const client = fakeClient({ encode: encodeBody({ channels: 2 }) });

    await runRealCodec(
      STEREO_INPUT,
      { codec: "flac" },
      {
        client,
        decodeWav: fakeDecode([LEFT, RIGHT]),
      },
    );

    const file = client.ingestCalls[0]?.get("file") as File;
    const uploaded = await uploadedChannels(file);
    expect(uploaded.channels).toBe(2);
    expect(file.size).toBe(44 + 2 * 2 * LEFT.length);
    const left = Array.from(floatToInt16Pcm(LEFT));
    const right = Array.from(floatToInt16Pcm(RIGHT));
    expect(Array.from(uploaded.samples)).toEqual([
      left[0],
      right[0],
      left[1],
      right[1],
      left[2],
      right[2],
      left[3],
      right[3],
    ]);
  });

  it("keys the upload cache on both channels", async () => {
    const client = fakeClient({ encode: encodeBody({ channels: 2 }) });
    const decodeWav = fakeDecode([LEFT, RIGHT]);

    await runRealCodec(STEREO_INPUT, { codec: "flac" }, { client, decodeWav });
    await runRealCodec(
      { ...STEREO_INPUT, channels: [LEFT, new Float32Array(RIGHT.length).fill(0.5)] },
      { codec: "flac" },
      { client, decodeWav },
    );

    expect(client.ingestCalls).toHaveLength(2);
  });

  it("returns two trimmed playback lanes plus the mono metrics lanes", async () => {
    const left = new Float32Array([0.3, 0.4]);
    const right = new Float32Array([0.5, 0.6]);
    const client = fakeClient({
      encode: encodeBody({ channels: 2, aligned_sample_count: 2 }),
    });

    const run = await runRealCodec(
      STEREO_INPUT,
      { codec: "flac" },
      {
        client,
        decodeWav: fakeDecode([left, right]),
      },
    );

    expect(run.stats.channels).toBe(2);
    expect(run.channels).toHaveLength(2);
    expect(run.channels[0]).toEqual(left);
    expect(run.channels[1]).toEqual(right);
    expect(run.decoded[0]).toBeCloseTo(0.4, 6);
    expect(run.reference[0]).toBeCloseTo(0.1, 4);
  });

  it("rejects a decoded channel count that differs from the backend", async () => {
    for (const decoded of [
      [new Float32Array([0.3, 0.4])],
      [new Float32Array([0.3, 0.4]), new Float32Array([0.5, 0.6]), new Float32Array([0.7, 0.8])],
    ]) {
      const client = fakeClient({
        encode: encodeBody({ channels: 2, aligned_sample_count: 2 }),
      });
      await expect(
        runRealCodec(
          STEREO_INPUT,
          { codec: "flac" },
          {
            client,
            decodeWav: fakeDecode(decoded),
          },
        ),
      ).rejects.toMatchObject({ kind: "alignment_mismatch" });
    }
  });

  it("rejects a channel shorter than the aligned window", async () => {
    const client = fakeClient({
      encode: encodeBody({ channels: 2, aligned_sample_count: 2 }),
    });

    await expect(
      runRealCodec(
        STEREO_INPUT,
        { codec: "flac" },
        {
          client,
          decodeWav: fakeDecode([new Float32Array([0.3, 0.4]), new Float32Array([0.5])]),
        },
      ),
    ).rejects.toMatchObject({ kind: "alignment_mismatch" });
  });
});
