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
