# Wave 7 — Stereo playback and real-codec stereo: design spec

> Drafted 2026-11-07. Design sections were approved in chat, then the owner
> narrowed scope to stereo playback, stereo export, and real ffmpeg codecs;
> per-channel DSP tools are explicitly deferred. This written spec was
> self-reviewed and approved by the owner on 2026-11-07. Implementation note:
> the source channel badge belongs in the player dock, because the upload card
> only exists before a source is loaded. Parent backlog:
> `docs/plans/wave-7/README.md`; authority: `AGENTS.md`.

## 1. Outcome

A student loads a stereo file. The original lane, the processed lane, and
real-codec WAV export preserve the two channels. Real codecs (WAV, FLAC, MP3,
AAC, Opus, Vorbis) encode and decode both channels. Analysis tools keep using
the mono downmix, so existing educational results and formulas stay comparable.

This closes a known F01 gap: `AGENTS.md` says "stereo is preserved for playback"
and Wave 2's spec already promised it, but the shipped frontend always downmixes
to mono.

Success criteria:

- A stereo source has two channels in the session store; a mono source keeps one.
- Original and real-codec processed playback use both channels through the
  existing transport, with no change to playhead, A/B, gain, or loudness matching.
- Real-codec WAV export is stereo; mono export is byte-identical to today.
- FLAC round-trip reports `bit_exact` only when every channel matches.
- Hand-written toy codecs, AI tools, and DSP tools remain mono and say so.
- Mono files behave exactly as before; the existing mono test suite is the
  regression baseline.
- No DSP worker protocol change; no per-channel DSP tool work.

## 2. Scope

In scope:

- `SessionSource` and `ProcessedSource` channel storage.
- Backend and offline ingest preserving 1–2 decoded channels.
- Player adapter for multichannel playback.
- Channel-aware WAV encoding and download.
- Real-codec backend encode/decode/alignment and frontend codec-lab path.
- One self-generated stereo demo clip for teaching and e2e: left and right
  carry different tones or alternating pan so the channels are audibly distinct;
  generated locally, CC0, provenance recorded.
- Mono/stereo labels, theory note, fa/en copy, docs, tests.

Out of scope:

- Per-channel sampling, speed, extent, reverb, filters, spectrum editor.
- Per-channel hand-written RLE/Huffman/µ-law/MDCT codecs.
- Per-channel pipeline, AI, metrics, waveform, spectrogram, or FFT views.
- True-stereo convolution or stereo IR support.
- More than 2 playback channels.
- Any change to the mono analysis contract.

## 3. Data model

New shared type in `packages/dsp/src/audio.ts`, exported from
`packages/dsp/src/index.ts`; the web app imports it from `@avalab/dsp`:

```ts
export type AudioChannels = readonly Float32Array[];
```

Invariants: length 1 or 2, equal per-channel length, finite samples, nonzero
length, duration ≤ `MAX_DURATION_SECONDS`, rate ≤ `MAX_SAMPLE_RATE_HZ`.

`SessionSource`:

```ts
type SessionSource = {
  samples: Float32Array;      // mono analysis lane
  channels: AudioChannels;    // playback lane
  sampleRateHz: number;
  name: string;
  sourceKind: SourceKind;
  demoId?: DemoClipId;
};
```

`ProcessedSource`:

```ts
type ProcessedSource = {
  samples: Float32Array;      // mono analysis lane
  channels: AudioChannels;    // playback lane
  sampleRateHz: number;
  label: string;
  sourceStartSample: number;
  sourceHash: string | null;
};
```

Rules:

- Mono source: `samples === channels[0]`; no extra copy.
- Stereo source: `samples` is the mean downmix of `channels`; one extra buffer.
- `loadSource` keeps its existing first-argument position but accepts
  `Float32Array | AudioChannels`. A `Float32Array` is wrapped as one channel and
  remains the analysis lane by reference. Existing callers and tests stay valid.
- `setProcessed` accepts `Float32Array | AudioChannels` with the same rule. Mono
  callers unchanged; stereo codec results pass channels.
- `loadSource` and `setProcessed` validate channel count, equal lengths,
  finiteness, rate, and duration before changing state. Rejections are typed
  store codes; no partial install.
- `inputHash` is channel-aware. Add `inputHash64Channels(channels)` in
  `packages/dsp/src/utils/hash.ts` and export it from the package index. Mono
  output must stay identical to the current hash; multi-channel hashing
  includes channel count so a stereo L/R pair cannot alias a mono concatenation.
- Derived-cache keys keep `op + canonicalJson(params) + inputHash`. A change to
  only the right channel must invalidate cached mono analysis results too.

## 4. Acquisition and session

Add one shared helper, e.g. `channelsFromDecoded(decoded: DecodedAudio):
AudioChannels`, in `apps/web/src/features/input/ingest.ts`:

- 1 channel: `[decoded.getChannelData(0)]`.
- 2 channels: both channel views in order.
- >2 channels: mono downmix for playback; backend ingest already caps at 2, so
  this is only the offline-browser fallback. The UI shows a notice that the file
  was folded to mono.

