# Stereo playback and real-codec stereo — implementation plan

> Source spec:
> [`2026-11-07-stereo-playback-and-real-codecs-design.md`](../specs/2026-11-07-stereo-playback-and-real-codecs-design.md)
> (owner approved in chat; written spec reviewed 2026-11-07). Parent backlog:
> [`docs/plans/wave-7/README.md`](../../plans/wave-7/README.md).
> Authority: `AGENTS.md`.
>
> No commit, push, merge, or deploy is implied by this plan. The owner gates
> each phase. `AGENTS.md` overrides the generic “commit every task” habit.

## Goal

Preserve one or two channels through:

1. session source storage and original playback;
2. real-codec (ffmpeg) upload, encode, decode, processed playback, and WAV
   export;
3. labels and documentation.

Keep mono analysis and every hand-written/DSP/AI tool mono. A stereo file must
sound stereo in the player, but waveform, spectrogram, FFT, metrics, and toy
codecs continue to use the mono downmix.

## Review focus

1. **Mono regression is the gate.** Every existing mono test must pass with
   byte-identical WAV output and identical `inputHash64` values.
2. **One channel model.** `samples` is always the mono analysis lane;
   `channels` is always the playback lane. No view invents a second model.
3. **No silent channel loss.** A stereo path either preserves both channels or
   labels the mono result; it never drops a channel without a visible reason.
4. **Backend truth.** ffmpeg encodes and decodes the source channel count;
   alignment is computed once on the mono downmix and applied to every channel.
5. **Memory ceiling.** At most five full-length channel buffers
   (mono analysis + 2 playback channels + transport copy + one work copy).
   Codec excerpts stay capped at 30 s.
6. **Bilingual/RTL.** New labels exist in `fa` and `en`; technical readouts
   stay LTR with Latin digits.

## Global constraints

- `packages/dsp` stays pure, deterministic, DOM-free, and Float64-internal
  where precision matters.
- No `any`, no untyped Python, no new dependencies.
- No DSP worker protocol change, no per-channel DSP tools, no stereo metrics.
- Mono source layout: `samples === channels[0]` (no extra buffer).
- Stereo source layout: `samples` is the mean downmix; one extra buffer.
- Hand-written codecs, AI tools, metrics, pipeline, FFT, waveform, and
  spectrogram stay mono and must say so where the result can be mistaken for
  stereo processing.
- Real-codec excerpts remain capped by `CODEC_LAB_PREVIEW_SECONDS = 30`.
- Do not add `LICENSE` files, model downloads, analytics, or storage.
- Owner must approve the plan before phase 1 starts.

## File map

### Create

- `packages/dsp/src/audio.ts` — `AudioChannels` type and channel helpers if
  needed.
- `packages/dsp/test/audio.test.ts` — channel validation/helper tests if the
  file owns behavior.
- `apps/web/src/lib/channelLabels.ts` — optional shared label key helper only
  if two views need the same mapping; otherwise skip (YAGNI).
- `tools/demo_clips/test_generate.py` — stereo demo clip format test.

### Modify — DSP

- `packages/dsp/src/index.ts` — export `AudioChannels`,
  `inputHash64Channels`.
- `packages/dsp/src/utils/hash.ts` — channel-aware hash.
- `packages/dsp/test/utils/hash.test.ts` — mono equivalence, channel-count
  domain separation, right-channel sensitivity.
- `packages/dsp/src/codecs/pcmWav.ts` — `Float32Array | AudioChannels` input,
  interleaved stereo, mono byte-identical.
- `packages/dsp/test/codecs/pcmWav.test.ts` — stereo header/interleave tests.

### Modify — web session and input

- `apps/web/src/session/store.ts` — `channels` fields, union
  `loadSource`/`setProcessed`, channel validation, channel-aware hash, optional
  folded-channel metadata.
- `apps/web/src/session/store.test.ts` — stereo load/processed/rejection tests.
- `apps/web/src/session/store.slice.test.ts` — keep mono slice test compiling.
- `apps/web/src/session/ops.pipeline.test.ts` — keep mono load compiling.
- `apps/web/src/features/input/ingest.ts` — `channelsFromDecoded`, channel
  pass-through, keep `monoDownmix` for analysis.
- `apps/web/src/features/input/ingest.test.ts` — 1/2/>2 channel lanes.
- `apps/web/src/features/input/offline.ts` — channel pass-through and
  folded-channel notice metadata.
