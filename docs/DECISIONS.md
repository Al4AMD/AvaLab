# DECISIONS.md — ADR log

> Every deviation from AGENTS.md and every owner decision from AGENTS.md §16 is recorded here.
> Format: ID, date, status, context, decision, consequences.

## D-001 — Open-source license: GPL-3.0

- Date: 2026-10-19
- Status: accepted (owner — `LICENSE` file exists in repo root)
- Context: AGENTS.md §16 Q0.
- Decision: **GPL-3.0**.
- Consequences: Copyleft. All bundled dependencies must be GPLv3-compatible (MIT/Apache-2.0/BSD are compatible; each recorded in `docs/THIRD_PARTY.md`). Do NOT bundle CC-BY-NC or other non-commercial model weights — they conflict with GPLv3's commercial-use freedom. ffmpeg stays a separate process, never linked (AGENTS.md §14).

## D-002 — Compute device policy: CPU floor, GPU optional

- Date: 2026-10-19
- Status: accepted (owner)
- Context: AGENTS.md §16 Q1. Owner's laptop has both GPU and CPU. Final hosting unknown (university).
- Decision: ML code is device-agnostic (`torch.device` autodetect). Everything MUST run CPU-only — that is the mandatory floor. GPU is an optional accelerator: docker compose gets an optional GPU profile; model selection must never require GPU.
- Consequences: Job ETA estimates must handle both devices. CI runs CPU-only.

## D-003 — Project deliverables: PDF report + slides

- Date: 2026-10-19
- Status: accepted (owner)
- Context: AGENTS.md §16 Q2.
- Decision: Final project deliverables to the instructor are a **PDF report** and **presentation slides**. In-app export (F16) remains the PDF/HTML lab report for students — separate concern.
- Consequences: M5 (Wave 6) includes report + slides production tasks. `docs/PROGRESS.md` and `docs/DECISIONS.md` double as report source material; keep them precise.

## D-004 — Guided experiments: comprehensive coverage

- Date: 2026-10-19
- Status: accepted (owner — "everything professional")
- Context: AGENTS.md §16 Q3.
- Decision: Every P0/P1 tool ships 5–8 guided experiments with expected observations. Agents draft fa+en; owner reviews Persian.
- Consequences: F16 content is a continuous track, not a single task. Persian drafts flagged in `docs/PROGRESS.md`.

## D-005 — Perceptual metric: deferred; fallback chosen

- Date: 2026-10-19
- Status: accepted (agent decision, delegated by owner — "if necessary")
- Context: AGENTS.md §16 Q4.
- Decision: Not needed for MVP. The rate–distortion plot uses already-implemented SNR/MSE. If a perceptual axis is later wanted: single candidate **`pystoi` (MIT, pure Python, speech-only)**. Do NOT add PESQ (ITU reference implementation license is restrictive).
- Consequences: F05 perceptual item stays optional (P2). Revisit in M5.

## D-006 — WebAssembly DSP: benchmark-gated

- Date: 2026-10-19
- Status: accepted (owner — "if necessary")
- Context: AGENTS.md §16 Q5.
- Decision: Keep the escape hatch only. Optimize TypeScript first (typed arrays, precomputed twiddles, in-place). WASM is added ONLY after a recorded benchmark shows the §9 budgets are missed.
- Consequences: No WASM in Wave 1. Benchmarks run when a budget fails or during M5.

## D-007 — Range serving semantics deviate from the Task 8 brief wording

- Date: 2026-10-19
- Status: accepted (agent, empirically verified against installed starlette 1.9.0; revised in Task 8 fix rounds 1–3)
- Context: Task 8 brief expected malformed ranges (`bytes=50-10`, `bytes=abc`) → 416 `range_not_satisfiable`, and multi-range → "first range only". Empirical testing of `FileResponse` showed: malformed/inverted → plain-text 400 raised inside the send phase (bypasses FastAPI exception handlers); multi-range → RFC 9110 `multipart/byteranges` (206, all ranges); unsatisfiable → correct 416 + `Content-Range: bytes */<size>` but as a bare text response with no API error envelope.
- Decision: the route pre-validates every Range header; all rejections are API envelopes. Accepted grammar: a single `bytes=(\d*)-(\d*)` spec with at least one non-empty group, or a comma-joined list of such specs (no whitespace inside the list). Malformed headers (`bytes=abc`, `bytes=`, trailing/empty comma parts, spaced multi-ranges, `bytes=0-9,abc`, wrong unit) → **400 envelope `invalid_request`** (was starlette's plain-text 400). OWS around the commas of a multi-range header (e.g. `bytes=0-9, 20-29`) is likewise rejected 400: RFC 9110 tolerates the optional whitespace, this route intentionally does not (documented strictness). Any spec with a digit run longer than 18 characters → **400 envelope `invalid_request`**, checked before every `int()`; this keeps CPython's 4300-digit conversion limit unreachable from both the route (uncaught `ValueError` → 500) and starlette's parser (`ValueError`-skipped parts → empty ranges → plain-text 400). Inverted single ranges (`end < start`, checked before `start >= size` so the answer is file-size independent) → **416 envelope `range_not_satisfiable`** + `Content-Range: bytes */<size>` (was starlette's plain-text 400). Grammar-valid sets with any non-servable part (start >= size, zero-valued suffix — compared numerically so any zero-padding matches, any range on a zero-byte file) → 416 envelope + header; more than `FileResponse.max_ranges` parts → 400 envelope. Valid single ranges → 206; valid multi-ranges → RFC 9110 `multipart/byteranges` (not "first range only") — both delegated to `FileResponse`.
- Consequences: `GET /audio/{id}` error bodies are always envelopes; no plain-text error path remains for this endpoint (grammar, digit-length cap, unsatisfiable parts and excessive part counts are all rejected route-side before starlette; re-verified in fix round 3 across suffix forms with zero-padding, single ranges, multi-ranges and the digit-cap boundaries). `stat()` failures of any kind (`OSError`) answer the 404 envelope. Tests pin the grammar, statuses and headers so a starlette upgrade cannot silently change semantics.

## D-008 — One shared OpenAPI prefix strip: served spec == exported spec

