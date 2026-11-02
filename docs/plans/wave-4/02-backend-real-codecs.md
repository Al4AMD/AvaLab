# Wave 4 · Plan 02 — Real codecs and delay alignment (F04 backend half)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** done (2026-11-02; commits `206dce9`..`4f5f133`).

**Goal:** `POST /api/v1/codec/encode` encodes a stored canonical excerpt with
ffmpeg (FLAC, WAV, MP3, AAC, Opus, Vorbis), decodes it back to canonical WAV,
measures codec delay by cross-correlation, trims the decoded result, verifies
bit-exactness for lossless codecs on the 16-bit PCM grid, stores the result
under a new `audio_id`, and returns size/bitrate/quality metadata. `GET
/health` lists available codecs so the UI can disable missing encoders.

**Architecture:** New `apps/api/src/avalab_api/codecs.py` owns codec specs,
capability probing, fixed ffmpeg argument arrays, and encode/decode. New
`alignment.py` owns normalized cross-correlation and trimming. New
`routes/codec.py` composes them with the existing `Storage` and
`ffmpeg.transcode_to_canonical_wav`. The API contract is exported to
`apps/api/openapi.json` and the generated TS client.

**Tech Stack:** Python 3.12, FastAPI, NumPy, SciPy, ffmpeg subprocesses.
New deps: `numpy`, `scipy` (AGENTS §3 approved).

**Spec:** `AGENTS.md` F04, §7, §9; `docs/DECISIONS.md` D-026, D-027, D-029.

## Global Constraints

- Uploads are untrusted. Every ffmpeg call uses a fixed argument array, no
  shell, captured output, and a timeout.
- The source is a canonical WAV already validated by `/ingest`. The codec
  route still validates `audio_id`, reads only `audio.wav` + `meta.json`,
  and never trusts client-supplied paths.
- Lossless codecs are forced to 16-bit PCM (`-sample_fmt s16` for FLAC,
  `pcm_s16le` for WAV). Bit-exact is evaluated after alignment on the
  decoded Float32 samples, which must equal the 16-bit reference exactly.
- Positive lag means the decoded signal is delayed. The backend trims the
  decoded result and returns `reference_start_sample`,
  `aligned_sample_count`, and `codec_delay_samples`.
- All temp files are removed on every path. A failed encode never leaves a
  stored result directory.
- No ffmpeg linking; subprocess only.
- No audio content or filenames in logs.

## Review Focus

1. **FLAC/WAV bit-exact** — 16-bit source → encode → decode → align must be
   sample-exact. A lossy codec must never claim `bit_exact: true`.
2. **Delay sign and trim** — synthetic tests pin positive lag = test delayed;
   the stored result and the returned reference slice are aligned to the same
   sample range.
3. **Availability honesty** — the capability probe reads `ffmpeg -encoders`;
   unavailable codecs return `codec_unavailable` and are absent from
   `/health.codecs`. Native experimental Vorbis falls back with `-strict -2`.
4. **Cleanup** — invalid codec, unavailable encoder, ffmpeg failure, missing
   audio, and storage failure all leave no temp file or result directory.
5. **Contract stability** — OpenAPI regenerated; generated TS client compiles;
   error codes are machine-readable.

---

### Task 1: Dependencies and codec specs

**Files:**
- Modify: `apps/api/pyproject.toml`, `apps/api/uv.lock`
- Create: `apps/api/src/avalab_api/codecs.py`
- Create: `apps/api/tests/test_codecs.py`
- Modify: `apps/api/src/avalab_api/errors.py`
- Modify: `docs/THIRD_PARTY.md`

**Interfaces:**
- Run `uv add numpy scipy` in `apps/api`; pin the resolved versions in
  `uv.lock`.
- `CodecName = Literal["wav", "flac", "mp3", "aac", "opus", "vorbis"]`.
- `@dataclass(frozen=True) CodecSpec`:
  - `name: CodecName`
  - `encoder: str` (e.g. `libmp3lame`)
  - `lossless: bool`
  - `extension: str`
  - `format: str` (`wav`, `flac`, `mp3`, `adts`, `ogg`)
  - `extra_args: tuple[str, ...]` (e.g. `("-strict", "-2")`)
  - `default_bitrate_kbps: int | None`
  - `default_quality: int | None`
  - `default_compression_level: int | None`