- `apps/web/src/features/input/offline.test.ts` — 1/2/>2 channel lanes.
- `apps/web/src/features/input/demo.tsx` — no logic change unless metadata must
  be passed; confirm demo loader goes through `loadDemoClip`.

### Modify — playback and export

- `apps/web/src/features/player/transport.ts` — `sourceToBufferLike` accepts
  `channels`.
- `apps/web/src/features/player/transport.test.ts` — extend `bufferFactory`
  fake to copy every channel; add stereo cases.
- `apps/web/src/features/player/usePlayer.ts` — pass active lane's `channels`.
- `apps/web/src/features/player/player.tsx` — source channel badge and
  “Mono analysis” indicator when source is stereo.
- `apps/web/src/lib/download.ts` — `downloadWav` union.
- `apps/web/src/lib/download.test.ts` — stereo WAV bytes and mono regression.

### Modify — real codecs

- `apps/api/src/avalab_api/codecs.py` — channel-aware `encode_audio`.
- `apps/api/src/avalab_api/routes/codec.py` — source channels, channel-
  preserving decode/alignment/bit-exactness/trim/store/response.
- `apps/api/tests/audio_fixtures.py` — stereo fixture.
- `apps/api/tests/test_codec.py` — stereo round-trip and mismatch tests.
- `apps/api/tests/test_codecs.py` — channel-aware argument tests.
- `apps/api/openapi.json` — generated.
- `apps/web/src/api/schema.d.ts` — generated.
- `apps/web/src/features/codecLab/backendCodecs.ts` — optional `channels`,
  channel-aware upload/hash/decode/run stats.
- `apps/web/src/features/codecLab/backendCodecs.test.ts` — stereo upload,
  hash, decode, trim, channel mismatch.
- `apps/web/src/features/codecLab/codecLabView.tsx` — sliced channels for
  single/batch paths, stereo result install/export, labels.
- `apps/web/src/features/codecLab/codecLabView.test.tsx` — stereo install and
  export test if the view test harness exists; otherwise extend the nearest
  codec-lab view test.

### Modify — demo assets and docs

- `tools/demo_clips/generate.py` — one deterministic stereo clip.
- `apps/web/public/demo/<stereo-clip>.wav` — generated asset.
- `apps/web/src/features/input/offline.ts` — clip registry entry.
- `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json` — clip title,
  channel badges, mono-result labels, codec export, theory note.
- `docs/THIRD_PARTY.md` — stereo clip provenance.
- `docs/ALGORITHMS.md` — stereo WAV interleave and codec alignment rule.
- `docs/PROGRESS.md` — phase status and known mono limitations.
- `docs/DECISIONS.md` — D-056.
- `docs/plans/wave-7/README.md` — link plan/spec and update item 1 status.
- `README.md` — only if the feature summary mentions stereo limitations.
- `apps/web/e2e/codec-lab.spec.ts`, `apps/web/e2e/player.spec.ts` — stereo
  e2e coverage.
- `docs/superpowers/specs/2026-11-07-stereo-playback-and-real-codecs-design.md`
  — record approval and the player-badge placement decision.

## Phase 1 — PCM foundation

End state: stereo files load, play, and export as stereo; mono behavior and
all existing mono tests are unchanged.

### Task 1 — Add the shared channel type

**Files:** `packages/dsp/src/audio.ts`, `packages/dsp/src/index.ts`,
`packages/dsp/test/audio.test.ts` if the file has behavior.

1. Create `packages/dsp/src/audio.ts`:
   ```ts
   /** Playback channels: one or two equal-length Float32 lanes. */
   export type AudioChannels = readonly Float32Array[];
   ```
   Keep it type-only unless a shared runtime guard is genuinely reused by the
   store and WAV encoder; do not add a validator on speculation.
2. Re-export `type { AudioChannels }` from `packages/dsp/src/index.ts`.
3. Run `pnpm --filter @avalab/dsp typecheck` and
   `pnpm --filter @avalab/dsp test`.

**Verification:** package typecheck and tests pass; no behavior change.

### Task 2 — Channel-aware input hash

**Files:** `packages/dsp/src/utils/hash.ts`,
`packages/dsp/test/utils/hash.test.ts`, `packages/dsp/src/index.ts`.