Lanes:

- Backend ingest: canonical WAV already keeps 1–2 channels; decode and pass both.
- Offline browser lane: same helper; no API call.
- Demo clips: mono clips unchanged; one new stereo clip.
- Recording and generator: mono; no fake stereo duplication.

The store computes the mono analysis lane from `channels` for stereo. The ingest
and offline lanes stop calling `monoDownmix(decoded)` directly for loading;
`monoDownmix` stays available for reverb IRs, AI inputs, and codec metrics.

## 5. Playback and export

- `sourceToBufferLike` takes `{channels, sampleRateHz}` and returns an
  `AudioBufferLike` with `numberOfChannels = channels.length` and each channel's
  data. The transport's existing multichannel buffer factory already copies all
  channels; no transport state-machine change. Its only caller, `usePlayer`,
  passes the active lane's `channels`.
- A mono processed result has one channel; Web Audio's normal mono-to-stereo
  upmix plays it on both speakers. The UI labels it "Mono result"; no manual
  channel duplication in the store.
- A/B switching, playhead mapping, gain reset, and loudness matching keep using
  the mono `samples` lane. Loudness matching remains mono-based and is documented.
- WAV export: extend `encodeWavPcm16` in `packages/dsp/src/codecs/pcmWav.ts` to
  accept `Float32Array | AudioChannels`. Mono output must be byte-identical;
  stereo output is interleaved, with `numChannels = 2`, correct block align, byte
  rate, and data size. `downloadWav` accepts the same union. Processed codec
  results export their channels; existing mono callers unchanged.

## 6. Real codec path

Backend:

- `apps/api/src/avalab_api/codecs.py`: stop forcing `-ac 1`; encode with the
  source channel count (1–2). Keep the Vorbis mono fallback documented in the
  codec spec if the experimental native encoder still rejects mono.
- `apps/api/src/avalab_api/routes/codec.py`: read source channels, decode to the
  same count, align using the mono downmix, compare every channel for
  `bit_exact`, write a channel-preserving trimmed WAV, store `channels`, and
  return `channels` in `CodecEncodeResponse`.
- Alignment: compute one lag from the mono downmix and apply it to all channels.
  This matches codec behavior where delay is channel-independent; per-channel
  delay estimation is out of scope.
- `bit_exact = lossless && all channels equal`; a mismatch in either channel is
  `false`.
- OpenAPI changes require `pnpm gen:api`; the generated TypeScript client is the
  only frontend contract.

Frontend:

- `RealCodecInput` gains optional `channels` (sliced excerpt channels); when
  absent, `[samples]` is used so existing mono tests keep working. `uploadForm`
  encodes the selected excerpt as a channel-preserving WAV instead of forcing
  mono. `inputHashFor` hashes `channels` when present, so the upload cache does
  not reuse a mono excerpt for a stereo run.
- Both single-run and batch codec paths pass sliced `channels`, not only mono
  `samples`; the batch comparison keeps using mono metrics.
- `runRealCodec` decodes the returned WAV into channels with
  `channelsFromDecoded`, trims every channel to the aligned length, and keeps
  mono `decoded`/`reference` lanes for existing metrics and alignment checks.
  `channels` is added to `RealCodecRun`.
- `realResult.run.channels` is what `playRealResult` passes to `setProcessed`.
  `RealCodecStats` and `CodecEncodeResponse` add the channel count.
- Add an `Export WAV` action to the real-codec result. It calls
  `downloadWav(realResult.run.channels, ...)`. Hand-written results keep their
  current mono playback path and get no stereo export.
- Codec-lab metrics stay on the mono downmix and are labeled "Mono analysis
  metrics" so a stereo codec's channel differences are not hidden as if measured
  per channel.
- Real-codec excerpt limit stays 30 s; no full-file stereo decode in the codec
  lab.

Hand-written codecs:

- RLE, Huffman, delta+Huffman, µ-law/A-law, and MDCT stay mono.
- Their UI shows a "Mono toy codec" label; no silent channel drop.
- No worker protocol change and no new bit-budget rules in this slice.

## 7. UI, labels, and analysis

- Player dock (the only always-visible source UI after load): `Mono`/`Stereo`
  badge with channel count, next to the lane label. The upload card exists only
  before a source is loaded and gets no badge.
- Player: `Mono result` badge when the active processed lane has one channel.
  The original lane never claims mono when the source is stereo.
- Analysis views (waveform, spectrogram, FFT, metrics): small "Mono analysis"
  indicator; no channel selector in this slice.
- Real codec panel: channel count and "Stereo" label for real results; "Mono toy
  codec" for hand-written results.
- AI, pipeline, and DSP tools: "Mono result" label when they install a mono
  processed lane on a stereo source.
- Add a short theory/help note: analysis is mono for comparability; playback and
  real codecs preserve stereo. Both fa and en, flagged for Persian review.
- Share URLs unchanged; no audio in URLs.