- `CODEC_SPECS: dict[CodecName, tuple[CodecSpec, ...]]` — preferred encoder
  first; Vorbis has `libvorbis` then native `vorbis`.
- `available_encoders() -> frozenset[str]` — parse
  `ffmpeg -hide_banner -encoders`; cache with `lru_cache(maxsize=1)`;
  return empty on missing ffmpeg or subprocess failure.
- `resolve_codec(codec: CodecName) -> CodecSpec` — first spec whose encoder
  is available; else `ApiError(ErrorCode.codec_unavailable, ..., 422)`.
- `available_codecs() -> list[CodecName]` — names with a resolvable spec.
- `validate_params(codec, params) -> dict[str, int]`:
  - WAV/FLAC: only `compression_level` (FLAC 0..12, default 5); WAV rejects
    all params.
  - MP3/AAC/Opus: only `bitrate_kbps` (8..512, defaults 128/128/64).
  - Vorbis: only `quality` (0..10, default 5).
  - Wrong field for the codec → `ApiError(ErrorCode.invalid_request, ..., 422)`.
- `encode_audio(src: Path, dst: Path, codec: CodecName, params: dict[str, int]) -> None`
  — fixed args, timeout 120 s, `check=True`, `capture_output=True`; failure
  → `ApiError(ErrorCode.encode_failed, ..., 422)`.
- Add `ErrorCode.codec_unavailable` and `ErrorCode.encode_failed` to
  `errors.py`.

- [ ] **Step 1: Write failing unit tests** for:
  - `available_encoders()` parses a captured sample `ffmpeg -encoders` output
    (monkeypatch subprocess); empty output → empty set.
  - `resolve_codec` prefers `libmp3lame`, falls back to native `vorbis` with
    `extra_args`, and raises `codec_unavailable` when nothing matches.
  - `available_codecs()` order is stable.
  - `validate_params` accepts/rejects each codec's allowed field and clamps
    bounds; wrong field → `invalid_request`.
- [ ] **Step 2: Run** `uv run --directory apps/api pytest -q tests/test_codecs.py`
  — expected FAIL.
- [ ] **Step 3: Implement** `codecs.py`, error codes, dependency add, and
  `THIRD_PARTY.md` rows for NumPy/SciPy.
- [ ] **Step 4: Run** the test — expected PASS; run `ruff` and `mypy`.
- [ ] **Step 5: Commit** `feat(F04): add ffmpeg codec specs and capability probe`.

### Task 2: Alignment module

**Files:**
- Create: `apps/api/src/avalab_api/alignment.py`
- Create: `apps/api/tests/test_alignment.py`
- Modify: `docs/ALGORITHMS.md`

**Interfaces:**
- `@dataclass(frozen=True) Alignment`:
  - `lag_samples: int` — positive means the test signal is delayed.
  - `reference_start_sample: int`
  - `test_start_sample: int`
  - `aligned_sample_count: int`
- `estimate_alignment(reference: np.ndarray, test: np.ndarray, *, sample_rate_hz: int, max_lag_samples: int = 8192, search_seconds: float = 10.0) -> Alignment`
  - Inputs must be 1-D finite float arrays with `len > 0`; else `ValueError`.
  - Use `min(len(reference), len(test), round(search_seconds·sample_rate_hz))`
    samples.
  - Remove each signal's mean.
  - `corr = scipy.signal.correlate(test_window, reference_window, mode="full", method="fft")`.
  - `lags = scipy.signal.correlation_lags(len(test_window), len(reference_window), mode="full")`.
  - Keep `|lag| <= max_lag_samples`.
  - Score `abs(corr) / sqrt(E_ref·E_test)`; pick the maximum; ties → smallest
    `|lag|`, then the negative lag.
  - If either energy is `< 1e-12`, return lag 0.
  - `lag = int(best_lag)`;
    `reference_start = max(0, -lag)`, `test_start = max(0, lag)`.
  - `aligned_count = min(len(reference)-reference_start, len(test)-test_start)`;
    if `<= 0`, `ValueError`.
- `align_pair(reference, test, alignment) -> tuple[np.ndarray, np.ndarray]`
  — return the two equal-length slices; never mutate inputs.

