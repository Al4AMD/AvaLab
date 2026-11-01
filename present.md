# AvaLab — Progress Presentation

> Status as of **2026-10-26**. Everything below is verified on `main` (PRs #1–#5) plus the open PR #6.
> The detailed, living log is `docs/PROGRESS.md`; this file is the owner-friendly digest.

---

## 1. What AvaLab is

A bilingual (Persian/English) web-based **audio laboratory** for Signals & Systems and Multimedia
courses: students load (or generate/record) audio, apply signal-processing and compression
algorithms, and **see and hear the effect live** — waveform, spectrogram, Fourier analysis,
sampling/quantization, lossless vs lossy coding, metrics, filters, reverb — every tool paired with
its theory (formulas + "what to observe").

Architecture in one line: **Python/FastAPI backend** (decode via ffmpeg, ML models) +
**React SPA** with a pure-TypeScript DSP library (`packages/dsp`) running in a **Web Worker**
(every interactive tool), all verified against **NumPy/SciPy golden vectors**.

---

## 2. Status at a glance

| Wave | Scope | Status |
|---|---|---|
| **Wave 0** — Foundation | Monorepo, backend + ingest API, web shell (i18n/RTL), Docker, golden pipeline | ✅ **Done & merged** (13/13 tasks) |
| **Wave 1** — DSP engine | Fourier, signals/metrics/quantization/resampling, convolution/filters, codecs, phase vocoder | ✅ **Done & merged** (4 plans, 24 tasks) |
| **Wave 2** — Core visuals | App skeleton ✅; audio sources + playback, waveform/spectrogram views, FFT view + generator queued | 🔄 **Plan 01 of 4 done** — **PR #6 open** |
| Wave 3+ | Filters UI, AI tools (HuggingFace), education layer, polish | planned |

**Numbers today**

| Metric | Value |
|---|---|
| DSP-library tests | **892 / 892 passing** (23 at wave 0 → 892 now) |
| Web-app unit tests | **90 / 90** |
| E2E (Playwright, offline) | **6 / 6** (fa RTL + en, zero console errors) |
| Golden-vector suite | **8 / 8** pytest suites, fixtures regenerate byte-identical |
| Root gate `pnpm check` | green (Biome lint, strict TS, i18n key parity checker) |
| Backend pytest | green (8/8 + ingest suite) |
| Deployment | `docker compose up` verified end-to-end (api + web/Caddy) |

---

## 3. Wave 0 — Foundation (done, 2026-10-19)

Built in 13 tasks: pnpm monorepo + Biome + strict TypeScript; **API skeleton** (`/health`,
`POST /ingest` validated with ffprobe — size/duration deadlines enforced *before* heavy work,
server-controlled TTL cleanup + explicit delete, HTTP-Range audio serving); **OpenAPI → TypeScript
client generation** (the API contract is never hand-written); **web shell** with Persian-first
RTL/LTR i18n, design tokens, Vazirmatn self-hosted, TTL privacy notice; i18n checker wired into
`pnpm check` (build fails on a missing/unused key in either language); Docker deployment; three
CC0 demo clips (self-generated).

---

## 4. Wave 1 — the DSP engine (done, merged)

All of it lives in `packages/dsp`: pure, deterministic, DOM-free TypeScript; every algorithm has a
math header, an `docs/ALGORITHMS.md` entry, and tests against independent NumPy/SciPy golden
vectors plus property tests (Parseval, FFT∘IFFT = identity, convolution theorem, bit-exact
round-trips).

**Plan 01 — Fourier (F08 core).** Naive DFT (the teaching O(N²) path), iterative radix-2
Cooley–Tukey FFT, Bluestein for arbitrary N, real-FFT optimization, windows (Hann, Hamming,
Blackman, Kaiser…) and STFT/ISTFT with COLA normalization. 229 tests.

**Plan 02 — Signals, metrics, quantization, resampling (F03/F05/F07/F12 core).** Signal
generators (sine…AM/FM) with seeded noise; Fourier-series reconstruction + Gibbs demo; signal
extent operations (shift/scale/reverse/truncate/zero-pad, energy/power classification); metrics
(MSE, SNR, segmental SNR, PSNR, compression ratio, bitrate, entropy); uniform quantization with
TPDF dither (1-bit is a proper mid-rise quantizer); rational resampling with a Kaiser-sinc
anti-alias path **and** a deliberate unfiltered mode for the aliasing demo; G.711 μ-law/A-law.
566 cumulative tests.

**Plan 03 — Convolution and filters (F10/F11 core).** Direct + FFT overlap-add convolution;
window-method FIR design (validated against SciPy at 2.5e-14); Butterworth/Chebyshev-I/RBJ
biquads; filter analysis — frequency/phase/group delay, impulse/step response, **pole-zero
stability analysis** with hard solver-envelope rejection (coefficients are never silently
clamped). 727 cumulative tests, four new goldens.

**Plan 04 — Codecs and time (F04/F06 core).** RLE, canonical Huffman (RFC 1951 construction +
length-limiting fallback), delta + Huffman (FLAC-style) lossless codecs with **bit-exact
round-trip tests**; the **MDCT toy lossy codec** (TDAC, psychoacoustics-ready, golden-verified,
SNR 22–32 dB at 48–128 kbps); phase-vocoder **time-stretch and pitch-shift** (identity error
≤ 1e-15, pitch checked on pure tones). Honest measured flag kept on record: the codec's
single-geometric-mean quantizer collapses tonal inputs — per-band scaling (the F13 psychoacoustics
rung) is the planned fix.

Also delivered in wave 1: the SDD execution pipeline itself (spec → task briefs → implementer →
independent reviewer → verifier → merge), which every later wave reuses.

---

## 5. Wave 2 — Core visuals (in progress)

Owner-approved design spec first (`docs/superpowers/specs/2026-10-25-wave-2-core-visuals-design.md`),
then 4 sequential plans. Key decisions recorded: **D-018** typed-message worker RPC (no Comlink),
backend-first audio lane with a full **offline fallback**; **D-019** per-tool routes with
URL-encoded parameters (instructor share-links).

**Plan 01 — app skeleton (done, open PR #6):**
- Data routes `/tools/{waveform, spectrogram, fftview, generator}` with the token-styled RTL/LTR
  shell and sidebar (dependency floor `react-router@8.5.0`, `zustand@5.0.16` — MIT).
- **Typed DSP worker + RPC protocol**: transfer-list (zero-copy) messaging, supersede/cancel of
  stale jobs, late-frame drop, lazy worker init; the *built* (not dev-server) worker is proven in
  e2e.
- **Session store**: immutable original audio, a derived-results cache keyed
  `op ‖ params ‖ inputHash` (FNV-1a-64 hash implemented and reference-verified in `packages/dsp`),
  sample guards (≤ 96 kHz, ≤ 300 s, NaN/Inf rejection).
- First DSP op live end-to-end: **`waveformOverview`** — exact min/max buckets computed in the
  worker, cache-safe.
- Independent verifier: all gates green, dependency delta exactly 2 packages, golden outputs
  byte-identical.

**Queued next:** Plan 02 audio sources + playback (backend ingest lane + offline fallback + demo
clips), Plan 03 waveform & spectrogram canvases (F02), Plan 04 FFT view + signal generator (F08/F12).

---

## 6. How quality is guaranteed (working practice, not aspiration)

1. **Golden vectors**: every non-trivial algorithm is checked against independent
   NumPy/SciPy/librosa references in `tools/golden`; fixtures regenerate **byte-identical** in CI.
2. **Property tests**: Parseval, transform round-trips, lossless bit-exactness, filter stability.
3. **Independent review**: every task is implemented and *separately* reviewed by an agent that
   re-derives the math and re-runs the gates; a verifier re-runs everything before merge.
4. **Sub-agent rules**: AGENTS.md forbids fabricated results — no "tests pass" without a run;
   the docs log every deviation as a numbered ruling.
5. **i18n gate**: fa/en key parity is enforced in `pnpm check`; Persian copy is drafted then
   explicitly queued for **your** review (below).

---

## 7. Open items for owner review

| Item | Where |
|---|---|
| Persian copy review (wave 0 + wave 2 strings, ~14 keys) | `docs/PROGRESS.md` → "Needs human Persian review" |
| MDCT toy codec tonal collapse — accept until F13 masking? | `docs/PROGRESS.md`, plan 4 R9 flag |
| Wave-2 carry-overs (cache-key extension for payload-dependent ops, worker job-pruning) | `docs/PROGRESS.md` wave 2 section |
| Merge PR #6 | https://github.com/Al4AMD/AvaLab/pull/6 |

## 8. Honest known limitations (on record, not hidden)

- Compression methods in the UI are still DSP-side only — the **real-codec lane (ffmpeg/ML)** and
  its comparison table land with wave 3.
- `huffmanDecode` transient over-allocation for skewed codebooks; whole-file phase-vocoder memory
  (≈ 0.9 GB for a 5-minute file) — the playback plan must excerpt before enabling full-file apply.
- Filter design guard costs 15–28 ms → designs will run in the Worker (debounced) once the UI lands.
- ML model work (F14) not started; the shortlist + license rules are pinned in `docs/MODELS.md` rules.

## 9. Next step

Merge PR #6, then **Wave 2 Plan 02** (audio sources + playback) — the first plan where a user can
actually load a demo clip and hear it.
