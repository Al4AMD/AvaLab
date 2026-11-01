# Wave 4 · Plan 03 — Real-codec UI and metrics lab (F04/F05)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The codec lab gains a real-codec panel that uploads the 16-bit PCM
excerpt through `/ingest`, calls `/codec/encode`, fetches and decodes the
aligned result, and shows size/bitrate/delay/bit-exactness. A new
`/tools/metrics` lab shows MSE, SNR, segmental SNR, PSNR, compression ratio,
bitrate, and entropy with the documented definitions, comparing the original
and processed lanes when they are comparable.

**Architecture:** `features/codecLab/backendCodecs.ts` owns the backend lane:
WAV excerpt → ingest → encode → fetch → decode. It caches the uploaded
`audio_id` by excerpt identity so a comparison batch uploads once. The
real-codec panel is part of the existing codec lab view. `features/metrics/`
owns a pure metrics wrapper over `@avalab/dsp` and a thin view over the
session store. No DSP on the main thread.

**Tech Stack:** As Wave 3. New deps: none.

**Spec:** `AGENTS.md` F04, F05, §7, §9, §10; `docs/DECISIONS.md` D-026–D-029.

## Global Constraints

- The backend lane uploads only the selected excerpt, never the whole file.
- Uploaded audio is a mono 16-bit PCM WAV built with `encodeWavPcm16`.
- The client never assumes the backend result length: it uses
  `aligned_sample_count` and `reference_start_sample` from the response.
- Metrics compare equal-length, equal-rate signals. If the lanes do not
  match, the view shows a translated mismatch hint; it never silently trims
  or resamples on the main thread.
- PSNR peak is `1.0`; segmental SNR frame is 20 ms. Both definitions are
  visible.
- All strings through i18n; fa machine-drafted + flagged.
- `pnpm check` + `pnpm e2e` green; both locales; zero console errors.

## Review Focus

1. **Upload identity** — the excerpt cache key includes the excerpt hash,
   sample range, and sample rate; two runs with the same excerpt reuse one
   `audio_id`, two different excerpts do not.
2. **Alignment is used** — the reference slice starts at
   `reference_start_sample` and is exactly `aligned_sample_count` long; the
   decoded result is trimmed by the backend. The metrics table never compares
   misaligned signals.
3. **Bit-exact honesty** — the badge comes from the backend response, not
   from a client-side guess; lossy codecs show `false`.
4. **Offline degradation** — with no backend, hand-written codecs still work;
   real-codec controls are disabled with the translated offline hint.
5. **Metric definitions** — MSE/SNR/segmental SNR/PSNR match `@avalab/dsp`
   formulas; PSNR uses peak 1.0; compression ratio/bitrate/entropy are shown
   only where the data exists.

---

### Task 1: Backend excerpt lane and cache

**Files:**
- Modify: `apps/web/src/features/input/ingest.ts` — export the default
  ingest client factory (`createDefaultIngestClient`) used by `ingestFile`.
- Create: `apps/web/src/features/codecLab/backendCodecs.ts`
- Create: `apps/web/src/features/codecLab/backendCodecs.test.ts`

**Interfaces:**
- `export type RealCodecName = "wav" | "flac" | "mp3" | "aac" | "opus" | "vorbis";`
- `export type RealCodecParams = { codec: RealCodecName; bitrateKbps?: number; quality?: number; compressionLevel?: number };`
- `export type RealCodecStats = { resultAudioId: string; sizeBytes: number; bitrateKbps: number; encodeMs: number; codecDelaySamples: number; referenceStartSample: number; alignedSampleCount: number; durationSeconds: number; sampleRateHz: number; bitExact: boolean; lossless: boolean; };`
- `export type RealCodecRun = { decoded: Float32Array; reference: Float32Array; stats: RealCodecStats };`
- `export type RealCodecInput = { samples: Float32Array; sampleRateHz: number; startSample: number; endSample: number };`
- `export type RealCodecClient` — narrow seam:
  - `POST("/ingest", { body: FormData, signal?: AbortSignal })`
  - `POST("/codec/encode", { body: CodecEncodeRequest, signal?: AbortSignal })`
  - `GET("/audio/{audio_id}", { params, parseAs: "arrayBuffer", signal?: AbortSignal })`