1. Add:
   ```ts
   export function inputHash64Channels(channels: AudioChannels): string
   ```
   Rules:
   - one channel: return `inputHash64(channels[0])` exactly;
   - 1–2 channels only; reject length 0 or >2 with `RangeError`;
   - equal lengths, or reject with `RangeError`;
   - seed both lanes with a domain-separated channel count before walking
     channel 0, then walk channel 1; do not allocate a concatenated buffer;
   - keep the existing `inputHash64` implementation untouched.
2. Return 16 lowercase hex chars.
3. Tests:
   - mono output equals `inputHash64` for empty, simple, and random data;
   - changing only the right channel changes the hash;
   - a stereo pair does not equal the mono concatenation/other channel count;
   - empty channel list and >2 channels throw;
   - uneven lengths throw;
   - input arrays are not mutated.
4. Export from `packages/dsp/src/index.ts`.
5. Run `pnpm --filter @avalab/dsp test`.

**Pinned detail:** this hash is the existing two-lane FNV-1a-32 + MurmurHash3
fmix32 fingerprint, not published FNV-1a-64. Keep that comment.

### Task 3 — Stereo WAV encoding

**Files:** `packages/dsp/src/codecs/pcmWav.ts`,
`packages/dsp/test/codecs/pcmWav.test.ts`.

1. Change the public input to `Float32Array | AudioChannels`:
   ```ts
   export function encodeWavPcm16(
     source: Float32Array | AudioChannels,
     options: WavPcm16Options,
   ): Uint8Array
   ```
   A `Float32Array` is mono; an array is 1–2 channels.
2. Validate channels: 1–2, equal lengths, every element `Float32Array`, finite
   samples via `floatToInt16Pcm`.
3. Mono path must be byte-identical to today:
   - 44-byte header;
   - `numChannels=1`, block align 2, byte rate `sampleRateHz * 2`;
   - data size `2N`.
4. Stereo path:
   - `numChannels=2`;
   - block align 4;
   - byte rate `sampleRateHz * 4`;
   - data size `4N`;
   - interleave `L0,R0,L1,R1,…` as little-endian int16.
5. Update the header comment formula/layout and edge cases.
6. Tests: mono byte-for-byte snapshot against the current output; stereo tag,
   sizes, interleaving, sample-rate validation, odd/uneven channel rejection.
7. Run:
   ```bash
   pnpm --filter @avalab/dsp test
   pnpm --filter @avalab/dsp typecheck
   ```

### Task 4 — WAV download accepts channels

**Files:** `apps/web/src/lib/download.ts`, `apps/web/src/lib/download.test.ts`.

1. Change:
   ```ts
   export function downloadWav(
     source: Float32Array | AudioChannels,
     sampleRateHz: number,
     filename: string,
   ): void
   ```
2. Pass the union straight to `encodeWavPcm16`.
3. Keep the mono test byte-identical. Add a stereo test asserting
   `numChannels=2`, data size `4N`, and interleaved bytes.
4. Run `pnpm --filter @avalab/web test -- download.test.ts`.

### Task 5 — Store channel fields and validation

**Files:** `apps/web/src/session/store.ts`,
`apps/web/src/session/store.test.ts`, `apps/web/src/session/store.slice.test.ts`,
`apps/web/src/session/ops.pipeline.test.ts`.

1. Import `AudioChannels`, `inputHash64Channels` from `@avalab/dsp`.
2. Add `readonly channels: AudioChannels` to `SessionSource` and
   `ProcessedSource`; update the `SessionSource` comment that still says
   “mono analysis lane”.
3. Add optional `foldedFromChannelCount?: number` to `SessionSource` so the
   offline `>2` notice survives after load. This is metadata, not playback
   data.
4. Add a shared internal normalizer:
   ```ts
   type SourceInput = Float32Array | AudioChannels;
   type NormalizedSource = {
     channels: AudioChannels;
     samples: Float32Array;
     inputHash: string;
   };
   ```
   - `Float32Array` → `channels = [source]`, `samples = source` by reference,
     hash = `inputHash64Channels([source])` (which must equal
     `inputHash64(source)`).
   - array → validate 1–2 channels, equal nonzero lengths, finite; stereo
     `samples` = mean of the lanes (inline loop in the store; do NOT import
     `monoDownmix` from `features/input/ingest`, which imports the store and
     would create a cycle); hash = `inputHash64Channels(channels)`.
   - reject 0 channels, >2 channels, non-`Float32Array` members, unequal
     lengths, zero-length lanes, and non-finite samples. The zero-length rule
     also applies to the legacy mono `Float32Array` input; add a regression
     test for it (no existing test relies on an empty load). The normalizer
     distinguishes `empty` (zero-length lane) from `invalidType`/`notFinite`;
     `loadSource` maps `empty` to `invalidType`, while `setProcessed` keeps
     returning the existing `empty` code.