- Date: 2026-10-19
- Status: accepted (agent, Task 9 fix round 1)
- Context: The app declares `servers: [{"url": "/api/v1"}]` but FastAPI served `/openapi.json` with fully prefixed path keys (`/api/v1/health`). Servers-aware consumers (e.g. Swagger UI "Try it out") combined them into `/api/v1/api/v1/health` → 404, and the served spec diverged from the committed `apps/api/openapi.json`, which the exporter stripped.
- Decision: A single shared helper `avalab_api.openapi_utils.server_relative_schema()` rewrites path keys relative to the server URL. Both `create_app()` (via an `app.openapi()` override) and `export_openapi.py` apply it, so served spec equals the committed artifact by construction. The strip is guarded: `path == "/api/v1"` becomes `/`, only `path.startswith("/api/v1/")` is stripped, anything else (e.g. a future `/api/v12/foo`) is left untouched — never a bare `str.removeprefix`. The TypeScript client base URL default stays `/api/v1`.
- Consequences: Any consumer that ignores `servers` must prepend `/api/v1`; `apps/web/src/api/client.ts` does this via its default base URL. An API test pins served path keys == exporter keys, `/health` present, `/api/v1/health` absent.

## D-009 — Two TypeScript majors (web ^5.9, dsp ^7.0.2) for Wave 1

- Date: 2026-10-19
- Status: accepted (agent, Task 9 report concern)
- Context: `apps/web` needs `typescript@^5.9` because `openapi-typescript@7.13.0` requires the JavaScript compiler API (`ts.factory`), which the TS 7 native compiler does not expose. `packages/dsp` is on `typescript@^7.0.2`. pnpm resolves per-package, so both lines coexist today.
- Decision: Keep the split for Wave 1: web pins TS ^5.9, dsp stays on ^7.0.2.
- Mitigation: keep `packages/dsp` syntax TS 5.9-compatible until the web app imports dsp source; if web starts importing dsp source before the exit condition, add a web-side dsp-import typecheck smoke.
- Exit condition: `openapi-typescript` gains TS 7 support, or the owner decides a single TS line.

## D-010 — Biome (lint + format) instead of ESLint + Prettier

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 2)
- Context: AGENTS.md §3 offers ESLint + Prettier or Biome but demands picking one at M0 and never mixing.
- Decision: **Biome** (`@biomejs/biome` 2.5.15) is the single JS/TS linter + formatter; `pnpm lint` = `biome check .`, `pnpm format` = `biome format --write .`.
- Consequences: One config (`biome.json`), one binary, no plugin ecosystem; if a rule Biome cannot express is ever required, record it here and ask the owner before adding a second tool.

## D-011 — OpenAPI client: `openapi-typescript` (types) + `openapi-fetch` (runtime)

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 9)
- Context: AGENTS.md §3 requires the TypeScript API client to be generated from OpenAPI, never hand-written.
- Decision: `scripts/gen-api.mjs` runs `openapi-typescript` over `apps/api/openapi.json` → `apps/web/src/api/schema.d.ts`; runtime calls use `openapi-fetch` with base URL default `/api/v1` (spec `servers` are stripped relative, see D-008).
- Consequences: Both packages are MIT (GPL-3.0-compatible). `openapi-typescript` requires the TS JavaScript compiler API, which forced the two-TS-majors split (D-009).

## D-012 — Caddy for the web container (static files + `/api` reverse proxy)

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 12)
- Context: AGENTS.md §3 says "static build behind nginx/caddy" for deployment.
- Decision: **Caddy** (`caddy:2-alpine`, Apache-2.0) serves `apps/web/dist` and proxies `/api/*` to the `api` service, path-preserving, so no CORS in the deployed stack.
- Consequences: One container, one config (`docker/Caddyfile`); host port 8080 by default. nginx is not used anywhere. TLS termination is out of scope until the hosting target is decided (AGENTS.md §16 Q1): the compose stack serves plain HTTP, and the eventual host/reverse proxy terminates TLS.

## D-013 — Persian font: self-hosted Vazirmatn v33.003 (OFL-1.1)

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 10)
- Context: AGENTS.md §6 requires a Persian-capable, open-license font, self-hosted, not from a CDN.
- Decision: **Vazirmatn v33.003** woff2 (regular 400 / medium 500 / semibold 600 / bold 700) vendored under `apps/web/public/fonts/` with its `OFL.txt`. OFL-1.1 is GPL-3.0-compatible for bundling (font files are not relicensed).
- Consequences: No runtime font fetch; provenance recorded in `docs/THIRD_PARTY.md`.

## D-014 — Project SDD agents committed under `.opencode/agents/`

- Date: 2026-10-19
- Status: accepted (controller, Wave 0 Task 1; fallback exercised per ledger R3)
- Context: The subagent-driven-development workflow needs `implementer` / `verifier` / `debugger` agents; the briefs are project artifacts meant to be public with the repo.
- Decision: The three agent definitions live in `.opencode/agents/` and are committed. In the Wave 0 session they were not hot-loaded, so dispatches used the built-in `general` subagent with the same briefs as fallback (no material cost).
- Consequences: Future opencode sessions load the project agents; edits to them are normal reviewed commits.

## D-015 — React Router deferred to Wave 2

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 10)
- Context: AGENTS.md §3 lists React Router; AGENTS.md Wave 0 "out of scope" excludes routes.
- Decision: The Wave 0 shell is a single view without a router; routing (and URL-serialized tool state, §10) arrives with the first tool views in Wave 2.
- Consequences: No router dependency in `package.json` yet; adding it is a Wave 2 decision with the URL-state design.

## D-016 — Bundled demo audio: self-generated, CC0 dedication

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 13)
- Context: AGENTS.md F01 requires bundled demo clips; AGENTS.md §14 forbids copyrighted music and requires recorded provenance.
- Decision: The three demo clips (`apps/web/public/demo/*.wav`) are generated by `tools/demo_clips/generate.py` (fixed seeds/params, byte-reproducible) and dedicated to the public domain under **CC0-1.0 by the project** as part of the GPL-3.0 repository — no third-party audio is committed.
- Consequences: Regeneration is a one-liner; determinism is verified by double-run hash comparison; provenance noted in `docs/THIRD_PARTY.md`.

## D-017 — Filter design and analysis rulings (Wave 1 Plan 03)

- Date: 2026-10-24
- Status: accepted (controller)
- Context: Wave 1 Plan 03 realizes IIR filters as a single b/a pair, where double-precision roots at realized order 16 are ill-conditioned; repeated zeros at z = −1 make root-to-root golden comparison unreliable; and group delay needs a formula the golden generator can reproduce exactly.
- Decision:
  - Even-tap FIR highpass/bandstop designs throw `RangeError`, mirroring SciPy `firwin`'s Type II restriction.
  - Group delay is the central finite difference of the unwrapped `freqz` phase on the inclusive grid (one-sided at the endpoints); the golden generator applies the identical formula.
  - b/a IIR designs must pass the solver envelope `max|p| ≤ 0.995` and a 48000-sample impulse-decay behavioral guard; non-finite, silent, or non-decaying responses throw `RangeError`; coefficients are never clamped.
  - Repeated zeros at z = −1 are verified by residual, root count, and cluster checks rather than root-to-root matching.