## 8. Errors and edge cases

- Uneven channel lengths, >2 channels at the store boundary, non-finite samples,
  or empty channels → typed rejection; previous source/processed lane survives.
- Offline >2-channel file → mono playback with a visible notice; no silent
  truncation.
- Missing/extra channels in a real-codec result → typed codec failure; do not
  install a partial lane.
- Mono source through every path → one channel; existing behavior and tests pass.
- Stereo source through a mono tool → mono processed result, clearly labeled.
- Codec delay/alignment mismatch → existing `alignment_mismatch` error, now
  checked across channels.
- `sourceStartSample` applies to every channel; processed slice length is equal
  across channels.
- Export of a mono result remains mono; export of a stereo result is stereo.
- No automatic upmix in the store; Web Audio's playback upmix is the only
  mono-to-stereo behavior, and the UI labels it.

## 9. Memory and performance

- Mono source: one analysis buffer plus transport copy, as today.
- Stereo source: mono analysis + two source channels + transport copy = five
  channel buffers worst case (~576 MB at 5 min/96 kHz). This is the accepted
  ceiling for the target laptop; no additional copies are introduced.
- Stereo processed codec results are capped by the existing 30 s codec excerpt.
- Ingest releases temporary decoded/encoded buffers after install; no channel
  copy beyond the mono analysis lane.
- No DSP on the main thread; worker protocol unchanged, so existing performance
  budgets remain.
- Stop playback and drop the previous transport buffer before attaching a new
  lane, preserving the single-live-node rule.

## 10. Tests

DSP/unit:

- `encodeWavPcm16` mono byte-identical; stereo header, interleaving, sizes.
- `inputHash64Channels`: mono equals current `inputHash64`; changing only R
  changes the hash; channel count is part of the hash.
- Store: mono load unchanged; stereo load stores 2 channels and mono downmix;
  setProcessed stereo; rejected uneven/non-finite/empty; previous state survives.
- Ingest/offline: 1/2/>2 decoded channel cases; backend and offline lanes.
- Player: `sourceToBufferLike` channel count; transport copies both channels;
  mono result still one channel; A/B position mapping unchanged.
- Codec frontend: stereo upload WAV; decoded channels; install; stereo WAV
  export; mono toy codec label; metrics stay mono.
- Backend: codec route preserves channels; FLAC bit-exact true for both; one
  channel mismatch false; lossy decoded WAV has 2 channels; response `channels`;
  mono regression.
- Generated API types compile after `pnpm gen:api`.

E2E:

- Load the new stereo demo clip; assert Stereo badge and no console errors.
- Play original; switch to a real-codec stereo result; A/B; export WAV; assert
  download filename and UI state.
- Run one mono DSP tool on the stereo source; assert “Mono result” and playback
  still works.
- fa RTL and en LTR; keyboard focus; no console errors.
- Optional manual check: decode exported WAV and assert 2 channels.

Gates:

- `pnpm check`, `pnpm e2e`, `pnpm gen:api` when backend schema changes.
- `uv run pytest`, `uv run ruff check .`, `uv run mypy .`.
- Docker smoke if backend codec changes affect the compose image.

## 11. Documentation and rollout

Phases, each ending green:

1. **PCM foundation**: `AudioChannels`, store normalization, channel-aware hash,
   ingest/offline channels, player adapter, WAV export, player source badge,
   stereo demo clip.
2. **Real codecs**: backend channel-preserving encode/decode/alignment, OpenAPI
   regeneration, frontend stereo upload/decode/install/export, codec labels,
   mono metrics label.
3. **Polish and closeout**: theory note, mono-result labels across tools, fa/en
   copy, docs, full gates, manual stereo export check.

Docs to update:

- `docs/ALGORITHMS.md`: channel-aware WAV encoding, mono downmix use, codec
  alignment rule.
- `docs/PROGRESS.md`: scope, phases, known mono limitations.
- `docs/DECISIONS.md`: D-056 stereo playback scope (playback + real codecs;
  per-channel DSP deferred).
- `docs/THIRD_PARTY.md`: self-generated stereo demo clip provenance.
- `docs/plans/wave-7/README.md`: link this spec and revise item 1 status.
- `README.md` only if user-facing feature summary changes.

No commit or merge is implied by this spec; owner approval gates each phase.

## 12. Risks

- Backend ffmpeg channel handling differs per codec, especially native Vorbis
  mono. Test mono and stereo per codec.
- Existing code and tests assume mono in many places; the mono suite is the
  regression gate, and store normalization keeps old call sites valid.
- Stereo memory is five channel buffers worst case; profile on the target laptop
  before release. If the budget fails, return to the owner before changing caps.
- Codec delay is assumed channel-independent; document and test the common case.
- Playback e2e cannot assert audible stereo directly; unit tests assert channel
  count and data, e2e asserts UI/export and clean console.
- Mono toy codecs, AI, and DSP tools remain mono; labels must be visible enough
  that students do not mistake them for stereo processing.