- [ ] **Step 1: Write failing tests** for:
  - test delayed by 37 samples → `lag_samples = 37`, slices equal.
  - reference delayed by 37 → `lag_samples = -37`.
  - noise + delay → exact lag (or within ±1 with a deterministic seeded
    signal; pin exact for the synthetic case).
  - both silent → lag 0, aligned count = min length.
  - unequal lengths → aligned count correct.
  - lag beyond `max_lag_samples` → no match beyond the search window (pin the
    returned lag at the window edge or 0; document).
  - non-finite/empty/2-D input → `ValueError`.
- [ ] **Step 2: Run** `uv run --directory apps/api pytest -q tests/test_alignment.py`
  — expected FAIL.
- [ ] **Step 3: Implement** `alignment.py`; add the `ALGORITHMS` entry with
  the formula, normalization, lag sign, and complexity.
- [ ] **Step 4: Run** the test — expected PASS; run `ruff` + `mypy`.
- [ ] **Step 5: Commit** `feat(F04): add codec delay alignment`.

### Task 3: `/codec/encode` route

**Files:**
- Create: `apps/api/src/avalab_api/routes/codec.py`
- Modify: `apps/api/src/avalab_api/main.py`
- Create: `apps/api/tests/test_codec.py`
- Modify: `apps/api/tests/test_health.py`

**Interfaces:**
- Pydantic:
  - `class CodecParams(BaseModel): bitrate_kbps: int | None = None; quality: int | None = None; compression_level: int | None = None`
  - `class CodecEncodeRequest(BaseModel): audio_id: str; codec: CodecName; params: CodecParams = Field(default_factory=CodecParams)`
  - `class CodecEncodeResponse(BaseModel)` with the exact fields:
    `result_audio_id: str`, `size_bytes: int`, `bitrate_kbps: float`,
    `encode_ms: float`, `codec_delay_samples: int`,
    `reference_start_sample: int`, `aligned_sample_count: int`,
    `duration_s: float`, `sample_rate_hz: int`, `bit_exact: bool`,
    `lossless: bool`.
- `POST /codec/encode`, responses documented with `ErrorResponse` for 400,
  404, 422, 500.
- Algorithm:
  1. `Storage(settings.storage_dir)`; validate `audio_id` via
     `storage.canonical_path` (raises 404). Read `meta.json`; missing/corrupt
     → 404 `not_found`.
  2. `spec = resolve_codec(request.codec)`; `params = validate_params(...)`.
  3. Create temp files `avalab_codec_encoded_*` and
     `avalab_codec_decoded_*`; `try/finally` unlink both.
  4. `encode_audio(source, encoded_path, codec, params)`; measure
     `encode_ms` around this call only.
  5. `transcode_to_canonical_wav(encoded_path, decoded_path, source_rate, 1)`;
     a decode failure on the encoded file maps to `encode_failed` (it is not
     an ingest failure).
  6. Read source reference and decoded with
     `scipy.io.wavfile.read` (float32). Downmix 2-D to mono by mean.
     Quantize the reference to the 16-bit PCM grid used by the encoder:
     `pcm16 = clip(round(reference * 32768), -32768, 32767)`;
     `reference = pcm16 / 32768`. This is the D-026 reference even when the
     stored canonical WAV came from an arbitrary float source.
  7. `alignment = estimate_alignment(reference, decoded, sample_rate_hz=source_rate)`;
     `reference_aligned, test_aligned = align_pair(...)`.
  8. `bit_exact = spec.lossless and np.array_equal(reference_aligned, test_aligned)`.
  9. Write `test_aligned` as float32 WAV to a temp file via
     `scipy.io.wavfile.write`; `result_audio_id = storage.new_audio_id()`;
     `storage.save_canonical(result_audio_id, trimmed_path, meta)`.
     Meta: `{audio_id, duration_s, sample_rate_hz, channels: 1,
     original_format: codec, created_at_unix}`.
  10. Response:
      - `size_bytes = encoded_path.stat().st_size`
      - `bitrate_kbps = size_bytes*8/(source_duration_s*1000)`
      - `duration_s = aligned_count/source_rate`
      - `codec_delay_samples = alignment.lag_samples`
      - `reference_start_sample = alignment.reference_start_sample`
      - `aligned_sample_count = alignment.aligned_sample_count`
  11. Any failure after `result_audio_id` exists: `storage.delete(result_audio_id)`.