- Consequences: Narrow/high-order lowpass/highpass and most order-8 bandpass/bandstop designs are conservatively rejected; filter design must run in a Worker per AGENTS §9, with the UI trigger debounced if needed; a second-order-sections or state-space realization is the future fix; `docs/ALGORITHMS.md` is authoritative for the exact formulas and tolerances.

## D-018 — Typed message DSP worker (no Comlink) + audio decode lanes

- Date: 2026-10-25
- Status: accepted (owner, Wave 2 brainstorm)
- Context: AGENTS §3 allows "Comlink or typed message protocol"; Wave 2 needs repeatable worker semantics (cancel, transfers, cache) and §9 offline resilience.
- Decision: Hand-rolled typed message protocol (~50-line RPC) around one long-lived module worker whose ops are a pure op table over `@avalab/dsp`; no Comlink dependency. Audio decode is backend-first (`POST /ingest` → canonical WAV; limits are the backend's truth), with an offline fallback lane (`decodeAudioData` + bundled demo clips) when the API is unreachable.
- Consequences: One fewer dependency, testable RPC via `MessageChannel` in Vitest, all typed-array worker results transfer-not-copy; browser codec variance is confined to the explicitly-labeled offline lane.

## D-019 — URL state scheme for tool parameters

- Date: 2026-10-25
- Status: accepted (owner, Wave 2 brainstorm)
- Context: AGENTS §3/F16 require tool state serializable to the URL for shareable ready-made experiments (F16), routing deferred by D-015 to Wave 2.
- Decision: `react-router` data routes at `/tools/<tool>?<params>`; every tool ships `paramsToSearch`/`searchToParams` codecs with canonical key ordering; controls write the URL via debounced `history.replaceState` (parameter state is primary in React, URL follows). User audio never enters the URL.
- Consequences: F16 share-by-URL lands from day one per tool; params live as single-string source of truth to avoid history thrash on sliders.

## D-020 — Spectrogram tiles: per-chunk op + amplitude-referenced dB

- Date: 2026-11-01
- Status: accepted (agent, Wave 2 Plan 03; owner may review)
- Context: Plan 03 Task 3 assumed one `spectrogram` op returning a full row-major dB map. The owner's branch shipped `spectrogramTiles` (bounded frame chunk per call) so the store's `deriveWithSourceSlice` lane transfers only the needed source slice and the canvas paints progressively; the plan's single-payload contract and the old branch's streaming deviation (D-020 on `feat/wave-2-plan-03`) no longer apply.
- Decision: keep the per-chunk op. Column decimation is explicit via `frameStride` (analysis hop multiplied by the stride, capped at 8192 frames / 4M cells); the view prints the factor. The op reports **coherent-gain-removed one-sided amplitude in dB** (`20·log10(|X| / Σw)`, +6.02 dB for a full-scale sinusoid bin): 0 dB = full-scale sinusoid for every window family, instead of the plan-literal `20·log10(|X|/1)` raw FFT magnitude (which made a full-scale tone read ≈ 42 dB at 1024 points and changed with window length).
- Consequences: dB values are window-independent and physically interpretable; the UI floor is a display clamp only (worker clamps at −120 dB) so moving the slider never re-runs the STFT; tests pin 0 dB full-scale and −6.02 dB half-scale. Raw-magnitude comparisons against a textbook FFT need the gain back (documented in the op header).

## D-021 — Fourier view: 65 536-sample analysis cap + source-free op lane

- Date: 2026-11-01
- Status: accepted (agent, Wave 2 Plan 04; owner may review)
- Context: F08 asks for the DFT of "the selected segment or whole file", but a whole 5-minute 48 kHz file is 14.4M samples; a single frame that large is unreadable, slow, and its 7.2M bins cannot be drawn. Separately, the F12 generator must preview and load a signal before any source exists, while R23 keeps the store the sole view-tree RPC caller and every existing derive lane is source-bound.
- Decision: (1) `fftSelection` analyses the first `min(selectionLength, 65 536)` samples (`F = nextPow2(...)`), returns `meta.capped`, and the view prints the cap notice; the cache key pins the FULL selection range while only the capped prefix is transferred. (2) The store gains `deriveStandalone(op, params)`: same worker lane and typed outcomes, no source, no cache entry, `key = ""` (nothing to cancel/poll); the generator preview guards staleness with a generation counter and debounces slider ticks by 120 ms.
- Consequences: the Fourier view is O(F log F) with F ≤ 65 536 (fast enough for live window changes) and never transfers a whole file; the honest cap notice replaces silent truncation. The generator works offline and before any load; its preview re-synthesizes per param change (cheap for the capped demo durations, debounced for the 300 s end). Both deviations are documented in the ops headers and the ALGORITHMS table.

## D-022 — Processed playback lane, A/B continuity, and F06 speed semantics

- Date: 2026-11-01
- Status: accepted (agent, Wave 3 Plan 01; owner may review)
- Context: the session store keeps the original buffer immutable, while every Wave 3 tool produces a full audio result that must be playable. The derived cache is keyed by `(op, params, inputHash)` and owned by the store for view reads; it is the wrong place for a playback buffer with explicit lifetime and a 300 s cap. F06 also needs one pinned reading of "speed": 2× must mean faster, not a longer buffer.
- Decision: (1) the store owns a single `processed` lane (`samples`, `sampleRateHz`, `label`) beside `original`; `setProcessed` takes ownership without copying and rejects empty, non-finite, rate > 96 kHz, or duration > 300 s with a typed code — never truncates. `playbackMode` selects the lane and falls back to original when the lane is absent; `loadSource` clears both. (2) A/B switching maps the playhead by **seconds** (`mapPlayheadSeconds`, clamped to the target length), captures whether playback was running, seeks, and resumes; two live nodes are never left behind. (3) `transport.ts` keeps rate 1; its `playbackRate` hook remains the pinned future seam, unused. (4) `speedTransform` semantics: `speedFactor > 1` is faster; resample mode returns a buffer declared at the source rate (speed and pitch move together), time-stretch mode uses `stretchFactor = 1/speedFactor` (speed only), optional `pitchShift` preserves duration, and `reverse` applies last. `actualSpeedFactor` reports the realized rate ratio; `meta.sampleRateHz` is always the source rate.
- Consequences: every Wave 3 tool hands the store one owned buffer and the dock can A/B it without restarting; the cap is visible (`tooLong`/cap notice) instead of silent; the processed lane is not cached or evicted — tools recompute it. The plan's Task 2 line "time-stretch 2× yields ~96 000 samples" was inverted and is recorded as a ruling: the shipped test pins ~24 000 samples with pitch preserved. A non-integer resample rate can still reach `resampleRational` and surface as `opFailed` rather than `badParams` (latent caveat, not hit by the view's integer presets).