5. Change `loadSource`:
   ```ts
   loadSource(
     source: SourceInput,
     sampleRateHz: number,
     name: string,
     sourceKind: SourceKind,
     demoId?: DemoClipId,
     options?: { readonly foldedFromChannelCount?: number },
   ): LoadSourceResult
   ```
   Keep positional compatibility. `foldedFromChannelCount` is accepted only
   when it is a positive integer and the loaded source is mono; otherwise
   reject `invalidType`.
6. Change `setProcessed`:
   ```ts
   setProcessed(
     source: SourceInput,
     sampleRateHz: number,
     label: string,
     options?: SetProcessedOptions,
   ): SetProcessedResult
   ```
   Run the same normalizer; store `channels` and the mono `samples`.
7. Keep caps and selection in source samples. Keep `sourceStartSample`
   validation against the source length. A rejected load leaves the previous
   source and processed lane untouched.
8. Tests:
   - existing mono equality objects gain `channels: [samples]`; assert
     `channels[0] === samples`;
   - stereo load stores both lanes and the mean analysis lane; hash is
     channel-aware;
   - changing only the right channel changes `inputHash`;
   - stereo processed result stores channels and mono analysis;
   - 0/3 channels, uneven lengths, non-`Float32Array` member, non-finite
     sample, empty channels rejected; previous state survives;
   - `foldedFromChannelCount` round-trip and rejection cases;
   - existing mono slice/pipeline tests compile and pass.
9. Run:
   ```bash
   pnpm --filter @avalab/web test -- store.test.ts store.slice.test.ts ops.pipeline.test.ts
   pnpm --filter @avalab/web typecheck
   ```

### Task 6 — Ingest and offline lanes preserve channels

**Files:** `apps/web/src/features/input/ingest.ts`,
`apps/web/src/features/input/ingest.test.ts`,
`apps/web/src/features/input/offline.ts`,
`apps/web/src/features/input/offline.test.ts`.

1. Add to `ingest.ts`:
   ```ts
   export function channelsFromDecoded(decoded: DecodedAudio): AudioChannels
   ```
   - 1 channel: `[decoded.getChannelData(0)]`;
   - 2 channels: both views in order;
   - >2: return `[monoDownmix(decoded)]` (offline fallback only).
2. In `ingestFile`, replace
   `loadSource(monoDownmix(decoded), …)` with
   `loadSource(channelsFromDecoded(decoded), …)`.
3. In `offline.ts`'s `decodeAndLoad`, do the same. Compute
   `foldedFromChannelCount = decoded.numberOfChannels > 2 ? decoded.numberOfChannels : undefined`
   and pass it as the sixth `loadSource` option.
4. Keep `monoDownmix` exported: it still serves the `>2` fallback, reverb IRs,
   AI inputs, and codec metrics.
5. Tests:
   - backend ingest stereo WAV → source has two channels and mean mono lane;
   - backend ingest mono → one channel, `samples === channels[0]`;
   - offline stereo → two channels;
   - offline 4-channel → one mono channel plus
     `foldedFromChannelCount === 4`;
   - existing failure/rejection tests unchanged.
6. Run:
   ```bash
   pnpm --filter @avalab/web test -- ingest.test.ts offline.test.ts
   ```

### Task 7 — Player adapter and badges

**Files:** `apps/web/src/features/player/transport.ts`,
`apps/web/src/features/player/transport.test.ts`,
`apps/web/src/features/player/usePlayer.ts`,
`apps/web/src/features/player/player.tsx`,
`apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`.

1. Change:
   ```ts
   export function sourceToBufferLike(source: {
     readonly channels: AudioChannels;
     readonly sampleRateHz: number;
   }): AudioBufferLike
   ```
   Return `numberOfChannels = source.channels.length`; `getChannelData(i)`
   returns `source.channels[i]` and throws for an unknown index.
2. `usePlayer` already passes the active lane; no call-site change needed
   because both source types gain `channels`. Confirm no other caller exists.
3. Extend the `bufferFactory` fake in `transport.test.ts` to copy every
   channel:
   ```ts
   for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
     buffer.getChannelData(channel).set(source.getChannelData(channel));
   }
   ```
