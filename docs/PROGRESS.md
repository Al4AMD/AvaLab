# PROGRESS.md — AvaLab status log

> Living log. Agents update every session: what changed, what is next, known issues, items needing owner review.

## Wave 0 (M0 Foundation) — **done**, 2026-10-19

13/13 tasks complete. Commit range `c56fbe2..ea68089` (T13) plus follow-up docs fixes and M0 close-out fixes (see git log), on `feat/wave-0-foundation`. Per-task ledger: `.superpowers/sdd/foundation/progress.md` (scratch, not committed).

| Task | Result | Commit(s) |
|---|---|---|
| T1 SDD harness, plans tree, project agents, gitignore | complete | c56fbe2 |
| T2 monorepo scaffolding: pnpm workspaces, Biome, root scripts | complete | f38cc30 |
| T3 golden-vector pipeline (energy fixtures) | complete | 847e4fa |
| T4 `packages/dsp` skeleton: energy, avg power, time helpers, golden loader | complete | 183df21 |
| T5 API skeleton: config, error envelope, health endpoint | complete | 5e4d78b, b8a5aba, 76c282e |
| T6 ffprobe-validated ingest + upload cap + cleanup | complete | 197db46, d53e401 |
| T7 TTL sweeper + delete endpoint | complete | bb87207 |
| T8 audio serving with HTTP Range (D-007 semantics) | complete | 8c068a9, 228ef36, 3e732ec, f865a93 |
| T9 OpenAPI → TS client generation (D-008, D-009) | complete | 412fdc5, 0ca70ac |
| T10 web shell: i18n, RTL, design tokens, health status | complete | 3c20491, ed7545d |
| T11 i18n key checker wired into `pnpm check` | complete | 0c4b612 |
| T12 Docker Compose deployment (api + web/Caddy) | complete | d907e7e |
| T13 docs, demo clips, third-party register, progress | complete | this commit |

Verified at close-out: `pnpm check` green; `uv run --directory apps/api pytest -q` green; `pnpm e2e` 4/4 green; docker compose smoke reproduced by the verifier (host 8080 was occupied by Homebrew Apache during dev, override port used for the local smoke — committed compose keeps `8080:80`).

## Wave 1 · Plan 01 — Fourier transforms (complete)

**Status:** complete. Commits `71b3d64..ff812d7` (reviewed head `5874f46`) plus this close-out commit, on `feat/wave-1-fourier`.

**Built** (`packages/dsp`, pure TS, golden-verified): naive DFT/IFFT (teaching O(N²) path); iterative radix-2 Cooley–Tukey FFT/IFFT; Bluestein FFT for arbitrary N behind the `fft`/`ifft` dispatcher; real-input `rfft`/`irfft` with Hermitian reconstruction; periodic and symmetric windows (rect, hann, hamming, blackman) plus symmetric Kaiser and the exported `i0` series; STFT/ISTFT with weighted overlap-add (COLA) normalization.

**Verification:** `pnpm check` green; 229 dsp tests at reviewed head `5874f46`; all golden fixtures byte-deterministic (generator run twice → `git status` clean, no golden value changes).

**Known issues / deferred (still open):**
- `dft.ts`: finiteness check sits in the inner loop; hoist if profiling ever shows it matters.
- `dft.test.ts`: no Re-only reconstruction test for non-Hermitian spectra.
- `fft.test.ts`: no non-power-of-two test for `ifftRadix2` (the dispatcher path covers it).
- Fourier modules: error-label wording not fully uniform.
- Fourier test files: `valueAt` helper duplicated per file.
- `bluestein.ts`: plan caching deferred until profiled.
- `rfft.test.ts`: irfft tolerance-boundary case not covered.
- FFT dispatcher tests: no explicit odd-N assertion.
- Goldens: no symmetric L = 2 windows case.
- `windows.ts`: kaiser large-β accuracy documented but not tested at the boundary.
- `tools/golden`: no mypy config (outside gated packages).
- Goldens: no cosine (nonzero-phase) case.
- `bluestein.ts`: m up to 4N memory note and n·n < 2^53 exactness bound undocumented.
- `rfft.ts`: irfft makes three O(N) passes.
- Window tests: symmetric assertions duplicated.
- STFT tests: redundant hand-built H≤L case; error-message regexes substring-based.
- `tools/golden/.../stft.py`: docstring padding description corrected in this close-out commit (closed).