## D-023 — F03 sampling lab semantics

- Date: 2026-11-01
- Status: accepted (agent, Wave 3 Plan 02; owner may review)
- Context: the F03 lab resamples and quantizes in one worker op. When the target rate differs from the source, there are two error sources (resampling and quantization), and a single SNR readout would mix them. The aliasing demo must also work before any file exists, like the F12 generator preview.
- Decision: (1) `samplingProcess` resamples first and measures every metric (`MSE`, `SNR`, segmental SNR, PSNR) against the **resampled reference**, so the readout describes quantization alone. (2) PSNR uses `peak = 1.0` and the view prints that definition; `theorySnrDb = 6.02·bits + 1.76` is shown only with its full-scale-sine, no-dither label. (3) The error/residual signal is `resampled reference − quantized`; the view reconstructs the reference as `quantized + error` for its before/after waveform pair. (4) The aliasing card is source-free through `deriveStandalone("aliasDemo", …)` and reports both the ideal predicted fold (`aliasFrequencyHz`) and the measured dominant FFT bin.
- Consequences: students can separate quantization quality from resampling quality; when the rate changes, the SNR is not the file-vs-result error (the residual button plays only the quantization difference). The view exposes `bits` 1..16 while the dsp quantizer contract stays 1..24; the card plays its result only after a source exists, because the processed lane feeds the shared dock.

## D-024 — F10 reverb IR level and upload rulings

- Date: 2026-11-01
- Status: accepted (agent, Wave 3 Plan 04; owner may review)
- Context: synthetic IRs combine an exponential decay, early reflections and (for the telephone preset) band-limiting filters, any of which can change the impulse response energy and therefore the wet level. Uploaded IRs arrive at arbitrary sample rates and lengths, and normalizing them would silently change the user's intended reverb character.
- Decision: (1) `generateSyntheticIr` always normalizes energy to `sum(h²) = 1`, so the same preset and seed keep a stable level and changing the seed changes only the noise detail. (2) Uploaded IRs are capped at 10 s mono finite, decoded through the existing browser WAV seam, and resampled to the source rate with `resampleRational` (kaiserSinc) inside `reverbProcess`; their energy is **not** normalized. (3) The output keeps the full convolution tail `preDelay + N + M − 1`; direct convolution is limited to 2 s source excerpts; output above the 300 s processed cap rejects with `tooLong` before the final allocation.
- Consequences: preset A/B comparisons are level-stable; uploaded-IR level depends on the file, which is the honest behaviour for a user-supplied IR. The resample cost is paid once per `reverbProcess` call, and the op re-checks the post-resample output length so a high-rate IR cannot bypass the cap.

## D-025 — F09 spectrum editor: rectangular frame and real-part fallback