- `export async function runRealCodec(input, params, options?): Promise<RealCodecRun>`
  - `options`: `{ client?: RealCodecClient; decodeWav?: DecodeWav; signal?: AbortSignal }`.
  - Validate excerpt non-empty, `sampleRateHz` in `(0, 96000]`, start/end
    within `samples.length`.
  - `wav = encodeWavPcm16(input.samples, { sampleRateHz })`; upload as
    `new File([wav], "excerpt.wav", { type: "audio/wav" })`.
  - Cache: module-level `Map<string, Promise<string>>` keyed
    `${inputHashFnv1a64(input.samples)}:${startSample}:${endSample}:${sampleRateHz}`;
    cap 8 entries (delete oldest). Failed uploads are removed from the cache.
  - `POST /codec/encode` with body
    `{ audio_id, codec, params: { bitrate_kbps?, quality?, compression_level? } }`.
  - Fetch result WAV; `decodeWav(bytes)` then `monoDownmix`.
  - `reference = int16PcmToFloat(floatToInt16Pcm(input.samples))`
    sliced `[referenceStartSample, +alignedSampleCount)`.
  - `decoded = monoDownmix(decoded).subarray(0, alignedSampleCount)`; if
    length differs, throw `RealCodecError("alignment_mismatch")`.
  - Return `RealCodecRun`.
- `export class RealCodecError extends Error { kind: "backendCode" | "backendUnavailable" | "decodeFailed" | "alignment_mismatch"; code?: string; messageKey: string; }`
  - Map envelope codes `codec_unavailable`, `encode_failed`, `not_found`,
    `invalid_request`, `internal_error` to `codecLab.error.<code>`; unknown
    code → `codecLab.error.unknown` with the code kept.
  - Non-2xx without an envelope or fetch throw → `backendUnavailable`.
- `export function availableRealCodecs(health: HealthResponse | null): RealCodecName[]`
  — returns `health.codecs` filtered to the enum, preserving backend order.

- [ ] **Step 1: Write failing unit tests** with a fake client/decode seam:
  - Upload once for two runs with the same excerpt; different excerpt →
    second upload.
  - Response mapping: size/bitrate/delay/bitExact copied exactly.
  - Reference slice uses `referenceStartSample`/`alignedSampleCount`.
  - Decoded length mismatch → `alignment_mismatch`.
  - Envelope `codec_unavailable` → `backendCode` + message key.
  - Fetch throw → `backendUnavailable`.
  - `availableRealCodecs` filters unknown names.
- [ ] **Step 2: Run** `pnpm --filter @avalab/web test -- backendCodecs` — expected FAIL.
- [ ] **Step 3: Implement** the lane, export the default ingest client, and
  add the API types.
- [ ] **Step 4: Run** the test — expected PASS.
- [ ] **Step 5: Commit** `feat(F04): add backend codec lane`.

### Task 2: Real-codec panel

**Files:**
- Modify: `apps/web/src/features/codecLab/codecLabState.ts`
- Modify: `apps/web/src/features/codecLab/codecLabView.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`
- Modify: `apps/web/src/components/HealthStatus.tsx` only if a shared
  availability readout is needed; otherwise fetch health in the view.

**Interfaces:**
- State adds `realCodec`, `realBitrateKbps`, `realQuality`,
  `realCompressionLevel`, `realStatus`, `realResult`, `realErrorKey`.
- URL keys: `rc` (real codec), `rbr` (bitrate), `rq` (quality), `rcl`
  (compression level); validated and clamped.
- View adds a “Real codecs (ffmpeg)” card:
  - Fetch `GET /health` on mount (or read a store-cached health response);
    `availableRealCodecs`.
  - Select codec from available list; unavailable list is disabled.
  - Params: bitrate select (MP3/AAC/Opus: 32/64/96/128/192/256 kbps), quality
    select (Vorbis: 0..10), compression level select (FLAC: 0..12); WAV no
    params.
  - **Encode with ffmpeg** button; disabled when backend offline, unavailable
    codec, running, or empty excerpt.
  - Result card: size, bitrate, encode ms, codec delay samples, aligned
    samples, bit-exact badge, lossless badge; play decoded via
    `setProcessed(..., "codecLab.real")`.
  - Offline hint when `backendOnline === false`; never a spinner without an
    exit.
  - The hand-written result and real result are separate cards; the
    comparison table (Plan 04) consumes both.
- The real result also shows the same metrics table as the hand-written
  result, computed from `reference`/`decoded` with the shared metrics wrapper
  (Task 3).

- [ ] **Step 1: Write failing state tests** for real-codec URL round-trip,
  availability filtering, offline disable, and result replacement.
- [ ] **Step 2: Run** `pnpm --filter @avalab/web test -- codecLabState` — expected FAIL.
- [ ] **Step 3: Implement** the panel + i18n (`codecLab.real.*`,
  `codecLab.error.*`).
- [ ] **Step 4: Run** `pnpm check` — expected PASS.
- [ ] **Step 5: Commit** `feat(F04): add real codec panel`.

### Task 3: Metrics wrapper and `/tools/metrics`