4. Add tests: mono adapter returns 1 channel; stereo returns 2 and both
   channel arrays are copied; an invalid channel index throws.
5. Player source badge: the loaded-source UI is the player dock (the upload
   card only exists before load). Add next to the lane badge:
   - `data-testid="player.channels"`;
   - `t("player.channels.count", { count: original.channels.length })`;
   - show “Mono analysis” (`player.analysis.mono`) when
     `original.channels.length === 2`, because every tool reads `samples`;
   - when `original.foldedFromChannelCount` exists, show
     `t("player.channels.folded", { count: original.foldedFromChannelCount })`
     so a 3+-channel offline file is not silently presented as a native mono
     source.
6. i18n keys:
   - `player.channels.count`: `{{count}} ch` / `{{count}} کانال`;
   - `player.analysis.mono`: “Mono analysis” / «تحلیل تک‌کاناله»;
   - `player.channels.folded`: “Folded {{count}} channels to mono” /
     «{{count}} کانال به تک‌کانال تبدیل شد» (owner review).
7. Update the transport header’s memory paragraph: stereo adds the two source
   channel buffers, so the ceiling becomes five full-length channel buffers
   (not two).
8. Existing `player.lane` tests still pass; add a stereo assertion in e2e later.
8. Run:
   ```bash
   pnpm --filter @avalab/web test -- transport.test.ts
   pnpm i18n:check
   ```

### Task 8 — Stereo demo clip

**Files:** `tools/demo_clips/generate.py`,
`tools/demo_clips/test_generate.py`, `apps/web/public/demo/`,
`apps/web/src/features/input/offline.ts`,
`apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`,
`docs/THIRD_PARTY.md`.

1. Add a deterministic stereo clip to `generate.py`:
   - 48 kHz, 16-bit PCM, 5.0 s, 2 channels, 480000 frames;
   - easy to hear the difference: 440 Hz on the left and 660 Hz on the right
     at equal amplitude, or alternating pan; fixed constants only;
   - no clipping;
   - name `stereo-tones-440-660hz-5s.wav`.
2. Extend `write_wav` to accept `(N, C)` arrays and set
   `setnchannels(C)`. Keep the three existing mono clips byte-identical.
3. Generate the asset into `apps/web/public/demo/`; record its size/SHA in
   `docs/THIRD_PARTY.md` and update the “all seven clips” summary to include
   the new file (eight assets total, including the transcript).
4. Add `stereo` to `DemoClipId` and `DEMO_CLIPS` with
   `seconds: 5`, `rateHz: 48_000`.
5. Add localized titles:
   - en: “Stereo tones (440 Hz left, 660 Hz right)”;
   - fa: «نُت‌های استریو (۴۴۰ هرتز چپ، ۶۶۰ هرتز راست)» — flagged for owner
     Persian review.
6. `tools/demo_clips/test_generate.py`: read the generated file with `wave`,
   assert 2 channels, 16-bit, 48 kHz, 5.0 s, both channels differ, and no
   clipping.
7. Run:
   ```bash
   uv run --directory tools/demo_clips python generate.py
   uv run --directory tools/demo_clips python -m unittest test_generate.py
   ```
   Regenerate twice and compare SHA-256: must be identical.
8. Run `pnpm i18n:check` and the web demo/offline tests.

**Phase 1 gate:** `pnpm check`; `pnpm e2e` (existing suite); manual load of the
stereo clip in both locales, play, and confirm the source badge; export is not
available until phase 2 (real codec result).

## Phase 2 — Real codecs

End state: the codec lab uploads stereo excerpts, encodes/decodes both
channels, plays the stereo result, exports stereo WAV, and reports bit-exactness
across both channels. Toy codecs remain mono and labeled.

### Task 9 — Backend channel-aware encode

**Files:** `apps/api/src/avalab_api/codecs.py`,
`apps/api/tests/test_codecs.py`.

1. Change:
   ```python
   def encode_audio(
       src: Path,
       dst: Path,
       codec: CodecName,
       params: dict[str, int],
       *,
       channels: int,
   ) -> None:
   ```
   - validate `channels in (1, 2)`, else `ApiError(invalid_request, 422)`;
   - replace the fixed `-ac 1` with `-ac str(channels)`;
   - keep the Vorbis native fallback’s `-ac 2` last, so it still wins for the
     experimental encoder; decoded path downmixes to the source count later.