**Needs owner review:** none for code; Wave 1 fixtures ≈6.3 MB (all golden fixtures ≈7.7 MB), accepted by the plan.

## Wave 1 · Plan 02 — Signals, metrics, quantization, resampling (complete)

**Status:** complete. Commit range `290b9da..1c9cc69` plus this final-review fix commit, on `feat/wave-1-signals`.

**Built** (`packages/dsp`, pure TS; golden-verified where a cross-language reference exists): closed-form generators (sine, square, sawtooth, triangle, impulse, step, chirp, two-tone, AM/FM) and seeded white/pink noise (mulberry32, Voss–McCartney — no cross-language golden by design); Fourier-series reconstruction and Gibbs overshoot; signal extent (shift, scale, reverse, truncate, zero-pad, support, energy/power classification, energy, average power); quality metrics (MSE, SNR, segmental SNR, PSNR, compression ratio, bitrate, entropy); uniform quantization with TPDF dither; rational resampling (`kaiserSinc` anti-aliased path plus the unfiltered aliasing demo); G.711 μ-law/A-law companding.

**Verification:** `pnpm check` green; 566 dsp tests; all golden fixtures deterministic (full generator run twice → no golden diff, extent values unchanged by the exact half-up fix).

**Final-review fixes:** the 1-bit quantizer is now a mid-rise bipolar quantizer (exact zero → +1) instead of the degenerate unipolar `{0, +1}`; resampling validates rates before the empty-input return and rejects unsafe unfiltered index arithmetic; the golden toolchain is pinned to Python 3.12 (`<3.13`, stdlib `audioop` removed in 3.13); Python extent half-up now uses floor + fractional compare. Controller ruling kept: a finite excerpt whose nonzero support touches either boundary is classified `"power"` (indistinguishable from a continuing signal), documented in `docs/ALGORITHMS.md`.

**Known/deferred minors:** `sampleCountOf` duplicated between `generators.ts` and `fourierSeries.ts` (hoist in a later plan); resample golden docstring tolerance wording; no explicit length-1 non-empty resample test; `tools/golden` stays outside the mypy-gated packages.

**Needs owner review:** none.

**Next step:** Wave 1 Plan 03 — `docs/plans/wave-1/03-systems-and-filters.md`.

## Wave 1 · Plan 03 — Convolution and filters (complete)

**Status:** complete. Commit range `b38c5ca..HEAD` on `feat/wave-1-filters` (implementation, stability fixes, analysis, docs).

**Built** (`packages/dsp`, pure TS, golden-verified): direct convolution; FFT overlap-add convolution with explicit tail/block handling; window-method FIR design (lowpass, highpass, bandpass, bandstop; hamming/blackman/kaiser windows; SciPy `firwin` normalization; even-tap highpass/bandstop rejected with `RangeError`); Butterworth and Chebyshev I design via the prewarped bilinear transform; RBJ biquads; transposed direct-form-II `applyFilter`; filter analysis — `freqz`, `magnitudeDb`, `unwrapPhase`, `groupDelaySamples`, `impulseResponse`, `stepResponse`, `polesZeros`, `isStable`.

**Verification:** `pnpm check` green; 727 dsp tests; four new goldens (convolution_direct 9.6 KB, fir 8.1 KB, iir 80 KB, filter_analysis 139 KB; golden directory 8.1 MB); golden generators double-run identical; SciPy `firwin` max relative error 2.5e-14; Butterworth/Chebyshev coefficients agree with SciPy at ≈7e-16.