- Date: 2026-11-01
- Status: accepted (agent, Wave 3 Plan 05; owner may review)
- Context: F09 lets a student edit Re, Im, magnitude or phase of DFT bins. An analysis window would smear a single bin into its neighbours and make “zero bin k” ambiguous; on the other hand, dropping Hermitian symmetry produces a complex IFFT result, while the playback lane only accepts real audio.
- Decision: (1) `editSpectrum` analyses a rectangular-window frame zero-padded to `L = fftLengthSamples ?? nextPow2(N)`; no post-IFFT window compensation. (2) Hermitian ON mirrors `X[L−k] = conj X[k]` and zeroes the DC/Nyquist imaginary parts, so the result is exactly real. (3) Hermitian OFF is a labelled teaching mode: `editSpectrum` computes the complex IFFT, reports `imaginaryEnergyRatio = Σ(Im x)² / Σ(Re x)²`, returns the real part, and the view warns that only that part is played. (4) Edits stay band-based (Hz→bins via the op's `frequencyResolutionHz`); freehand brush drawing remains deferred, and the selection cap follows D-021.
- Consequences: bin edits mean what the UI says, and presets (`zeroIm`, `zeroRe`, `zeroPhase`, `linearPhase`, `randomPhase`, `magnitudeOnly`, `phaseOnly`) are exact in the bin domain; brick-wall band masks ring (Gibbs), which the UI labels as expected. OFF is not a real-signal construction and must never be presented as one; its ratio quantifies exactly how much information the playable real part discards.

## D-026 — Real-codec input uses `/ingest` with a 16-bit PCM excerpt

- Date: 2026-11-02
- Status: accepted (owner, Wave 4 brainstorm)
- Context: F04 needs real MP3/AAC/Opus/Vorbis/FLAC encodes while the browser already owns a decoded source buffer. Sending raw browser buffers would duplicate the validated ingest path and its limits.
- Decision: The client sends a mono **16-bit PCM WAV excerpt** through the existing `POST /ingest`; the returned `audio_id` is the codec route input. “Bit-exact” for lossless codecs means the decoded samples equal that 16-bit PCM grid reference exactly.
- Consequences: codec rights reuse the ingest validation, TTL, and storage model; arbitrary float sources are compared on the quantized grid, which the UI states. The backend never accepts client-supplied paths.

## D-027 — Codec delay is measured by normalized cross-correlation and trimmed

- Date: 2026-11-02
- Status: accepted (agent, Wave 4 Plan 02)
- Context: real codecs add encoder delay/padding; comparing unaligned signals would corrupt bit-exactness and quality metrics.
- Decision: `estimate_alignment` removes the mean of the first `min(length, 10 s)` samples, computes `scipy.signal.correlate(test, reference, mode="full", method="fft")`, and scores `|corr| / sqrt(E_ref·E_test)` over `|lag| ≤ 8192`. Ties prefer the smaller `|lag|`, then the negative lag. A positive lag means the decoded signal is delayed. The route trims both signals to the common range and returns `codec_delay_samples`, `reference_start_sample`, and `aligned_sample_count`.
- Consequences: metrics and stored output are compared on the same sample range; delays longer than the search window are not recoverable and the best in-window overlap is reported honestly. Silent inputs yield lag 0; invalid or non-overlapping arrays raise `ValueError`.

## D-028 — F05 metric definitions

- Date: 2026-11-02
- Status: accepted (agent, Wave 4 Plan 01; owner may review)
- Context: PSNR and segmental SNR are ambiguous unless the peak and frame length are pinned, and codec comparisons must use one convention.
- Decision: PSNR uses peak `1.0` (float full scale). Segmental SNR uses 20 ms frames. Both definitions appear in the UI and `docs/ALGORITHMS.md`; codec metrics compare the decoded result with the aligned 16-bit PCM reference.
- Consequences: results are directly comparable across the hand-written and real-codec labs; a different peak convention would shift PSNR by a constant dB offset. Plan 03 centralizes the convention in `computeQualityMetrics`, which rejects unequal lengths or a bad rate before calling the DSP metrics.

## D-029 — Codec availability is exposed through `GET /health.codecs`

- Date: 2026-11-02
- Status: accepted (agent, Wave 4 Plan 02)
- Context: a deployment image may lack an encoder; offering a control that always fails is worse than disabling it.
- Decision: `available_codecs()` parses `ffmpeg -hide_banner -encoders` and `GET /health` returns the available public names as `codecs`. `resolve_codec` raises `codec_unavailable` when no preferred encoder is present. Native experimental Vorbis is used with `-strict -2`; because it rejects mono, the encoder spec duplicates to stereo and the decode path downmixes back to mono.
- Consequences: the UI can disable unavailable codecs before the user tries them; a probed encoder may still fail for an unsupported input, which maps to `encode_failed` rather than a silent fallback.

## D-030 — F06 is verification-only in Wave 4

- Date: 2026-11-02
- Status: accepted (owner, Wave 4 brainstorm)
- Context: Wave 3 already shipped the processed lane, resample speed, time-stretch, pitch shift, and reverse; F06 remains in the Wave 4 milestone.
- Decision: Wave 4 verifies F06 with existing unit/e2e coverage and marks it done; no new F06 feature work is added.
- Consequences: Wave 4 scope stays focused on F04/F05; any F06 defect found during verification is fixed as a bug, not expanded into a redesign. Verified 2026-11-02: e2e asserts resample and time-stretch both halve the duration at 2×, semitones are disabled only in resample mode, and +12 semitones at 1× time-stretch preserves the duration in both locales.

## D-031 — Comparison batch: 30 s excerpt, sequential, cancellable

- Date: 2026-11-02
- Status: accepted (owner, Wave 4 brainstorm)
- Context: comparing many codecs on a full 5-minute file would be slow and can exhaust browser/backend resources; concurrent encodes complicate progress and cancellation.
- Decision: the comparison batch uses a 30 s excerpt and runs sequentially. Cancel stops scheduling new points and aborts the in-flight backend call. The current worker DSP call cannot be interrupted mid-transform.
- Consequences: the comparison stays responsive and its progress is honest; it never implies full-file results, and the UI labels the excerpt. Implementation: failed points remain as translated error rows, lossless `∞` quality stays in the table but is excluded from the chart, and the CSV copy uses fixed 3-decimal numbers with `Infinity`/`NaN` literals.

## D-032 — Denoising uses DPDFNet via `sherpa-onnx`

- Date: 2026-11-03
- Status: accepted (owner, Wave 5 brainstorm)
- Context: F14 needs a small CPU denoiser with offline weights. DeepFilterNet3's Python package requires `numpy<2.0` and has no cp312 `deepfilterlib` wheel, which conflicts with the current NumPy line and would require porting its STFT/ERB/deep-filter DSP.
- Decision: use `Ceva-IP/DPDFNet` revision `dd6818d00f50c836fed43a6243ebe49116de5964`, file `onnx/dpdfnet2_48khz_hr.onnx` (10.5 MB, Apache-2.0), through `sherpa-onnx==2.0.1`; the wrapper resamples to 48 kHz, denoises, and returns to the source rate.
- Consequences: no custom denoiser DSP and no NumPy 1.x pin for the default environment; the model is speech-only, so denoising music or non-speech is a documented limitation rather than a target.

## D-033 — ML dependencies are an optional `ml` extra

- Date: 2026-11-03
- Status: accepted (owner, Wave 5 brainstorm)
- Context: the default API test run and CI must stay light, while the local demo needs PyTorch, ONNX Runtime, Demucs, and Transformers.
- Decision: ML packages live in the `ml` extra in `apps/api/pyproject.toml`; default tests and CI do not install it. Docker and the local demo install `--extra ml`. Real-model tests run only with `AVALAB_RUN_ML_TESTS=1`.
- Consequences: the plan's completion gate “no heavy ML import in the default pytest run” is enforced by construction; a deployment without the extra reports models unavailable instead of failing at import. Platform pins for Intel macOS are recorded as D-039.

## D-034 — F14 uses one AI route with five task tabs

- Date: 2026-11-03
- Status: accepted (owner, Wave 5 brainstorm)
- Context: five top-level sidebar routes would duplicate the source, model-status banner, job status, and 30 s excerpt controls.
- Decision: ship one `/tools/ai` route with tabs `?task=denoise|superres|separation|asr|neural-codec`; the task is URL state, and the shared shell owns model availability and job lifecycle.
- Consequences: switching experiments keeps the loaded source and URL-shareable task; tool-specific controls and result views plug into the same shell in Plans 02–03.

## D-035 — In-process ML jobs with SSE and a 30 s excerpt cap

- Date: 2026-11-03
- Status: accepted (owner, Wave 5 brainstorm)
- Context: the project has no database or Redis, CPU is the baseline, and ML calls are slow enough that request/response would block and lose progress.
- Decision: use an in-process bounded job manager with maximum concurrency 1 and a queue limit, stream `progress`/`done`/`error`/`cancelled` through SSE, and enforce a 30 s excerpt cap on the backend even when the frontend already sliced. No Redis/Celery.
- Consequences: one slow model cannot exhaust the laptop; cancellation and queue position are explicit; a restart loses queued jobs, which is acceptable without accounts and with TTL storage. The frontend mirrors the cap for early feedback but never replaces the server check.

## D-036 — F14 demo audio is CC0 with pinned provenance

- Date: 2026-11-03
- Status: accepted (owner, Wave 5 brainstorm)
- Context: the AI lab needs speech, noisy speech, and music clips that can be committed and redistributed with the public educational repository.
- Decision: bundle three concatenated Kathleen utterances (CC0 `rhasspy/dataset-voice-kathleen`) as speech, a seeded pink-noise derivative at 5 dB SNR, and a 15 s excerpt of the CC0 “Life Turns to History” as music. Source URLs, revisions, and SHA-256 hashes live in `docs/THIRD_PARTY.md`; `tools/demo_clips/fetch_f14.py` regenerates and verifies them.
- Consequences: demo experiments work offline and the repository carries no copyrighted music or uncleared voice. The noisy derivative is deterministic from the pinned seed, and asset drift fails the verifier.

## D-037 — Super-resolution compares LavaSR against the sinc resampler

- Date: 2026-11-03
- Status: accepted (owner, Wave 5 brainstorm)
- Context: F14 super-resolution must show what a learned bandwidth extension adds. Comparing LavaSR only against the original source would hide the effect of the bandwidth loss itself; comparing against a strong classical baseline isolates the learned contribution.
- Decision: the A/B experiment runs three lanes on the same excerpt: the band-limited low-rate source, the existing `resampleRational` windowed-sinc path upsampled back to the source rate, and the LavaSR backend job. The sinc lane reuses the Wave-3 resampler; no new baseline algorithm is added.
- Consequences: the chart attributes only the difference between the learned model and a good classical interpolation to learning. The sinc path cannot restore missing high-band content, so the comparison is honest, and results stay reproducible offline.

## D-038 — F16 share links encode only bundled demo clips

- Date: 2026-11-03
- Status: accepted (owner, Wave 5 brainstorm)
- Context: instructors need URL-ready experiments, but user uploads are private and the URL is public by nature.
- Decision: share links carry the tool, its parameters, and a `demoId` from the bundled CC0 clip set. They never encode user-uploaded audio, file names, or `audio_id`s. An unknown or missing id falls back to the normal empty state with an explanation.
- Consequences: links are safe to paste into a class and never leak uploads; an experiment built on a user file is shareable only as its parameter set, and the recipient must load audio first.

## D-039 — Intel-macOS CPU compatibility is explicit

- Date: 2026-11-03
- Status: accepted (owner, Wave 5 closeout; verified 2026-11-04)
- Context: PyTorch stopped publishing Intel-mac wheels after 2.2.2, and that wheel requires NumPy 1.x. The owner presents from an Intel macOS laptop, so the default NumPy 2.x/torch 2.6+ resolution would break the live demo.
- Decision: on `darwin`/`x86_64` the API resolves `numpy>=1.26,<2`, `scipy>=1.16,<1.17`, `torch>=2.1,<2.3`, `torchaudio>=2.1,<2.3`, and the last Intel-mac `onnxruntime` build. `transformers` stays `<5` so the 2.2 path is supported. Other platforms keep NumPy 2.x and `torch>=2.6`.
- Consequences: the owner's laptop runs the real models locally; the two lock resolutions must both stay green (`pnpm check` plus the API suite and mypy on this host). CI and Docker use the modern Linux line, so an Intel-only regression must be caught by the owner's gated model smoke.

## D-040 — LavaSR uses the pinned ONNX export despite a license-metadata gap

- Date: 2026-11-03
- Status: accepted (owner, Wave 5 closeout)
- Context: `audiosronnx` pins `TigreGotico/audiosronnx-lavasr`, not the upstream PyTorch-only `YatharthS/LavaSR`. The ONNX repo card has no license field, while upstream LavaSR and the `audiosronnx` package declare Apache-2.0 and the export cites the upstream.
- Decision: download the ONNX artifacts from the pinned ONNX repo at revision `b3df8a262cf44e59bf84a40b7084f4479ca566b4` and load them through the local flat-file path in `audiosronnx`. Record the metadata gap in `docs/MODELS.md` and here instead of assuming a license.
- Consequences: the offline super-resolution demo works on CPU with a documented provenance gap. If the ONNX repo later changes license or disappears, the pinned revision and the upstream Apache-2.0 provenance are the fallback evidence; a redistributor must review this item.

## D-041 — Linux/Docker installs CPU-only PyTorch wheels

- Date: 2026-11-04
- Status: accepted (owner, Wave 5 closeout)
- Context: the lockfile resolved Linux `torch` from PyPI, whose wheel pulls CUDA runtime packages plus `triton` even though the deployment target is CPU-only. This inflated the API image and made Docker builds fail repeatedly on large wheel downloads.
- Decision: pin a Linux-only `torch`/`torchaudio` source to the official PyTorch CPU index (`https://download.pytorch.org/whl/cpu`) in `apps/api/pyproject.toml`; macOS keeps its existing PyPI pins. The Docker build also mounts a uv cache so retries reuse downloaded wheels.
- Consequences: the Linux Docker image installs `torch==2.15.0+cpu`/`torchaudio==2.11.1+cpu` with no `nvidia-*` packages or `triton` (1.12 GB image). A future GPU profile needs its own lock resolution and must not silently reuse this CPU lock.

## D-042 — F13 psychoacoustics is a documented symmetric Bark model

- Date: 2026-11-06
- Status: accepted (owner, Wave 6 brainstorm; implementation detail pinned by Plan 01)
- Context: F13 must teach masking and feed a toy codec, but a full MPEG psychoacoustic model is proprietary-ish, tempo-dependent, and too heavy to explain. The design asks for one honest, reproducible model that students can verify against textbook curves.
- Decision: use 25 equal Bark bands on the Zwicker–Terhardt critical-band-rate scale (edges by bisection), the Terhardt absolute threshold with a 20 Hz floor and no upper clamp, and Schroeder spreading evaluated on `abs(dz)` rather than the signed `dz`. The deviation makes the spreading function symmetric and bounded for far maskers, so the 25×25 teaching matrix is stable and reproducible; the signed raw form is noted in `docs/ALGORITHMS.md`. Masking is stationary per MDCT frame with no temporal masking or tonal/noise partition. The reference SPL is user-selectable from 80 to 100 dB (default 94), and `P_ref` is measured through the same MDCT rather than hard-coded. The toy codec applies the masking threshold but never below the global quantization step.
- Consequences: the curves are deterministic and golden-tested, and the UI can show exactly which bands a codec may discard and at what bit cost. Results are teaching approximations, not an MP3/AAC compliance claim; a future perceptual model can replace the engine behind the same worker ops without touching the view.

## D-043 — F15 uses React Flow for graph editing

- Date: 2026-11-06
- Status: accepted (owner, Wave 6 brainstorm; pinned by Plan 02)
- Context: F15 needs branch/fan-out graph editing with stable node and edge IDs, drag/connect/delete interactions, and a canvas that stays LTR in both locales.
- Decision: add `@xyflow/react` 12.12.1 (MIT) to `apps/web`. The library is installed into the lazy pipeline route only; its stylesheet is imported by that route, never by the app shell. Rejected alternatives: hand-built SVG (too much interaction work), React Flow v11 (superseded).
- Consequences: the pipeline view gets editing primitives without hand-maintaining canvas interaction code. The dependency is recorded in `docs/THIRD_PARTY.md`; MIT is compatible with the project's GPL-3.0 license. The graph DSL, validation, and DSP execution remain ours and run outside React Flow.

## D-044 — F18 loudness matching is playback-only and clamped

- Date: 2026-11-06
- Status: accepted (owner, Wave 6 Plan 03)
- Context: A/B comparison is misleading when a codec changes level, but normalizing stored/exported audio would hide a real effect and mutate the student's result.
- Decision: measure both playback lanes with ITU-R BS.1770 integrated loudness in the worker, apply only the difference as a transport gain, clamp it to ±24 dB, and reset the original lane to 0 dB whenever the active lane changes. Exported WAVs and processed buffers are never normalized.
- Consequences: the listener compares timbre and artifacts at matched loudness while the measured/exported signals stay honest; a silent or unmeasurable lane reads `—` and contributes 0 dB rather than inventing a gain.

## D-045 — F18 theme is a per-browser preference with a system default

- Date: 2026-11-06
- Status: accepted (owner, Wave 6 Plan 03)
- Context: the product defaults to the dark scientific-instrument look, but users may need a light theme for projectors or accessibility.
- Decision: store `system | light | dark` in `localStorage["avalab.theme"]`; missing or invalid values resolve to `system`, which follows `prefers-color-scheme` live. Apply the resolved theme as `data-theme` on `<html>`; keep plots and technical axes LTR in both themes and leave spectrogram colormaps unchanged.
- Consequences: no account or server is needed, first visit respects the OS, and switching themes never changes tool state or audio.

## D-046 — F18 shortcuts are global but never fire in text fields or dialogs

- Date: 2026-11-06
- Status: accepted (owner, Wave 6 Plan 03)
- Context: transport keys should work anywhere on a tool page, but must not steal typing or break native form behavior.
- Decision: Space toggles play/pause, ArrowLeft/ArrowRight seek ∓5 s, Shift+ArrowLeft/Right seek ∓10 s, and `?` opens the shortcut help dialog. Ignore key repeats, Ctrl/Meta/Alt combinations, editable targets (`input`, `textarea`, `select`, `contenteditable`) and any target inside an open dialog. Provide a header button as the non-keyboard entry point; the dialog traps focus and closes on Escape.
- Consequences: one keyboard map works across all tools without per-view handlers; help remains discoverable and keyboard-accessible, and form controls keep their native arrows/space behavior.

## D-047 — F18 last-used settings reuse URL codecs in namespaced localStorage

- Date: 2026-11-06
- Status: accepted (owner, Wave 6 Plan 03)
- Context: many tools already encode shareable parameters in the URL; duplicating a second serialization format for persistence would drift.
- Decision: store the same stable query string under `avalab.<tool>.last` and reuse each tool's total decoder; a non-empty URL wins over storage, and a missing/invalid stored value falls back to defaults. A shared best-effort storage helper is used by the nine tools that need identical safe handling. Never store source audio, file names, uploaded IRs, or AI results.
- Consequences: share links stay authoritative, reloads reopen the last panel state, private/quota-blocked storage is non-fatal, and old or hand-edited values cannot crash a view.

## D-048 — F08 teaching and benchmark scopes are bounded

- Date: 2026-11-06
- Status: accepted (agent, Wave 6 Plan 04)
- Context: the FFT teaching view needs replayable butterflies, and the benchmark needs an independent implementation without turning noisy wall-clock numbers into a CI gate.
- Decision: `fftButterflySteps` records radix-2 DIT operations only for N = 8 and N = 16. `benchmarkFft` compares `fftRadix2` with pinned `fft.js` 4.0.4 on sizes 256/1024/4096/16384, one warm-up, median elapsed time over 1–1000 iterations, and gates only finite output plus `maxAbsError ≤ 1e-5`; no timing threshold is asserted. Both run as worker ops.
- Consequences: students see honest relative speed on their machine, CI cannot flake on load, and the whole-file STFT benchmark remains the long-input path.

## D-049 — F09 freehand spectra use linear bin curves after band edits

- Date: 2026-11-06
- Status: accepted (agent, Wave 6 Plan 04)
- Context: F09 needs drawing on the spectrum, but arbitrary curve semantics can fight the existing band-edit presets or break Hermitian reconstruction.
- Decision: freehand curves are linear interpolations between sorted, deduplicated `(bin, value)` points with held endpoints. At most 8 curves, 2–256 points each, integer bins inside the analysed spectrum. Curves apply after legacy band edits and before Hermitian enforcement, so the drawn shape wins. Magnitude clamps to non-negative; phase wraps to `(−π, π]`. The URL `cv` codec carries at most 8192 bins and validates every entry; legacy `ed` remains readable.
- Consequences: URL shares and reloads are deterministic, old links keep working, and the spectrum editor never computes DSP on the main thread.

## D-050 — F16 catalogue is ID-only and link-validated

- Date: 2026-11-06
- Status: accepted (agent, Wave 6 Plan 04)
- Context: the guided-experiment catalogue grew from 3 to 19 items, and saved progress or deep links must not break when copy or routes change.
- Decision: the closed `ExperimentId` union drives the catalogue, categories and 5–8 step content. Every optional deep link must target an existing tool route and decode through that tool's total URL parser. Progress stores IDs only under `localStorage["avalab.experiments.progress"]`; malformed JSON resets, unknown/duplicate IDs are dropped, and storage failures are non-fatal. Numerical claims in copy do not replace the algorithm rows and their golden/property tests, which remain the source of truth.
- Consequences: share links and reloads are safe, content can be reviewed in `fa` and `en` independently, and no audio or file names enter progress storage.

## D-051 — F14 pitch/beat are non-neural, excerpt-limited analysis jobs

- Date: 2026-11-06
- Status: accepted (agent, Wave 6 Plan 04)
- Context: F14 pitch and beat tracking are available from librosa; routing them through the neural model registry would require the ML extra for a non-neural tool.
- Decision: use `librosa.pyin(fmin=65, fmax=1000, frame_length=2048)` and `librosa.beat.beat_track(hop_length=256)` in backend analysis jobs. They use the shared 30 s route excerpt limit, return `kind="analysis"`, bypass `ml_enabled`, the model registry and the model factory, and never persist audio. `hop_length=256` is pinned because 512 misreports a synthetic 120 BPM train outside the ±2 BPM test bound.
- Consequences: pitch/beat work with the base API install and no weights; results are labelled analysis, not AI-model output; full-file analysis remains unsupported.

## D-052 — F12 AM/FM and Fourier preview reuse the generator core

- Date: 2026-11-06
- Status: accepted (agent, Wave 6 Plan 04)
- Context: F12 needed two new generator presets and an interactive Fourier-series preview without adding a second synthesis path.
- Decision: AM is `x[n] = a(1 + m·sin(2πf_m n/fs))·sin(2πf_c n/fs)`; FM is `x[n] = a·sin(2πf_c n/fs + β·sin(2πf_m n/fs))` with `β = deviationHz/f_m`. `generateSynth` dispatches them and the Fourier preview reuses `fourierSeriesPartialSum` plus `measureGibbsOvershoot`. The preview is capped at 2 s and 200 harmonics; URL state carries the new parameters and clamps on decode.
- Consequences: one generator engine and one Fourier-series implementation stay authoritative; overmodulation is warned in the UI rather than silently clamped.

## D-053 — Plan 05 performance fallbacks and main-thread boundaries

- Date: 2026-11-06
- Status: accepted (agent, Wave 6 Plan 05)
- Context: the 5-minute harness exposed two paths that cannot meet the 300 ms live-parameter target without changing their educational character, plus two session-boundary loops that are not DSP transforms.
- Decision: keep the teaching MDCT direct (O(frames·N²)) as an explicit encode/decode action with a measured 6 s test gate, and keep the reverb apply at a 30 s excerpt with a 250 ms input debounce and a 2 s test gate. Do not add WASM or replace either algorithm. Keep source validation/hash and `monoDownmix` on the main thread because they run once per load and moving them would add a new worker op outside the fixes-only scope. Record both boundaries in `docs/PROGRESS.md`.
- Consequences: every other measured path is inside the AGENTS §9 budget; the two fallbacks are honest, visible, and regression-gated. A future WASM/FFT-MDCT change needs its own benchmark and owner approval, and a future worker-op migration must remove the boundary note.

## D-054 — Docker deployment, offline model cache, and SSE proxy

- Date: 2026-11-06
- Status: accepted (agent, Wave 6 Plan 06)
- Context: deployment must run on a CPU-only laptop, survive an offline demo after one prefetch, and keep SSE progress incremental through the web container.
- Decision: `compose.yaml` runs the non-root API and Caddy web service on a default same-origin network, with named volumes `avalab-storage` for temporary audio and `avalab-models` at `/models`. Runtime sets `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, and an ephemeral `HF_HOME=/tmp/huggingface`; `download_models.py` defaults to `Settings.ml_model_cache_dir`, and the prefetch commands temporarily re-enable Hub access. Caddy routes `/api/v1/jobs/*` before the generic API handler with `flush_interval -1`; static SPA responses are compressed, API/SSE responses are not. `AVALAB_PUBLIC_ORIGIN` is appended to `AVALAB_CORS_ORIGINS` when set. The optional `compose.gpu.yaml` wires an externally built CUDA image; `AVALAB_ML_DEVICE=cuda` selects CUDA for the PyTorch ASR, separation and Encodec runners, and for LavaSR only when the ONNX runtime exposes `CUDAExecutionProvider`. DPDFNet remains CPU-only, and the GPU path is untested. `AVALAB_PUBLIC_ORIGIN` is normalized to a scheme/host origin (trailing slash stripped, path/query/fragment rejected) before CORS matching. The `numba` pin is restricted to Intel macOS because an unmarked `numba<0.62` selected numba 0.53/llvmlite 0.36 on Linux/Python 3.12 and broke the Docker build.
- Consequences: the default stack is reproducible and offline after the 365.7 MiB prefetch; testers can verify SSE timing with `docker/smoke.sh`; GPU users must supply their own CUDA image and NVIDIA runtime; the Intel-macOS-only numba marker keeps the local lock working without forcing an old numba onto Linux.

## D-055 — Deliverable PDFs are static HTML rendered by Playwright Chromium

- Date: 2026-11-06
- Status: accepted (agent, Wave 6 Plan 07)
- Context: the release needs a Persian A4 report and 16:9 slides that build on the owner's machine and in CI without a document toolchain, while keeping RTL shaping and self-hosted fonts exact.
- Decision: keep the report and slides as static HTML/CSS (`docs/report/`, `docs/slides/`), serve the repo through a local static server, and render both with the existing Playwright Chromium `page.pdf()`. The builder fixes `fa-IR`, the dark theme, and a 1440×900 viewport; waits for `document.fonts.ready` and all images; and fails on console errors, page errors, failed requests, missing fonts, horizontal overflow, or page/slide overflow. Fonts are the self-hosted Vazirmatn woff2 files; no CDN. `pnpm build:docs` writes `docs/deliverables/avalab-report-fa.pdf` and `avalab-slides-fa.pdf`.
- Consequences: no pandoc/tectonic/typst dependency is added and the PDFs use the same rendering stack as the e2e tests. Screenshot capture stays a separate deterministic step (`docs/capture-report-assets.mjs`, DPR 2) and AI figures are cached files, so the PDF build never needs the API or model weights. The owner approved committing the generated PDFs on 2026-11-07.

## D-056 — Stereo playback and real codecs only; per-channel DSP deferred

- Date: 2026-11-07
- Status: accepted (owner, Wave 7 Plan 01); Phase 1 implemented 2026-11-07; Phase 2 (grid-safe processors) implemented 2026-11-07
- Context: F01 promises stereo playback while analysis remains mono for comparability. Extending every DSP tool, metric, AI task, and hand-written codec per channel would multiply scope and risk without changing the teaching goals.
- Decision: preserve 1–2 source channels in the session store and use them for original playback, real-codec processed playback, and real-codec WAV export. Keep a mean mono downmix as the canonical analysis lane for waveform, spectrogram, FFT, filters, sampling, extent, speed, reverb, spectrum edit, metrics, pipeline, AI, and hand-written toy codecs. Real codecs encode/decode the preserved channels; alignment is estimated once on the mono downmix and applied to every channel; `bit_exact` requires every channel to match. More than two channels fold to mono. No worker protocol change and no per-channel processing in this wave.
- Phase 1 (channel foundation, 2026-11-07): waveform, spectrogram, FFT, and metrics select `mono` (mean downmix, default), `left`, or `right`; waveform and metrics also offer `both`. The choice is URL-backed as `ch=left|right|both`; mono removes the key. Lane derives append `\u0000lane:<0|1>` to the existing three-part cache key and process a stored playback lane; mono keys, DOM, and test IDs are unchanged. Phase 1 adds no independent per-lane parameters, and `both` is deliberately restricted to waveform and metrics.
- Phase 2 (grid-safe processors, 2026-11-07): filters (F11), the spectrum editor (F09), and hand-written toy codecs (F04) now offer `mono`, `left`, `right`, and `both`. Each tool keeps the existing primary settings and an optional right lane; the right lane mirrors primary until the user unlinks it, so old URLs/storage stay linked primary-only. Right URL fields use the `rr*` prefix plus `el=right`; mono output shape, DOM, cache keys, and tests are unchanged, while slice-lane cache keys add the clamped range.  Lane derives opt out of RPC supersede (identical params, different payload), so left and right can encode concurrently. One-lane results preserve the untouched source lane; `both` requires equal-length outputs. Codec diagnostics show effective-lane stats in one-lane modes and summed bytes/times, the all-lane bit-exact AND, and histograms-merged entropy in `both`; no mixed-codec comparison row is fabricated. Batch comparison stays mono.
- Consequences: stereo files sound correct and round-trip through ffmpeg without silent downmixing, while existing mono results, formulas, and tests stay authoritative. Mono files behave exactly as before. True-stereo convolution, grid-changing processors, pipeline, AI, and full-file stereo codec jobs remain future work.