2. Update the docstring: no longer “forced to mono”.
3. Tests:
   - mono: `-ac` is `1`;
   - stereo: `-ac` is `2`;
   - Vorbis fallback keeps `-ac 2` after the base args;
   - invalid channel count rejected.
4. Run `uv run --directory apps/api pytest -q tests/test_codecs.py`.

### Task 10 — Backend route preserves channels

**Files:** `apps/api/src/avalab_api/routes/codec.py`,
`apps/api/tests/audio_fixtures.py`, `apps/api/tests/test_codec.py`.

1. Read source metadata once:
   ```python
   def _read_source_info(storage: Storage, source_path: Path, audio_id: str) -> tuple[int, int]
   ```
   Return `(sample_rate_hz, channels)`; accept only integer 1–2 channels, else
   `not_found` (corrupt metadata behaves like an unknown id, matching the
   existing rate behavior).
2. Pass `channels=source_channels` to `encode_audio`.
3. Decode with `transcode_to_canonical_wav(..., channels=source_channels)`.
4. Refactor `_read_pair`:
   - read both WAVs without flattening;
   - reject channel-count mismatch or unexpected shape with `encode_failed`;
   - compute the mono downmix for alignment exactly as today;
   - quantize the reference mono to Int16 for alignment;
   - keep per-channel reference PCM in `(N, C)` form for bit-exactness.
5. Align once on mono. Slice every reference/decoded channel with the same
   `reference_start_sample` / `aligned_sample_count`.
6. `bit_exact = spec.lossless and np.array_equal(all reference channels,
   all decoded channels)`. Compute `source_duration_s` from the mono frame
   count (`reference_mono.size` / `reference.shape[0]`), never from
   `reference.size` on a 2-D array; otherwise the bitrate doubles for stereo.
7. Write the trimmed result with its real channel shape:
   - mono: `(N,)`;
   - stereo: `(N, 2)`;
   - dtype `float32`.
8. Store metadata `channels=source_channels`.
9. Add `channels: int` to `CodecEncodeResponse`; return `source_channels`.
10. Tests:
    - stereo FLAC: response `channels=2`, `bit_exact=true`, stored WAV has 2
      channels, both channels equal the reference slice;
    - stereo MP3: response `channels=2`, `bit_exact=false`, stored WAV has 2
      channels and finite samples;
    - mono FLAC regression: `channels=1`, `bit_exact=true`;
    - one-channel mismatch fixture returns `bit_exact=false` (test the helper
      directly if a real-lossless mismatch is hard to construct);
    - missing/corrupt channel metadata → `not_found`;
    - decoded channel mismatch → `encode_failed`.
11. Add `wav_2s_44k1_stereo` to `audio_fixtures.py`: two distinct tones
    (e.g. 440 Hz left, 660 Hz right), 44.1 kHz, 16-bit stereo, 2 s.
12. Run:
    ```bash
    uv run --directory apps/api pytest -q tests/test_codecs.py tests/test_codec.py
    uv run --directory apps/api ruff check .
    uv run --directory apps/api mypy .
    ```

### Task 11 — Regenerate API types

**Files:** `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts`.

1. Run `pnpm gen:api`.
2. Confirm `CodecEncodeResponse` includes `channels` in both files.
3. Do not hand-edit generated files.
4. Run `pnpm --filter @avalab/web typecheck` (it will fail until Task 12 adds
   the new field; that is the expected red step).

### Task 12 — Frontend real-codec channel path

**Files:** `apps/web/src/features/codecLab/backendCodecs.ts`,
`apps/web/src/features/codecLab/backendCodecs.test.ts`.

1. Import `AudioChannels`, `inputHash64Channels`, and
   `channelsFromDecoded`.
2. `RealCodecInput` gains:
   ```ts
   readonly channels?: AudioChannels;
   ```
   `samples` remains the slice used for mono metrics/reference.
3. `uploadForm`:
   ```ts
   const channels = input.channels ?? [input.samples];
   const wav = encodeWavPcm16(channels, { sampleRateHz });
   ```
   Validate channel lengths against `samples.length`; reject mismatches with
   `RangeError` before upload.
4. `inputHashFor`: use `inputHash64Channels(input.channels)` when present,
   else `inputHash64(input.samples)`. Keep the existing range/rate suffix in
   the upload cache key.