**Files:**
- Create: `apps/web/src/features/metrics/{metrics.ts,metrics.test.ts,metricsView.tsx}`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/sidebar.tsx`,
  `apps/web/src/app/routes.test.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`
- Modify: `apps/web/src/features/codecLab/codecLabView.tsx`

**Interfaces:**
- `export const PSNR_PEAK = 1;`
- `export const SEGMENTAL_FRAME_SECONDS = 0.02;`
- `export type QualityMetrics = { mse: number; snrDb: number; segmentalSnrDb: number; psnrDb: number; sampleCount: number; };`
- `export type MetricsErrorCode = "empty" | "lengthMismatch" | "invalidRate";`
- `export class MetricsError extends Error { code: MetricsErrorCode; }`
- `export function computeQualityMetrics(reference: Float32Array, test: Float32Array, sampleRateHz: number): QualityMetrics`
  - Empty → `empty`; unequal lengths → `lengthMismatch`; non-positive rate →
    `invalidRate`.
  - `mse(reference, test)`, `snrDb`, `segmentalSnrDb` with
    `frameLengthSamples = max(1, round(0.02·sampleRateHz))`,
    `psnrDb({peak: PSNR_PEAK})`.
- `export function formatMetric(value: number, digits?: number): string`
  — `Infinity → "∞"`, `NaN → "—"`, otherwise fixed digits.
- `/tools/metrics` view:
  - Requires a source. Reads `original` and `processed` from the store.
  - No processed → translated hint.
  - Rate/length mismatch → translated hint (“run a same-length tool or use
    the codec lab”).
  - Equal → metrics cards (MSE, SNR, segmental SNR, PSNR, sample count) with
    PSNR definition note; “what to observe” bullets.
  - If the processed label starts with `codecLab`, show the codec lab note;
    compression ratio/bitrate/entropy stay in the codec lab because the
    processed store carries no codec metadata.
- Codec lab uses `computeQualityMetrics` for both hand-written and real
  results instead of duplicating metric calls; its meta already carries the
  same numbers, so the view can keep using meta for hand-written and compute
  for real.
- Route `/tools/metrics`; `TOOL_IDS` gains `"metrics"`; sidebar
  `nav.metrics`; route test updated.

- [ ] **Step 1: Write failing metrics tests** for known signals:
  - identical → `mse 0`, `snr ∞`, `psnr ∞`, segSNR ∞.
  - constant offset → expected MSE/SNR/PSNR.
  - unequal length/empty/bad rate → typed errors.
  - `formatMetric(Infinity) === "∞"`.
- [ ] **Step 2: Run** `pnpm --filter @avalab/web test -- metrics` — expected FAIL.
- [ ] **Step 3: Implement** wrapper + view + route/sidebar + i18n
  (`metrics.*`, `nav.metrics`, `tool.metrics.title`).
- [ ] **Step 4: Run** `pnpm check` — expected PASS.
- [ ] **Step 5: Commit** `feat(F05): add metrics lab and shared quality wrapper`.

### Task 4: E2E coverage

**Files:**
- Create: `apps/web/e2e/metrics.spec.ts`
- Modify: `apps/web/e2e/codec-lab.spec.ts`

- [ ] **Step 1: Write e2e**:
  - Codec lab: hand-written RLE result installs the processed lane; the real
    codec card is disabled with the offline hint (static preview has no
    backend); zero console errors.
  - Metrics: load demo → codec lab → RLE encode → play decoded → navigate to
    `/tools/metrics`; metrics cards visible with finite values (the codec lab
    reference is the 16-bit PCM grid, so even lossless RLE differs from the
    original float source by quantization error); PSNR note visible.
  - English locale: `html[dir=ltr]`; zero console errors.
- [ ] **Step 2: Run** `pnpm e2e -- metrics codec-lab` — expected PASS.
- [ ] **Step 3: Commit** `test(F05): metrics and real-codec degradation e2e`.

### Task 5: Close-out

**Files:**
- Modify: `docs/PROGRESS.md`, `docs/plans/wave-4/README.md`,
  `docs/ALGORITHMS.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Run** full `pnpm check` + `pnpm e2e`; record counts and fa
  review backlog.
- [ ] **Step 2: Update** plan status, decisions D-026–D-028, and the metrics
  definitions in `ALGORITHMS.md`.
- [ ] **Step 3: Commit** `docs(F05): close real codec UI and metrics plan`.

## Definition of Done

- Real codecs work when the backend is available and degrade honestly when
  it is not.
- Aligned metrics never compare misaligned signals.
- `/tools/metrics` works in both locales with zero console errors.
- `pnpm check` + `pnpm e2e` pass.
- `docs/ALGORITHMS.md` and `docs/PROGRESS.md` updated.

## Carries

- Metrics view cannot show compression ratio/bitrate/entropy for arbitrary
  processed lanes; the codec lab shows them.
- Real-codec e2e is limited to offline degradation in the static preview.
- Persian copy for `codecLab.real.*` and `metrics.*` needs owner review.