- Add router to `main.py` (`api_router.include_router(codec_router)`).
- Tests:
  - Ingest a 2 s WAV; FLAC encode → 200; `lossless: true`,
    `bit_exact: true`, `codec_delay_samples` integer, `aligned_sample_count`
    close to 2 s·rate; fetch result WAV; read it; compare with reference
    slice exactly.
  - MP3 encode → 200; `lossless: false`, `bit_exact: false`,
    `size_bytes < original`, `bitrate_kbps > 0`, aligned count > 0.
  - Missing `audio_id` → 404 `not_found`.
  - Invalid codec → 422 `invalid_request`.
  - Unavailable codec (monkeypatch `available_codecs`/`resolve_codec`) →
    422 `codec_unavailable`.
  - Encode failure (monkeypatch `encode_audio` to raise) → 422
    `encode_failed`; storage and temp dirs empty.
  - Wrong params for codec → 422 `invalid_request`.
- Health test: `GET /health` includes `codecs` and each entry is in the
  codec enum; `ffmpeg` boolean still present.

- [ ] **Step 1: Write failing route tests** (use the existing ingest helper
  pattern; local `_ingest_wav` in `test_codec.py`).
- [ ] **Step 2: Run** `uv run --directory apps/api pytest -q tests/test_codec.py`
  — expected FAIL.
- [ ] **Step 3: Implement** the route and wire it.
- [ ] **Step 4: Run** the tests — expected PASS; `ruff` + `mypy`.
- [ ] **Step 5: Commit** `feat(F04): add real codec encode route`.

### Task 4: Health codecs and OpenAPI client

**Files:**
- Modify: `apps/api/src/avalab_api/main.py`
- Modify: `apps/api/openapi.json`
- Modify: `apps/web/src/api/schema.d.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/api/tests/test_health.py`

**Interfaces:**
- `HealthResponse` gains `codecs: list[str]`.
- `health()` returns `codecs=available_codecs()`.
- Export types in `apps/web/src/api/client.ts`:
  `CodecEncodeRequest`, `CodecEncodeResponse`, `CodecParams`, `CodecName`
  from `components["schemas"]`.
- Run `pnpm gen:api`; commit the generated files with the source change.
- Verify `pnpm --filter @avalab/web typecheck`.

- [ ] **Step 1: Update** `HealthResponse` and `health()`; extend the health
  test to assert `codecs` is a list of known names.
- [ ] **Step 2: Run** `uv run --directory apps/api pytest -q tests/test_health.py`
  — expected PASS.
- [ ] **Step 3: Run** `pnpm gen:api`; inspect the diff: `/codec/encode`,
  `CodecEncodeRequest`, `CodecEncodeResponse`, `HealthResponse.codecs`.
- [ ] **Step 4: Run** `pnpm --filter @avalab/web typecheck` — expected PASS.
- [ ] **Step 5: Commit** `feat(F04): expose codec health and regenerate api client`.

### Task 5: Close-out

**Files:**
- Modify: `docs/PROGRESS.md`, `docs/plans/wave-4/README.md`,
  `docs/ALGORITHMS.md`, `docs/DECISIONS.md`, `docs/THIRD_PARTY.md`

- [ ] **Step 1: Run** full backend gates:
  `uv run --directory apps/api pytest -q`,
  `uv run --directory apps/api ruff check .`,
  `uv run --directory apps/api mypy .`.
- [ ] **Step 2: Verify** local ffmpeg codec availability and record which
  encoders are present. If the Docker image lacks Vorbis, record it as a
  carry; the UI already degrades by `/health.codecs`.
- [ ] **Step 3: Update** plan status, decisions D-026/D-027/D-029, and
  `PROGRESS.md` with measured encode times and codec availability.
- [ ] **Step 4: Commit** `docs(F04): close real codec backend plan`.

## Definition of Done

- `/codec/encode` encodes and decodes all available codecs with fixed args.
- Lossless bit-exactness is verified after alignment; lossy is honest.
- `/health` exposes codec availability.
- OpenAPI + generated TS client updated.
- Backend pytest/ruff/mypy pass.
- Temp and storage cleanup tests pass.

## Carries

- Native experimental Vorbis may be the only Vorbis encoder in a minimal
  image; capability probe + `-strict -2` handles it.
- No perceptual metric (PESQ/ViSQOL) in this wave.
- Codec quality presets are coarse (bitrate for MP3/AAC/Opus, quality for
  Vorbis, compression level for FLAC).