5. `runRealCodec`:
   - decode the result once into `DecodedAudio`;
   - `const decodedChannels = channelsFromDecoded(decoded)`;
   - `const decoded = monoDownmix(decoded)`;
   - require `decodedChannels.length === encoded.data.channels`;
   - require every channel length ≥ `aligned`;
   - trim every channel with `subarray(0, aligned)`;
   - keep `decoded`/`reference` mono for metrics and alignment checks (do not
     add a per-channel reference lane to the frontend contract; the backend
     owns `bit_exact`);
   - add `channels` to `RealCodecRun`;
   - add `channels: number` to `RealCodecStats` and map
     `encoded.data.channels`.
   - missing/extra channels or short lanes → `alignment_mismatch`.
6. Tests:
   - mono input still uploads one channel and produces mono `channels`;
   - stereo input uploads two channels (decode the multipart WAV bytes and
     assert 2 channels/interleaving);
   - right-channel-only change changes the upload cache key;
   - test client returns a stereo result; run exposes two trimmed channels and
     mono lanes;
   - missing/extra decoded channel → `alignment_mismatch`;
   - existing mono tests unchanged.
7. Run `pnpm --filter @avalab/web test -- backendCodecs.test.ts`.

### Task 13 — Codec lab single/batch channel pass-through

**Files:** `apps/web/src/features/codecLab/codecLabView.tsx`,
`apps/web/src/features/codecLab/codecLabView.test.tsx` (or nearest existing
view test), `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`.

1. Single run `runReal` input:
   ```ts
   channels: original.channels.map((channel) =>
     channel.subarray(runSettings.startSample, runSettings.endSample),
   ),
   ```
   Keep `samples` as `original.samples.subarray(...)`.
2. Batch `runReal` input: same mapping with `startSample` / `cappedEnd`.
3. `playRealResult`:
   ```ts
   setProcessed(
     realResult.run.channels.slice(),
     realResult.run.stats.sampleRateHz,
     "codecLab.real",
     {
       sourceStartSample:
         realResult.settings.startSample + realResult.run.stats.referenceStartSample,
     },
   );
   ```
   Do not pass `run.decoded` for a stereo result.
4. Add a real-result “Export WAV” button:
   - test id `codecLab.real.export`;
   - calls
     `downloadWav(realResult.run.channels, realResult.run.stats.sampleRateHz, \`avalab-${realResult.settings.realCodec}.wav\`)`;
   - disabled until a real result exists.
5. Labels:
   - real result panel shows `{{count}} ch` / Stereo when 2;
   - hand-written result panel shows “Mono toy codec”;
   - real metrics panel heading becomes “Mono analysis metrics” with a short
     note that channel differences are not measured per channel.
6. i18n keys (namespaced under `codecLab`):
   - `codecLab.real.channels` / `codecLab.real.stereo`;
   - `codecLab.real.export`;
   - `codecLab.toy.mono`;
   - `codecLab.metrics.monoAnalysis` + hint.
7. Tests:
   - play real result installs two channels (mock `setProcessed` and assert
     source identity/length), never `decoded`;
   - sourceStartSample includes codec `referenceStartSample`;
   - export calls `downloadWav` with channels;
   - hand-written play still installs mono.
8. Run:
   ```bash
   pnpm --filter @avalab/web test -- codecLab backendCodecs.test.ts
   pnpm i18n:check
   pnpm --filter @avalab/web typecheck
   ```

### Task 14 — Stereo codec e2e

**Files:** `apps/web/e2e/codec-lab.spec.ts`, `apps/web/e2e/player.spec.ts`.

1. Use the existing static `vite preview` harness and `page.route` stubs from
   `upload.spec.ts`; no live backend is needed.
2. Stub `/api/v1/health` with a codec list including `flac`.
3. Stub `/api/v1/ingest` to return an `audio_id`.
4. Stub `/api/v1/codec/encode` with `channels: 2` and a small valid stereo WAV
   result (generate bytes in the test with the DSP encoder or a tiny fixture).
5. Stub `/api/v1/audio/**` to return the stereo WAV bytes and the source WAV.
6. Test in fa and en:
   - load `input.demo.load.stereo`;
   - assert `player.channels` says 2 channels/Stereo;
   - run real FLAC;
   - assert the real panel shows stereo;
   - click play; assert `player.lane` is the processed lane;
   - click export; assert the download event filename;
   - no console errors.
7. Add one player test assertion for the stereo demo badge in both locales.
8. Run:
   ```bash
   pnpm --filter @avalab/web e2e -- --grep "stereo|codec"
   ```
   Then run the full `pnpm e2e` at the phase gate.