**Design decisions:** b/a IIR stability is fragile at realized order 16, so designs must pass a solver envelope `max|p| ≤ 0.995` plus a 48000-sample impulse-decay behavioral guard; non-finite, non-decaying, or silent responses throw `RangeError` — coefficients are never clamped; the docs call 48000 samples a practical horizon, not a proof; SOS/state-space realization is future work. Group delay is pinned to central finite differences on the unwrapped phase (the golden generator uses the same formula). Repeated zeros at `z = −1` are verified by residual/count/cluster checks; simple roots are pinned at 1e-8; the distinct-zero FIR golden is matched root-to-root. FIR highpass/bandstop even-tap designs are rejected to match SciPy.

**Known/deferred minors:** `nextPowerOfTwo(0.5)` returns 1 (n ≤ 1 documented, no test); the `stepResponse` test reuses `applyFilter` (the golden step covers the independent path); the non-finite/silent behavioral guard branches are untested; the hardcoded 48000/36000 constants are named but not derived; the 33-tap Hamming highpass has `|H(0)| = 2.76e-3` (the plan's ≤ 1e-3 is pinned via the 65-tap test); an all-zero numerator has no finite zeros (document if the UI exposes it); the design guard costs 15–28 ms, so filter design must run in a Worker per AGENTS §9, with the UI trigger debounced if needed; the `sampleCountOf` duplication carried from Plan 02.

**Needs owner review:** none.

**Next step:** Wave 1 Plan 04 — `docs/plans/wave-1/04-codecs-and-time.md`.

## Wave 1 · Plan 04 — Codecs, MDCT toy codec, phase vocoder (in progress)

**Task 1 RLE:** complete. `rleEncode`/`rleDecode` in `packages/dsp/src/codecs/rle.ts` with the pinned byte format `[value u8][count u16 LE, 1..65535]`, greedy > 65535 run splitting, empty→empty, and the exact decode errors `RangeError("truncated rle stream")` / `RangeError("invalid rle count 0")` (R5); the format is explicitly not self-delimiting (documented in the module header and ALGORITHMS.md). Golden `test-data/golden/rle.json` (6 cases: empty, single byte, 70000 identical bytes → split 65535+4465, alternating 0x00/0xFF ×100, ramp 0..255, seeded random with runs) generated by `tools/golden/.../algorithms/rle.py`, byte-exact both directions; the 70000-byte constant case carries its input as reconstruction `params` instead of ~0.5 MB of identical floats (documented in the fixture docstring). Tests pin the goldens, adversarial round-trips (all-zero 1e5, alternating, mulberry32 seed 7 1e4, 0x00/0xFF edges, single byte, run 200000), 65535/65536 record-boundary split, compression sanity (runs-heavy shrinks, random expands ≈3×) and no-mutation.

**Task 2 canonical Huffman:** complete. `buildHistogram` / `buildCanonicalCodes` / `huffmanEncode` / `huffmanDecode` / `validatePrefixFree` in `packages/dsp/src/codecs/huffman.ts` (no cross-language golden per plan — RFC 1951 §3.2.2 canonical construction + in-test vectors pin the algorithm instead; dual-implementation risk avoided by construction). Pinned (R6): min-heap merges with total order (count asc, min-symbol asc, creation sequence asc — min-symbols are unique across a Huffman forest, sequence is a defensive backstop); single positive symbol → length-1 code; lengths ≤ 15 with the documented length-limiting fallback (clamp at 15, then integer-Kraft repair `K = Σ 2^(15−l)`, demoting the smallest symbol of the deepest length ≤ 14 one level per step; existence of a demotable length proved in the module header); RFC 1951 §3.2.2 canonical assignment (length, symbol order); MSB-first bit packing, last byte zero-padded. Decode is a bounded puff-style table walk with the exact errors `RangeError("invalid huffman code")` / `RangeError("truncated bitstream")` (ruling R6) and never hangs; corrupted codebooks reject with `RangeError("invalid huffman codebook")`; guards per R14 (TypeError for wrong array types, RangeError for invalid histogram/bitLength/codebook params). Tests: hand-derived "abracadabra" codebook (lengths a 1 / r 2 / b 3 / c 4 / d 4, stream 23 bits = 0x69 0xCF 0x68), empty/single-symbol/uniform-256 (all lengths 8, stream == input), adversarial round-trips incl. a 832039-byte Fibonacci-skew stream whose unrestricted tree exceeds 15 (fallback engaged: 37 codes at the limit, maxLength 15), average bits/symbol < entropy + 1 over 5 random seeds, byte-identical double encodes, deterministic codebooks, truncated/invalid/corrupt decode errors (never returning the original on corrupt-but-decodable flips), and necessary Kraft-rejection cases incl. 100-bit lengths (exact BigInt).

**Task 3 delta predictor + single-codebook FLAC-style Huffman (pinned self-contained payload layout):** complete.

**Next:** Plan 04 Task 3 — delta predictor + Huffman, FLAC-style (`docs/plans/wave-1/04-codecs-and-time.md`).

## What's left

- **Wave 1** — `docs/plans/wave-1/` (4 executable plans; see D-015). Plans `01-fourier-transforms.md`, `02-signals-and-metrics.md`, and `03-systems-and-filters.md` complete (above); `04-codecs-and-time.md` in progress (Tasks 1–2 done). Pure-TS DSP + golden vectors; no UI, no router.
- Wave 2+ — not planned yet; see `docs/plans/README.md` for the wave map.

## Known issues / deferred minors (carried out of Wave 0)

From the T1–T12 ledgers; none blocking, each has an upgrade path:

- T2: `biome.json` `$schema` pinned `2.5.15` vs caret devDependency — bump together at final review.
- T3: `tools/golden/tests/test_fixtures.py:22` dead `REPO_ROOT` constant; `energy.json` 1.4 MiB one-float-per-line (compact only if Wave 1 fixtures get heavy).
- T4: `packages/dsp/test/fixtures.ts:33` `JSON.parse` outside try/catch (error lacks path); per-case shape unvalidated before cast (fixtures.ts:42).
- T5: `.env.example` sits at repo root while `Settings` `env_file=".env"` is CWD-relative (`apps/api` CWD) — document or relocate; ambient-env test isolation; no-body statuses (204/304) would get JSON bodies (no such routes today).
- T6: `_parse_int` accepts bools (paranoia only); chunked-upload test delivers a single ASGI message (TestClient joins generator bodies; disclosed).
- T7: `make_client` helper duplicated in `test_ttl.py` vs `test_ingest.py` — hoist to conftest at cleanup.
- T8: multi-range with one non-servable part → whole set 416 (mirrors starlette); `If-Range` ignored by route validation; reverse TOCTOU delete-between-stat-and-send (starlette send phase, inherent).
- T9: `app.openapi()` override short-circuits FastAPI route-version cache (latent; no post-boot route registration today); `openapi_utils` strips paths only (webhooks = future scope).
- T11: checker raw-scan counts `t("k")` inside comments/strings (false-negative-safe); misses `t ("k")`/static backticks (fails loud); CLI symlink realpath edge.
- T12: bare `/api` falls to the SPA (no functional impact; app uses `/api/v1/...`); uv cache persists in the api image layer (size only).

## Needs human Persian review

`apps/web/src/i18n/fa.json` — 8 keys drafted by an agent, natural academic phrasing requested, plus the language toggle control:

- `app.title`, `app.subtitle`, `app.language.switchLabel`
- `app.health.loading`, `app.health.ok`, `app.health.offline`, `app.health.offlineDetail`
- `app.privacy.ttlNotice`

(Future Persian copy: every wave's fa strings land in this section until the owner reviews them.)

## Next recommended step

Start **Wave 1, plan `04-codecs-and-time.md`** via the subagent-driven-development workflow (fresh session, new ledger under `.superpowers/sdd/`). Do not begin later plans while an earlier one has failing checks.

## Session log

### 2026-10-19 — Session 1 (bootstrap)

- Done: `AGENTS.md` written (owner). `LICENSE` = GPL-3.0 (owner). All §16 open questions answered → recorded in `docs/DECISIONS.md` (D-001 … D-006).
- Repo state at the time: git initialized; only `LICENSE` tracked.
- Next step was: write the Wave 0 + Wave 1 task-level plan, then execute M0.

### 2026-10-19 — Wave 0, Task 10 (F17 web shell)

- Done: `apps/web` React shell — Vite + React 19 + Tailwind v4 + i18next; fa default RTL / en LTR toggle (persisted in `localStorage["avalab.language"]`, `<html lang/dir>` synced at boot and on change); design tokens in `src/styles/app.css` `@theme` (dark scientific-instrument theme, single teal accent); `HealthStatus` (typed `GET /health` via openapi-fetch, translated loading/ok/offline states, raw errors never rendered); hand-vendored `ui/button.tsx` + `lib/cn.ts`; self-hosted Vazirmatn v33.003 woff2 (regular/medium/semibold/bold + OFL.txt); TTL privacy notice footer; Playwright chromium smoke (3 specs, API absent by design); `docs/THIRD_PARTY.md` initial table.
- Verified: `pnpm --filter @avalab/web typecheck` ✓ · `pnpm --filter @avalab/web test` 3/3 ✓ · `pnpm e2e` 3/3 ✓ · `pnpm check` ✓ (lint, typecheck, dsp 23 + web 3 tests).
- Notes: Vite 8 `preview` inherits `server.proxy`; the preview proxy is explicitly disabled (`preview.proxy: {}`) so the no-API e2e path gets the SPA fallback (200 HTML) instead of a proxy 502 that would log a browser console error — `HealthStatus` maps any non-`{status:"ok"}` payload to offline.
- Needs owner review: Persian copy of `apps/web/src/i18n/fa.json` (8 keys).

### 2026-10-19 — Wave 0, Task 11 (F17 i18n key checker)

- Done: `scripts/i18n-check.mjs` — dependency-free checker with `checkI18n({root, localesDir, sourcesGlob, dynamicAllowlistPath})`: locale parity (`fa`↔`en`, nested keys flattened to dot paths), literal `t("key")`/`t('key')` scan over `apps/web/src/**/*.{ts,tsx}`, unused-key check with segment-aware dynamic allowlist; returns `{file, key, reason}` findings; CLI exits 1 on findings / 0 clean / 2 on crash. `scripts/i18n-dynamic-keys.json` lists the 3 `app.health.*` keys reached via `t(labelKey)` in `HealthStatus.tsx`. `scripts/i18n-check.test.mjs` — 13 node:test cases. Root `package.json`: `check` ends with `&& pnpm i18n:check`; `test` ends with `&& node --test "scripts/**/*.test.mjs"`.
- Verified: `node --test` 13/13 ✓ · `pnpm i18n:check` → `i18n-check: OK` exit 0 ✓ · failing temp fixture → 1 finding, exit 1 ✓ · malformed locale → exit 2 ✓ · `pnpm check` exit 0 (biome 36 files, dsp 23 + web 3 + scripts 13 tests).
- Notes: `node --test scripts/` (directory form) is broken on Node 21+ (nodejs/node#64555); wired with an explicit `scripts/**/*.test.mjs` glob instead.

### 2026-10-19 — Wave 0, Tasks 12–13 (docker, docs, demo clips, close-out)

- T12: `compose.yaml` + `docker/api.Dockerfile` + `docker/web.Dockerfile` (node build → Caddy serving static + `/api` proxy); API healthcheck exercises the real ingest path; storage volume `/data` chowned to uid 10001. Smoke reproduced with a host-port override (8080 occupied locally by Homebrew Apache).
- T13: `tools/demo_clips` generator (numpy only, fixed seeds; three 5 s 48 kHz mono clips) with clips committed under `apps/web/public/demo/` (CC0, D-016); `README.md` quickstart with the real scripts; `docs/THIRD_PARTY.md` completed (full lockfile tables, Caddy, audio assets); `docs/DECISIONS.md` D-010…D-016; `docs/plans/README.md` wave-0 → done.
- Verified this session: generator run twice → byte-identical SHA-256 for all three WAVs; `ffprobe` → 48000 Hz, mono, 5.0 s; `pnpm check` ✓; `uv run --directory apps/api pytest -q` ✓.