**Phase 2 gate:** `pnpm check`; `pnpm e2e`; backend pytest/ruff/mypy;
`pnpm gen:api` leaves no uncommitted drift; manual stereo FLAC A/B and export.

## Phase 3 — Labels, theory, docs, closeout

### Task 15 — Mono-result labels across tools

**Files:** tool result renderers that install processed lanes, plus
`apps/web/src/i18n/*.json`.

1. Add the “Mono result” label wherever a stereo source can produce a mono
   processed result:
   - sampling, extent, filters, speed, reverb, spectrum edit, AI tabs,
     codec lab toy codecs, pipeline.
2. Prefer one shared label component/key over per-view copy; if only the
   player and codec lab show it, keep the keys local (YAGNI).
3. Do not change DSP behavior or force stereo on mono tools.
4. Add the theory/help note:
   - en: “Analysis runs on a mono downmix for comparability. Playback and
     real codecs preserve stereo.”
   - fa: natural academic Persian, flagged for owner review.
5. Run `pnpm i18n:check` and `pnpm --filter @avalab/web test`.

### Task 16 — Documentation

**Files:** `docs/ALGORITHMS.md`, `docs/PROGRESS.md`,
`docs/DECISIONS.md`, `docs/THIRD_PARTY.md`,
`docs/plans/wave-7/README.md`,
`docs/superpowers/specs/2026-11-07-stereo-playback-and-real-codecs-design.md`,
`README.md` only if needed.

1. `docs/ALGORITHMS.md`:
   - canonical WAV: mono header unchanged; stereo interleave, block align 4,
     byte rate `4·fs`, data size `4N`;
   - mono downmix: mean of channels, used for analysis and codec alignment;
   - codec alignment: one lag from the mono downmix, applied to every channel;
   - bit-exactness: every channel must match.
2. `docs/DECISIONS.md` D-056: stereo playback + real codecs only;
   per-channel DSP, metrics, AI, toy codecs deferred.
3. `docs/THIRD_PARTY.md`: stereo clip provenance and CC0 statement.
4. `docs/plans/wave-7/README.md`: link plan/spec; mark item 1 implemented
   after the gate.
5. Spec header: replace “still needs owner review” with approval date and note
   the player-badge placement (no loaded-source input card exists).
6. `docs/PROGRESS.md`: phase status, files, tests, known limitations
   (mono toy codecs, mono metrics, no per-channel DSP), Persian review flag.

### Task 17 — Full gates and manual evidence

1. Frontend:
   ```bash
   pnpm install
   pnpm check
   pnpm e2e
   pnpm gen:api
   git diff --exit-code apps/api/openapi.json apps/web/src/api/schema.d.ts
   ```
2. Backend:
   ```bash
   uv run --directory apps/api pytest -q
   uv run --directory apps/api ruff check .
   uv run --directory apps/api mypy .
   ```
3. Demo generator:
   ```bash
   uv run --directory tools/demo_clips python generate.py
   uv run --directory tools/demo_clips python -m unittest test_generate.py
   uv run --directory tools/demo_clips python -m unittest test_f14_assets.py
   ```
4. Docker smoke (backend codec changed):
   ```bash
   bash docker/smoke.sh
   ```
5. Manual stereo check:
   - load the stereo demo;
   - play original, confirm left/right tones differ;
   - run stereo FLAC, play processed, A/B;
   - export WAV, inspect with `ffprobe` (`2 channels`, 16-bit);
   - run one mono tool, confirm “Mono result” and playback;
   - repeat in fa (RTL) and en (LTR) with no console errors.
6. Record exact command output and any skipped/failed test in
   `docs/PROGRESS.md`. Do not claim a pass without raw output.

## Implementation order and stop points

1. Phase 1 Tasks 1–8 → run the phase gate → owner review.
2. Phase 2 Tasks 9–14 → run the phase gate → owner review.
3. Phase 3 Tasks 15–17 → run the final gate → owner review.

If a gate fails, stop and fix before starting the next task. If a task needs
more than 2 files beyond its listed set, stop and ask the owner.

## Explicit non-goals

- Per-channel analysis, metrics, waveform, spectrogram, FFT, filters, reverb,
  speed, extent, sampling, or pipeline.
- Stereo hand-written codecs.
- Stereo AI.
- More than 2 channels.
- True-stereo convolution or stereo IR upload.
- Full-file stereo codec processing.
- A general audio-session persistence layer.
