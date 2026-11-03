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

## Wave 1 · Plan 04 — Codecs, MDCT toy codec, phase vocoder (complete)

**Task 1 RLE:** complete. `rleEncode`/`rleDecode` in `packages/dsp/src/codecs/rle.ts` with the pinned byte format `[value u8][count u16 LE, 1..65535]`, greedy > 65535 run splitting, empty→empty, and the exact decode errors `RangeError("truncated rle stream")` / `RangeError("invalid rle count 0")` (R5); the format is explicitly not self-delimiting (documented in the module header and ALGORITHMS.md). Golden `test-data/golden/rle.json` (6 cases: empty, single byte, 70000 identical bytes → split 65535+4465, alternating 0x00/0xFF ×100, ramp 0..255, seeded random with runs) generated by `tools/golden/.../algorithms/rle.py`, byte-exact both directions; the 70000-byte constant case carries its input as reconstruction `params` instead of ~0.5 MB of identical floats (documented in the fixture docstring). Tests pin the goldens, adversarial round-trips (all-zero 1e5, alternating, mulberry32 seed 7 1e4, 0x00/0xFF edges, single byte, run 200000), 65535/65536 record-boundary split, compression sanity (runs-heavy shrinks, random expands ≈3×) and no-mutation.

**Task 2 canonical Huffman:** complete. `buildHistogram` / `buildCanonicalCodes` / `huffmanEncode` / `huffmanDecode` / `validatePrefixFree` in `packages/dsp/src/codecs/huffman.ts` (no cross-language golden per plan — RFC 1951 §3.2.2 canonical construction + in-test vectors pin the algorithm instead; dual-implementation risk avoided by construction). Pinned (R6): min-heap merges with total order (count asc, min-symbol asc, creation sequence asc — min-symbols are unique across a Huffman forest, sequence is a defensive backstop); single positive symbol → length-1 code; lengths ≤ 15 with the documented length-limiting fallback (clamp at 15, then integer-Kraft repair `K = Σ 2^(15−l)`, demoting the smallest symbol of the deepest length ≤ 14 one level per step; existence of a demotable length proved in the module header); RFC 1951 §3.2.2 canonical assignment (length, symbol order); MSB-first bit packing, last byte zero-padded. Decode is a bounded puff-style table walk with the exact errors `RangeError("invalid huffman code")` / `RangeError("truncated bitstream")` (ruling R6) and never hangs; corrupted codebooks reject with `RangeError("invalid huffman codebook")`; guards per R14 (TypeError for wrong array types, RangeError for invalid histogram/bitLength/codebook params). Tests: hand-derived "abracadabra" codebook (lengths a 1 / r 2 / b 3 / c 4 / d 4, stream 23 bits = 0x69 0xCF 0x68), empty/single-symbol/uniform-256 (all lengths 8, stream == input), adversarial round-trips incl. a 832039-byte Fibonacci-skew stream whose unrestricted tree exceeds 15 (fallback engaged: 37 codes at the limit, maxLength 15), average bits/symbol < entropy + 1 over 5 random seeds, byte-identical double encodes, deterministic codebooks, truncated/invalid/corrupt decode errors (never returning the original on corrupt-but-decodable flips), and necessary Kraft-rejection cases incl. 100-bit lengths (exact BigInt).

**Task 3 delta predictor + single-codebook FLAC-style Huffman (pinned self-contained payload layout):** complete. First-order delta predictor on the wrapping Int16 ring → zigzag → low/high byte streams, coded by one canonical Huffman codebook over the combined low+high byte histogram, packed MSB-first into the self-contained payload `[u32 bitLengthLow][u32 bitLengthHigh][256 codeLengths][padded low bytes][padded high bytes]` — decode takes only the payload, no codebook argument. Commits `2e57b90`, `4ae1b2b`; review approved after wrap-edge coverage was added.

**Task 4 MDCT/IMDCT with TDAC:** complete. `mdct`/`imdct` in `packages/dsp/src/timestretch/mdct.ts` with the amended pins (CONTROLLER AMENDMENT 2026-10-25): Princen–Bradley oddly-stacked basis `cos(π(2k+1)(2n+1+N)/(4N))` (the plan's plain DCT-IV angle is provably non-reconstructing — per-frame composite `I − A` swaps distinct mirror samples across the covering frames — so R2/R3/R4 were amended before implementation), sine window on both analysis and synthesis, pre-rolled frames (`frameCount = ceil(sampleCount/hop) + 1`, frame i covers `[(i−1)·hop, (i−1)·hop + 2·hop)`), plain TDAC overlap-add in `imdct` with no Σw² division, output `(frameCount−1)·hop` samples. Cosine matrix built once per call and not exported (`mdctMatrix` deliberately absent). Golden `test-data/golden/mdct.json` from `tools/golden/.../algorithms/mdct.py` (6 cases; regenerates byte-identical; generator cross-checks the direct basis against a folded scipy type-4 dct/dst construction) with rtol 1e-9/atol 1e-11 (atol covers cross-language Math.cos/BLAS argument-reduction noise, measured max 4.2e-12). Tests: fixtures both directions, PR ≤ 1e-10 incl. non-multiple tails and the frame-4 minimum, guard tests, no-mutation; measured perfect reconstruction maxerr 1.04e-13 on a synthetic 5-min 44.1 kHz mono file. dsp 814/814.

**Task 5 MDCT toy lossy codec:** complete. `encodeMdct`/`decodeMdct` in `packages/dsp/src/codecs/mdctCodec.ts` per ruling R9 (see session log 2026-10-25 below and task-5-report.md for the measured R9 tonal-collapse flag). dsp 849/849.

**Task 6 phase vocoder time-stretch + pitch-shift:** complete. `timeStretch`/`pitchShift` in `packages/dsp/src/timestretch/phaseVocoder.ts` (pure, DOM-free, Float64): analysis STFT at `H_a = ⌊L/4⌋` (periodic hann, unnormalized frames), synthesis at `H_s = max(1, round(H_a·r))`, output `round(N·r)`, per-bin phase propagation `φ_s += ω_k·H_s + Δφ·(H_s/H_a)` (deviation scaled by the hop ratio — the standard Dolson formulation that preserves instantaneous frequency; R11's literal line omits the scaling and IS a documented deviation), WOLA with per-sample Σw² normalization (`< 1e-12 → 0`, R12), bins `0..⌊L/2⌋` propagated (⌊L/2⌋+1 bins — an `⌈L/2⌉` variant skips the even-L Nyquist self-bin and leaks frame 0's value forever; that bug was caught by the identity test and fixed), Hermitian mirror bins written conj with explicit skip for bin 0's out-of-range partner. `stretchFactor = 1` matches `istft(stft(x))` identity to ~1e-15 (one 8192-sample seed bit-exact; plan tolerance 1e-6). `pitchShift = timeStretch(2^(+s/12))` then `resampleRational(stretched, fs → round(fs/2^(s/12)), kaiserSinc)` then deterministic trim/pad to exactly N (R13 deviation documented: the literal R13 sign direction measured an INVERTED pitch — +12 gave 220 Hz instead of double — so the reciprocal direction is implemented: +12 → 880 Hz, −12 → 220 Hz, ±5 within 0.2 %, semitones 0 passthrough). Tests: identity vs istft ≤ 1e-6 at L = 1024/1000/8, exact length contract, sine pitch preservation + side bins ≤ −20 dB at ±32..128 padded bins (measured −26.5 dB; nearer offsets carry the 21.3 ms analysis-window skirt where the bound is unattainable — documented), chirp instantaneous-frequency ladder ≤ 15 % (measured ≤ 2.8 %), noise bounded ≤ 10·inputRms (measured 5.0), zero input → zeros, guards (TypeError/RangeError), no mutation, empty → empty. 16 tests added. dsp 865/865.

**Closing:** 6/6 tasks done. Verification: `pnpm --filter @avalab/dsp test` 865/865, golden pytest 8/8, typecheck/lint/i18n clean. Two carry-over notes for wave-4: (a) `huffmanDecode` preallocates a bitLength-sized output — up to ~15× the actual symbol count transiently for skewed codebooks; not committed yet, wave-4 may tighten via codebook prescan. (b) A full-length whole-file `timeStretch` on a 5-minute file can hold ~0.9 GB of analysis frames — the F06 UI must use the excerpt strategy per AGENTS §9 before enabling full-file apply.

## Wave 2 · Plan 01 — App skeleton: router, session store, DSP worker, RPC (complete)

**Approach (owner-approved 2026-10-25):** Spec `docs/superpowers/specs/2026-10-25-wave-2-core-visuals-design.md`; plans `docs/plans/wave-2/01…04`. Decisions recorded: D-018 (typed message DSP worker, no Comlink; backend-first decode + offline fallback lane), D-019 (per-tool routes with canonical URL-encoded params). Wave 2 = four sequential SDD plans, this is Plan 01.

**Task 1 router + layout:** complete. Data routes `/` → `/tools/{waveform,spectrogram,fftview,generator}` with stub pages; layout keeps the Wave-0 header (HealthStatus + LanguageToggle), adds a logical-property sidebar (NavLink `aria-current`, token focus-visible treatment) and a docked player placeholder. Pure `lib/url-state.ts` encode/decode (sorted keys, locale-free `String()`, arrays as repeated keys, TypeError on booleans/objects/NaN/±Infinity; textual decode — per-tool codecs restore types). Deps added exactly `react-router@8.5.0` + `zustand@5.0.16` (MIT, THIRD_PARTY rows); root engines floor raised to `>=22.22.0` (react-router engines). Tests: unit 22 → grew with tasks; e2e `tools.spec.ts` (fa redirect + 4 sidebar routes; en persisted) with the zero-console-error fixture. Ledger rulings R22 (engines), R23 (store becomes sole view-tree RPC consumer at T3).

**Task 2 worker + RPC:** complete. `apps/web/src/workers/dsp.worker.ts` (module worker) + `session/{protocol,ops,rpc}.ts`: wire = `{id, op, params, payload?: {buffer, byteOffset, byteLength}}` → `{id, ok, result: {meta?, payload?} | error | cancelled}`; one op-table extension rule (2 files); transport seam with a `MessageChannel`-class fake for Vitest (no real Worker in node); lazy worker init, HMR dispose, `terminate()` resolves pending; supersede by identical `op + canonicalJson(params)` resolves `{cancelled: true}` for the older call; cancel frames drop late frames; response payload buffers moved in the transfer list both directions (asserted at the `postMessage` level). Built worker answer verified in e2e preview (`dist/assets/dsp.worker-*.js`). Fix 3a4f2ee: transport-construction throw becomes typed async `workerUnavailable` rejection (React-effect crash path removed; retry rebuilds).

**Task 3 session store:** complete. Zustand store per spec §2.2: immutable `original {samples, sampleRateHz, name, sourceKind}`, `derived` cache keyed `op ‖ canonicalJson(params) ‖ inputHash(original)` (reset on new source), `jobs {progressPct|null, cancel}`, `selection` clamp/order, `backendOnline`. Guard codes `invalidType/notFinite/rateTooHigh/tooLong` (≤ 96 kHz, ≤ 300 s-equivalent). `packages/dsp/src/utils/hash.ts` = FNV-1a 64 over the PCM byte view (BigInt-reference-verified limb math; prime `1099511628211`, offset `14695981039346656037`). Rulings recorded: R25 main-thread hash exception accepted (checksum, once per load, synchronous-typed guard contract kept), R26 avalanche claim replaced by flip-bijectivity + mean-bits band [24, 40] (measured ≈ 30.4/64 — FNV's known 2-adic weakness), supersede/cancel can't clobber a live cache entry (callId + hash captured at call time). Carry-over: derived keys are params-only — first payload-dependent op must extend the key with a payload hash (caveat comment + R24).

**Task 4 waveform overview op:** complete. `packages/dsp/src/utils/peaks.ts` `computePeakBuckets` — exact overlap-free linear partition (Σ buckets = N), interleaved `min[k], max[k]` Float32Array, `RangeError` guards, empty → empty, all-nonFinite bucket → `[0,0]` (documented); golden-style hand vector + partition-identity property sweep. Worker op `waveformOverview` `{bucketCount, sampleRateHz}` (R28: meta self-describes from actual payload — `sampleCount`/`bucketCount` derived from byteLength, params cannot lie); store `deriveWithSource` posts a one-copy `.slice()` transfer (115.2 MB worst case, documented; source buffer proven intact post-transfer); `derive`/`deriveWithSource` share `openDerivedJob` (R29). Waveform stub page reads buckets via the store only.

**Closing:** 4/4 tasks done (commits 9610c6e → 8bd1bcd on `feat/wave-2-plan-01`). Final verifier: PASS — `pnpm check` exit 0 (dsp 892/892, web 90/90, scripts 13/13, i18n OK, biome 114 files), `pnpm e2e` 6/6 (offline harness, fa+en), golden rle/mdct regenerate byte-identical + pytest 8/8, dep freeze exact (+2 named deps + workspace link), no type-`any`/`@ts-ignore`/`console.log` in src. Carry-overs into plans 02–04: payload-dependent cache key (R24), `cancelledIds` pruning, detached zero-length descriptor typed as `badParams` (edge), `deriveWithSource` full-copy until chunked transfer needed, Vite `worker.format` revisit if a worker chunk needs ESM imports, fa stub copy owner-review at wave close.


## What's left

- **Wave 2 · Plan 02** `02-audio-sources-playback.md` — Tasks 1–4 complete (upload/ingest, offline lane + demo clips, microphone recording, dock player). Remaining plan-02 task: none — the plan is complete pending owner review of the shipped code.
- Wave 2 plans 03 (visuals: waveform/spectrogram) and 04 — see `docs/plans/README.md`; do not begin a later plan with failing checks.

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

Wave 2 plan 01 additions (machine-drafted, agent):

- `nav.*` (5 keys: landmark + 4 tool names)
- `tool.{waveform,spectrogram,fftview,generator}.{title,stub}` (8 keys)

Wave 2 plan 02 additions (machine-drafted, agent):

- `input.*` full key set (upload + offline lane + demo cards + errors, Tasks 1–2)
- `input.record.*` (Task 3 recording states: start `stop/elapsed/deniedHint/mediaError{{error}}/capReached`, absent hint, limit)
- `player.*` (Task 4 dock: title/play/pause/seek.back/seek.forward, time.pattern/time.aria, selection.pattern, empty.hint, loop.label/loop.unavailable, lane.{ingested,offlineBrowser,demoClip,recording,generated})

(Future Persian copy: every wave's fa strings land in this section until the owner reviews them.)

Wave 3 additions (machine-drafted, agent):

- `speed.*` (F06 speed/direction lab)
- `sampling.*` (F03 resampling/quantization/aliasing lab)
- `extent.*` (F07 signal-extent lab), `nav.extent`, `tool.extent.title`
- `reverb.*` (F10 reverse/reverb lab), `nav.reverb`, `tool.reverb.title`
- `spectrumEdit.*` (F09 spectrum editor), `nav.spectrumEdit`, `tool.spectrumEdit.title`

Wave 4 plan 01 additions (machine-drafted, agent):

- `codecLab.*` (F04 browser codec lab), `nav.codecLab`, `tool.codecLab.title`

Wave 4 plan 03 additions (machine-drafted, agent):

- `codecLab.real.*` (real-codec panel), `codecLab.error.*` (stable backend error codes)
- `metrics.*` (F05 metrics lab), `nav.metrics`, `tool.metrics.title`

Wave 5 plan 05 additions (machine-drafted, agent):

- `theory.*` (shared theory-panel shell), `filters.theory.*`, `ai.theory.*`
- `experiments.*`, `nav.experiments`, `tool.experiments.title`
- `input.demo.shareButton/shareAria/shareCopied/shareFailed`
- `filters.export.wav`, `ai.export.wav`, `codecLab.comparison.chart.exportPng/exportFailed`

## Next recommended step

Wave 5 plans 01–05 are complete on `feat/wave-5` (ML tools, filter lab, teaching layer). Next: **execute Wave 5 plan 06** — `docs/plans/wave-5/06-closeout.md` (full gates, backend/model/offline/Docker smoke, D-037–D-040, Persian review list, wave close-out). Do not begin while any check is failing.

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

### 2026-10-25 — Wave 1, plan 04 Task 5 (F04 MDCT toy lossy codec)

- Done: `packages/dsp/src/codecs/mdctCodec.ts` — `encodeMdct`/`decodeMdct` per prime-04 controller ruling R9 (`s = GM·2^(−E)`, floors 2^(−E)+1, Math.round ties, Int16 mask ±32768, empty-product GM = 1); R7 zigzag, R8 per-code-pair low/high split, ONE combined Huffman codebook over the concatenated (low ++ high) byte streams, in-memory container (no serialized payload — wave-4 scope); `stats.bitrateKbps = bitsTotal·sampleRateHz/sampleCount/1000` (R9 formula); 34 tests pinning the 512 kbps contract (random relRms 9.39e-5, impulse 1.29e-4, ≤ 0.05 peak amplitude), 48/96/128 kbps round trips (SNR 22–32 dB, strict quality monotonicity, pass-2 stability ≤ 3.5e-2), 8 kbps structural validity, rate-model edge cases (underflow stepFactor → 0 = total-loss cliff, pinned @1e17, silence exact zeros, tiny-length, empty), guards, corruption paths, determinism/no-mutation.
- Verified: `pnpm --filter @avalab/dsp test` 848/848 ✓ · `pnpm typecheck` ✓ · `pnpm lint` ✓ (biome 91 files) · `docs/ALGORITHMS.md` rows added for both functions.
- Interface delta on record: public functions are `encodeMdct`/`decodeMdct` (not `encodeMdctCodec`); `steps` is one flat Float64Array (one s per frame); `nonZeroFraction`/`entropyBitsPerCoefficient` stats deferred to wave 4; silence floor 2 bits/coeff under actual (non-ideal) Huffman accounting.
- **Flagged to owner (R9 rate-model collapse on tonal input, measured)**: step s is the geometric mean over ALL nonzero coefficients, so heavy-tailed frames (sine/DC/chirp) clip their dominant bins out of Int16 (40 clipped coefficients in one 440 Hz sine frame @512 kbps) → tonal inputs collapse to relRms 0.93–1.00 at ALL rates; flat-spectrum inputs (random/impulse) reach the contracted quality. This is the pinned ruling, implemented verbatim; per-band scale factors + F13 masking are the honest next rung if the collapse is unwanted. Also: dispatch text said bitsPerSample(128k) < bitsPerSample(48k), contradicting R9's own rate model — implemented the R9-consistent direction (strictly increasing) and flagged.

### 2026-10-25 — Wave 1, plan 04 Task 6 (F06 phase vocoder time-stretch + pitch-shift)

- Done: `packages/dsp/src/timestretch/phaseVocoder.ts` + barrel exports; `packages/dsp/test/timestretch/phaseVocoder.test.ts` (16 tests); `docs/ALGORITHMS.md` rows for `timeStretch`/`pitchShift`. No golden JSON by plan (no librosa reference for the phase-vocoder contract in this wave; property tests pin identity, lengths, content, guards).
- Verified: `pnpm --filter @avalab/dsp test` 865/865 ✓ (29 files) · `pnpm typecheck` ✓ · `pnpm lint` ✓ (biome 93 files) · `pnpm check` ✓.
- Debugging note on record: the identity test caught production leaking frame 0's Nyquist-bin value for even L (`halfBins = ⌈L/2⌉` skipped bin L/2 — now `⌊L/2⌋ + 1`). The plan's "neighbors ≤ −20 dB at ±3 bins" pin does NOT hold for stretch-2 output at any implementation variant (pre- and post-fix spectra identical): offsets ±1..±16 bins carry the 21.3 ms analysis-window skirt (hann main lobe ±187 Hz at 262144-point padding); the test asserts ≤ −20 dB at offsets ±32..128 padded bins (measured −26.5 dB) and documents the measured skirt instead.
- Deviation notes on record (also in the source header): (1) synthesis deviation scaled by the hop ratio H_s/H_a (standard Dolson; R11 literal line omits it); (2) pitchShift direction uses stretch `2^(+semitones/12)` and resample to `fs/2^(semitones/12)` — the literal R13 reading measured an inverted pitch (+12 → 220 Hz violating the plan's "+12 doubles the peak" contract), semitones 0 unchanged.

### 2026-10-26 — Wave 2, plan 02 Task 1 (F01 upload → ingest → session)

- Done: `apps/web/src/features/input/{ingest.ts,upload.tsx}` — typed ingest lane (courtesy size pre-check → POST /ingest → GET /audio/{id} → decode seam → mono downmix → `loadSource("ingested")`), backend envelope codes → `input.error.<code>` (unknown verbatim via `input.error.unknown`), lane errors `backendUnavailable` + translated recovery hint, store-flag discipline from the lane's own evidence; shared no-source empty state (sr-only input + a11y label + dropzone + `role="alert"` readout) wired into `/tools/waveform`. Plan-01 auto-seeded waveform probe retired (empty state now reachable); `routes.test.tsx` + `e2e/tools.spec.ts` adapted. i18n `input.*` full key set en+fa (fa machine-drafted — **needs human Persian review**); dynamic-key allowlist `input.error`.
- Verified: `pnpm check` exit 0 (dsp 892/892, web 111/111 incl. 20 ingest-lane tests, scripts 13/13, biome 118 files, i18n OK) · `pnpm e2e` 9/9 (incl. 3 new upload e2e over a route-stubbed API: fa+en success, fa 500-error path). Harness finding recorded: 4xx/5xx route fulfills always log one browser network error in Chromium; only 200 fulfills are console-clean.
- Concerns for owner: backend runtime upload cap not exposed by any endpoint (client mirrors the 100 MB default — over-rejects if env raised; suggest publishing it via /health); upload progress/cancel deferred (YAGNI); stereo playback deferred to Task 4; first biome a11y suppression precedent (documented dropzone ignore).
- Details in `.superpowers/sdd/02-audio-sources-playback/progress.md`.

### 2026-10-26 — Wave 2, plan 02 Task 2 (F01 offline lane + demo clips)

- Done: `apps/web/src/features/input/offline.ts` — offline decode lane `loadOfflineFile` (read bytes → Task 1's `browserDecodeWav` seam (no second decode implementation) → `monoDownmix` → `loadSource(..., "offlineBrowser")`), store guards the ONLY backstop, store codes → `input.error.<code>`, no `backendOnline` writes (no API call); `loadDemoClip(clipId)` fetches `/demo/<file>.wav` and loads through the SAME decode tail with `sourceKind: "demoClip"` (D-016 clips: 48 kHz 16-bit mono 5 s). `demo.tsx` demo cards live in the shared no-source empty state (one real labelled button per card, card not clickable); `failureReadout.tsx` shared `role="alert"` readout for both lanes. `WaveformStubOverview` readout now renders the REAL `meta.sampleCount` the worker derived (was the bucket count). `backendOnline` became observable: `HealthStatus` subscribes to the store flag (mount probe writes verdict via mark*; only local state is the probe-pending marker) — carry item 7(a) teeth: the empty state shows an "offline lane only" hint above the file button when the flag is down; the button's Task-1 error flow unchanged.
- Verified: root `pnpm check` exit 0 (dsp 892/892, web 128/128 incl. 13 offline-lane tests, scripts 13/13, biome 123 files, i18n OK) · `pnpm e2e` 11/11 (2 new demo e2e: fa+en card click → real worker-derived overview count, HealthStatus pill asserted, zero console errors). Harness finding: `decodeAudioData` resamples to the device AudioContext rate (48 kHz clip → ≈220.5 k samples at 44.1 kHz on the dev Mac) — e2e asserts a real non-trivial count, not a magic number; the exact count is device/browser-dependent (documented offline-lane codec variance).
- Deviations: no jsdom click test for the demo cards (repo pre-flight pins test deps; no jsdom installed) — lane wiring unit-tested node-side (fetch/decode/store seams injected) and the click covered by Playwright (real DOM, stronger). Plan's "sidebar empty-state" has no current surface (the sidebar has no empty state); demo cards went into the shared empty-state component per brief resolution.
- Needs owner Persian review: `input.offlineLaneOnly`, `input.demo.*` fa copy (machine-drafted).
- Details in `.superpowers/sdd/02-audio-sources-playback/progress.md`.

### 2026-10-26 — Wave 2, plan 02 Task 3 (F01 microphone recording → ingest)

- Done: `apps/web/src/lib/media.ts` + `features/input/record.tsx` — recorder seam state machine (`idle|requesting|requestingDenied|recording|processing|error(mediaError)|done(completed|capReached)`, all boundaries injectable, monotonic attempt id cancels grant races); 5-min cap through the same stop path (== store MAX_DURATION_SECONDS); cancel stops tracks; completed take → `ingestFile(..., sourceKind: "recording")` (`IngestOptions.sourceKind` typed override), capReached NOT uploaded + translated. Empty-state section: absent-devices honest hint, aria-live elapsed counter, stop/cancel. Machine failure states translated (`deniedHint`/`mediaError{{error}}`).
- NOTE: implementer crashed twice mid-dispatch (API outage); `media.ts` survived; remaining finished inline by controller. Gates: root `pnpm check` 0, web 139/139, dsp 892/892, e2e 14/14. E2e pins no permission prompt in CI (absent `mediaDevices` → translated disabled hint).
- Needs owner Persian review: `input.record.*`. UX note flagged: a failed upload of a completed take loses the take (re-record required).
- Details in `.superpowers/sdd/02-audio-sources-playback/progress.md`.

### 2026-10-27 — Wave 2, plan 02 Task 4 (F02 dock player: transport + playhead)

- Done: `apps/web/src/features/player/{transport.ts,playhead.ts,usePlayer.ts,player.tsx}` —
  - `transport.ts`: DOM-free player state machine `empty|ready{positionSample}|playing{startedAtSample}|stopped{positionSample}` with ALL seams injectable (`contextFactory, bufferFactory, nodeFactory, timeSource, onEnded, close`); node tests use recording fakes, app default is a real AudioContext. `setSource` builds the new AudioBuffer first, stops the old node, then swaps (§9: exactly ONE live AudioBufferSourceNode; store's mono lane + transport's buffer = ≤ 2 full-length buffers). Pause pins the interpolated position; play resumes from the pin, restarts from 0 at/past end; play-while-playing documented no-op; seek while playing restarts the node; zero-length source: `ready` elsewhere but `play()` no-op (Web Audio cannot make a 0-length AudioBuffer); stale `onEnded` detached at every stop; `dispose()` stops + closes. `playbackRate` field pinned 1 (F06 seam, Wave 3 plugs its speed control). Guards: non-finite args are documented no-ops (seek) / loud TypeErrors (malformed source, bad rate).
  - `playhead.ts`: tiny EventTarget-style pub-sub `appPlayhead` singleton — Plan 03 canvases subscribe; publish notifies only current listeners synchronously; late subscribers get no replay (pinned); non-finite guard; dispose clear + permanent inertness; app code never disposes it.
  - `usePlayer.ts`: mount-only machine effect (record.tsx StrictMode-safe pattern), `useSyncExternalStore` + useMemo EMPTY_STATE fallback (SSR-safe), source attach via `sourceToBufferLike(original)` in try/catch (exotic-rate `createBuffer` degradation keeps the tool tree alive; single-cast adapter, media.ts precedent; mono-at-source-rate playback documented — stereo stays owner question 4); exactly ONE rAF loop only while playing, publishing the interpolated head to `appPlayhead`.
  - `player.tsx`: `PlayerDock` — honest empty posture (disabled buttons + hint), back10/back5/toggle/forward5/forward10 order, reserved disabled loop stub (Wave 3 region-loop), throttled `mm:ss` readout (one setState per displayed second, NO second rAF; `dir="ltr"`, Latin digits), store-bound selection readout, lane badge `player.lane.<sourceKind>` (T2 carry landed). Layout placeholder → `<PlayerDock />`; `layout.player.upcoming` retired in en+fa. i18n nested `player.*` en+fa; dynamic allowlist `player.lane`.
- Verified: typecheck clean; `pnpm --filter @avalab/web test` 173/173 (incl. 28 transport + 6 playhead node tests with fake seams); `pnpm lint` clean (134 files; import organization + `role="timer"` a11y fix); `pnpm i18n:check` OK; root `pnpm check` exit 0 (dsp 892/892, scripts 13/13); `pnpm e2e` 16/16 (new `player.spec.ts`: fa+en — no-source posture → demo load arms dock + lane badge → REAL Web-Audio-clock readout reaches 00:01 → pause pins the displayed second, zero console errors).
- Notes for owner: fa `player.*` machine-drafted (Persian review); uniform documentation: playback of the ORIGINAL at full length only — derived/selected playback is Wave 3; loop-region toggle reserved disabled until a derived source exists.
- Details in `.superpowers/sdd/02-audio-sources-playback/progress.md`.

### 2026-10-25 — Wave 2 planning + plan 01 executed (app skeleton complete)

- Planning: owner-approved brainstorm → spec `docs/superpowers/specs/2026-10-25-wave-2-core-visuals-design.md` + four SDD plans `docs/plans/wave-2/01…04` + `docs/DECISIONS.md` D-018 (typed-message DSP worker, no Comlink; backend-first decode lane with offline fallback) + D-019 (per-tool routes, URL-encoded canonical params). Deps `react-router@8.5.0`, `zustand@5.0.16` (MIT, THIRD_PARTY rows); engines floor `>=22.22.0`.
- Plan 01 (`feat/wave-2-plan-01`, commits 9610c6e → 8bd1bcd): router/layout/URL-state; typed worker RPC over `session/{protocol,ops,rpc}.ts` (transfer lists both directions, supersede/cancel, built-worker answer proven in e2e); zustand session store (immutable `original`, derived cache keyed op+params+inputHash, `inputHashFnv1a64` in dsp, guard codes invalidType/notFinite/rateTooHigh/tooLong); `computePeakBuckets` + `waveformOverview` op + `deriveWithSource` (single-copy transfer path).
- Verified (independent verifier, this branch): `pnpm check` exit 0 (dsp 892/892, web 90/90, scripts 13/13, biome 114 files, i18n OK) · `pnpm e2e` 6/6 · golden rle+mdct regenerate byte-identical, pytest 8/8 · dep additions exact · no `any`/`@ts-ignore`/`console.log` in src.
- Key rulings on ledger: R22 engines; R23 store = sole view-tree RPC consumer; R24 params-only derived keys (caveat: first payload-dependent op must extend key); R25 main-thread hash exception accepted; R26 avalanche test contract = bijectivity + mean-bits band; R27 `computePeakBuckets` no clamp; R28 op meta self-describes from actual payload; R29 `derive`/`deriveWithSource` share `openDerivedJob`.
- Spec amendments: §2.3 wire shape `{meta?, payload?}` + transfer descriptor; §2.5 react-router v8 wording (commit 8bd1bcd).
- Carry-overs: cancelledIds pruning; detached zero-length descriptor typed `badParams` (edge); chunked transfer for `deriveWithSource` if per-call copies become hot; Vite `worker.format` revisit on ESM worker chunks; fa copy owner-review below.

## 2026-10-28 — Wave 2, plan 02 CLOSED (F01 audio sources + F02 dock player)

- Branch feat/wave-2-plan-02, 9 commits d600d27 → d4f7a3c (T1 ingest lane, T2 offline lane + demo clips, T3 microphone recording, T4 dock player + whole-plan fixes). Whole-branch review **Approved** (per-task reviews: T1, T2, T4 Approved/fixes→Approved; T3 reviewed as part of the branch sweep after implementer crashes). Independent verifier **8/8 PASS**.
- Commit d4f7a3c (review-driven): `browserDecodeWav` now parses the canonical WAV fmt-chunk rate and constructs `AudioContext({sampleRate: rawRate})` — the ingest lane no longer resamples to the device rate (48 kHz canonical stays 48 kHz on a 44.1 kHz machine). Malformed headers fall back to the previous device-rate path. This was an educational-correctness risk (store kept the device rate as "original").
- Owner decisions needed (carried, not blocking):
  1. Record-offline UX: a completed take uploaded while the backend is offline fails and LOSES the take (re-record required). Options: offline decode of the blob (Chromium can decode MediaRecorder containers) or a settled-offline gate on the record button.
  2. Parallel-landing race: demo card clicks during an active upload/recording — a settled `loadSource` from one lane silently replaces another's work (independent busy states; demo click mid-recording unmounts + disposes the take). Suggested: one shared store-level lane guard (plan 03 or F15).
  3. RecordSection fa copy + `input.*`/`player.*` Persian review (all flagged below).
  4. Stereo playback still mono via the shared JS-buffer path (mono downmix at source rate; TOOLS run on the downmix) — owner question 4 open, D-entry pending.
- Deviations (recorded in ledger): T4 brief "selection highlighted on the transport" shipped as read-only text readout — axis/canvas rendering belongs to plan 03; brief "keys" = natively keyboard-operable buttons (no global keymap until F18); documents both in `.superpowers/sdd/02-audio-sources-playback/progress.md:48`.
- Known-behave-UA facts: `decodeAudioData` device-rate resample now avoided on the ingest lane by construction; offline lane still documents device-rate variance (no WAV rate header guaranteed for arbitrary user files); Chromium e2e always logs one network error on 4xx/5xx route stubs (console-clean asserts moved to 200-fulfill paths).
- Carries into plan 03: parallel-landing guard; selection-canvas highlight (store selection now exercised); replayed playhead `appPlayhead` pub-sub (toString contract pinned); platform-rate e2e tolerance documented; record-offline decision above.

## 2026-11-01 — Wave 2, plan 03 CLOSED (F02 waveform + spectrogram)

- Branch `feat/wave-2-plans-03-04` (base `main` a4e1b7f after PR #7; owner's waveform/spectrogram-op commits 45a107c/eb0e529/4594b69 kept and completed). Commits: 01f0ea5 (chunked spectrogram view, route, i18n, e2e), c6411bf (a11y polish, compare slot, perf gates), docs commit.
- F02 shipped: waveform overview + zoomable detail (drag selection, `[`/`]` zoom, arrows, URL-encoded window), chunked spectrogram (window family/length, hop, colormap incl. colorblind-safe cividis, linear/log axis, dB floor display clamp, honest decimation notice), playhead sync on both canvases, A/B compare slot (honest "no processed source yet"), shared `formatDb/formatS`.
- Architecture: kept the owner's per-chunk `spectrogramTiles` op (bounded slice transfer, progressive paint); single-payload plan contract superseded — see D-020, which also records amplitude-referenced dB (0 dB = full-scale sinusoid, window-independent) instead of raw FFT magnitude. `frameStride` is the explicit column-decimation knob (caps 8192 frames / 4M cells).
- Gates: `pnpm check` exit 0 (dsp 900/900, web 191/191, scripts 13/13, i18n OK, biome clean); `pnpm e2e` 23/23 with real measured perf on the offline preview: overview first paint 209 ms (< 1000 ms gate), spectrogram first tiles 357 ms (< 3000 ms gate). Playwright now runs `workers: 1` so the perf gates are not CPU-contention noise.
- Carry-overs: derived-cache eviction still absent (wave-2 plan 01 note); compare slot renders the honest empty state until derived audio sources exist; fa copy for `waveform.*`, `spectrogram.*`, `compare.*` still needs owner review (listed in the Wave-2 fa review backlog; `fftview.*` and `generator.*` added by plan 04).
- **Next step:** Wave 2 plan `04-fourier-generator.md` (FFT view, window comparison, signal generator, wave close).

## 2026-11-01 — Wave 2, plan 04 CLOSED (F08 Fourier view + F12 generator)

- Branch `feat/wave-2-plans-03-04` (base `main` a4e1b7f). Commits follow the plan tasks: FFT ops/view, window comparison, generator, wave close.
- F08 shipped: `fftSelection` + `windowProfiles` ops (store → worker, one entry each), uPlot magnitude (dB/linear) and phase (wrapped/unwrapped) charts with a phase-mask threshold, window-family/length controls, measured window comparison chart + main-lobe/side-lobe table, URL-encoded settings (`w,n,m,p,mask`), cap notice for selections over 65 536 samples (D-021).
- F12 shipped: `generateSynth` op over the Wave-1 generators (sine/square/saw/triangle/impulse/step/white|pink noise/chirp log|linear/two-tone), live bucketed preview (no main-thread DSP), URL + localStorage settings, "load as source" through the guarded `loadSource(..., "generated")` lane. Works with no source loaded via the new source-free `deriveStandalone` store lane (D-021).
- Gates: `pnpm check` exit 0 (dsp 900/900, web 204/204, scripts 13/13, i18n OK, biome clean); `pnpm e2e` 27/27 with zero console errors in fa + en, including the FFT URL-reload test and the generator → waveform happy path. Perf gates re-measured on the same run (workers: 1).
- Docs: ALGORITHMS rows for `fftSelection`, `windowProfiles`, `generateSynth`; D-021 (analysis cap + source-free lane); `uplot` 1.6.32 (MIT) added to THIRD_PARTY; plans index marks wave 2 done.
- Carries into Wave 3: fa copy for `fftview.*` and `generator.*` needs owner review (added to the Wave-2 backlog); the Fourier view does not yet include the Cooley–Tukey butterfly step-through or a full-file STFT compare (F08 P0 subset, deferred); generator AM/FM and the Fourier-series harmonics slider stay Wave 4+ per the plan.
- **Next step:** owner review of wave-2 branch → PR to `main`; then plan Wave 3 (F03 sampling/bit depth, F07 signal extent, F09 Re/Im editor, F10 reverse/reverb, F06 speed).

## 2026-11-01 — Wave 3, plan 01 CLOSED (processed playback lane + F06 speed/direction)

- Branch `feat/wave-3` (base `main` `ada6da8`; plan docs `7d67baa`). Commits: `cd81f83` (store lane), `5bb82ae` (`speedTransform` op), `0d85d26` (A/B playback), `c3c8258` (speed lab), plus this close-out commit.
- F06 shipped: store-owned `processed` lane (`setProcessed`/`clearProcessed`/`setPlaybackMode`, `selectPlaybackSource`, typed `ProcessedErrorCode`, 300 s cap, `loadSource` reset); `speedTransform` worker op composing `resampleRational` (tape speed), `timeStretch` (pitch-preserving), optional `pitchShift`, and `reverse` last; dock A/B buttons with seconds-based playhead mapping that preserves play state; `/tools/speed` with URL codec (`sp,m,p,rv,from,to`), presets + custom speed, semitone input (disabled in resample mode), reverse, selection/first-30-s preview vs explicit whole-file apply, waveform + chunked spectrogram result, and the compare slot's processed pane.
- Semantics pinned by D-022: `speedFactor > 1` is faster; resample changes speed and pitch; time-stretch changes speed only; `meta.sampleRateHz` is the source rate; processed output above 300 s is rejected (`tooLong`), never truncated; `transport.ts` playbackRate seam remains unused.
- Gates: `pnpm check` exit 0 (dsp 900/900, web 225/225, scripts 13/13, i18n OK, biome 166 files); `pnpm e2e` 29/29 with zero console errors in fa + en, including both speed-lab locales and the five-route sidebar sweep. Perf on the same run: spectrogram first tiles 342 ms (< 3000 ms gate), overview first paint unchanged.
- Ledger ruling: the plan's Task 2 expectation "time-stretch 2× yields ~96 000 samples" inverted F06 speed semantics; the shipped test pins ~24 000 samples with pitch preserved (formula kept per plan).
- Carries: `speed.*` and the existing `player.*` Persian copy need owner review; the processed lane is intentionally not cached/evicted (tools recompute); a non-integer resample rate surfaces `resampleRational`'s `RangeError` as `opFailed` rather than `badParams` (latent, not reachable from the view's integer presets); the compare slot's original pane still renders the honest dash.
- **Next step:** Wave 3 plan 02 — `docs/plans/wave-3/02-sampling-bit-depth.md`.

## 2026-11-01 — Wave 3, plan 02 CLOSED (F03 sampling and bit depth)

- Branch `feat/wave-3`. Commits: `08fa4ce` (`aliasFrequencyHz`), `da87149` (`samplingProcess` + `aliasDemo` worker ops), `5ab3ca9` (sampling lab view + e2e), plus this close-out commit.
- F03 shipped: `/tools/sampling` with a URL codec (`tr,aa,bd,dt,seed,from,to`), target-rate presets + custom rate, anti-alias and TPDF-dither toggles, bit depth 1..16, selection/first-30-s preview vs explicit whole-file apply, measured SNR/segmental SNR/PSNR (peak 1.0 note)/theory SNR/MSE/duration, uPlot quantization-error chart, before/after mini waveforms, processed and residual playback, reset; source-free aliasing card (48 kHz sine, target 4/8/16 kHz, frequency 0..2×target, predicted and measured fold, play after a source exists).
- Semantics pinned by D-023: metrics compare the quantized output with the RESAMPLED reference; residual = reference − quantized; theory SNR is labelled as a full-scale-sine reference; the aliasing card is source-free.
- Gates: `pnpm check` exit 0 (dsp 907/907, web 240/240, scripts 13/13, i18n OK, biome 172 files); `pnpm e2e` 31/31 with zero console errors in fa + en, including both sampling-lab locales and the six-route sidebar sweep. Perf on the same run: overview first paint 342 ms (< 1000 ms), spectrogram first tiles 440 ms (< 3000 ms).
- Carries: `sampling.*` Persian copy needs owner review (added to the fa backlog); the aliasing card's play button appears only after a source is loaded because it installs into the shared processed lane; the compare slot is unchanged.
- **Next step:** Wave 3 plan 03 — `docs/plans/wave-3/03-signal-extent.md`.

## 2026-11-01 — Wave 3, plan 03 CLOSED (F07 signal extent)

- Branch `feat/wave-3`. Commits: `d5318c0` (`periodicExtend` dsp helper + golden), `090aea2` (ALGORITHMS row), `cb89b9a` (`extentProcess` worker op), `77dafe3` (extent lab view + e2e), plus this close-out commit.
- F07 shipped: `/tools/extent` with a URL codec (`op,sh,sf,ts,tl,ps,pe,rp,from,to`), identity/shift/time-scale/reverse/truncate/zero-pad/periodic-extension operations, selection-or-first-30-s preview vs explicit whole-file apply, readouts (duration, sample count, support range, energy, average power, energy/power badge, Δf), support-highlighted before/after waveforms, sequential before/after uPlot spectra, periodic-extension card, processed playback, reset, and compact observe bullets.
- Semantics: energy/power are amplitude-squared (the UI prints “full-scale²” for normalized sources); `timeScale` intentionally has no anti-alias filter and the UI points to F03; zero-padding is labelled interpolation (same main-lobe width, denser sampling), not improved resolution; truncation widens the main lobe and Δf is `fs/N` of the transformed length.
- Gates: `pnpm check` exit 0 (dsp 919/919, web 256/256, scripts 13/13, i18n OK, biome 176 files); `pnpm e2e` 33/33 with zero console errors in fa + en, including both extent-lab locales and the seven-route sidebar sweep. Perf on the same run: overview first paint 219 ms (< 1000 ms), spectrogram first tiles 302 ms (< 3000 ms).
- Carries: `extent.*` Persian copy needs owner review (added to the fa backlog); the view runs the before- and after-spectrum analyses sequentially because identical concurrent RPC params supersede each other; freehand/brush editing and full theory panels remain deferred.
- **Next step:** Wave 3 plan 04 — `docs/plans/wave-3/04-reverse-reverb.md`.

## 2026-11-01 — Wave 3, plan 04 CLOSED (F10 reverse + reverb)

- Branch `feat/wave-3`. Commits: `7f00fc5` (`generateSyntheticIr`), `12c41c2` (`reverbProcess` + `convolutionSteps` ops), `dc136a0` (reverb lab + e2e), plus this close-out commit.
- F10 shipped: `/tools/reverb` with a URL codec (`ir,rt,du,sd,pd,wm,me,from,to`), synthetic room/hall/plate/telephone IRs plus uploaded WAV IRs (mono downmix, ≤ 10 s, resampled to the source rate), pre-delay, wet/dry mix, FFT/direct method, selection-or-first-30-s preview vs explicit whole-file apply, IR waveform + spectrum, result waveform + spectrogram, FFT-vs-direct timing card, convolution flip-and-slide step card, reverse before/after magnitude/phase card, processed playback, and compact observe bullets.
- Semantics pinned by D-024: synthetic IRs are deterministic per seed and energy-normalized; uploaded IRs keep their own level and are rate-converted with `resampleRational`; output length is `preDelay + N + M − 1`; direct convolution is limited to 2 s excerpts; reverse and reverb stay separate operations.
- Gates: `pnpm check` exit 0 (dsp 926/926, web 273/273, scripts 13/13, i18n OK, biome 182 files); `pnpm e2e` 35/35 with zero console errors in fa + en, including both reverb-lab locales and the eight-route sidebar sweep. Perf on the same run: overview first paint 382 ms (< 1000 ms), spectrogram first tiles 479 ms (< 3000 ms).
- Ledger ruling: the reverse card and the IR spectrum both analyse 65 536 samples; identical concurrent `fftSelection` params supersede each other through the params-only RPC key, so the reverse card uses Hann and the IR spectrum Hamming. Any future view with two same-length spectra must vary a param or run them sequentially.
- Carries: `reverb.*` Persian copy needs owner review; uploaded IR level is not normalized by design; the result spectrogram shows the first 30 s with an explicit note.
- **Next step:** Wave 3 plan 05 — `docs/plans/wave-3/05-spectrum-editor.md`.

## 2026-11-01 — Wave 3, plan 05 CLOSED (F09 Re/Im spectrum editor)

- Branch `feat/wave-3`. Commits: `754ad66` (`spectrumEdit` dsp module + presets + tests), `4353d6c` (NumPy golden fixture + ALGORITHMS row), `a60dbfb` (`spectrumEdit` worker op + packing tests), `fe80c39` (state/view/route/sidebar/i18n/e2e), plus this close-out commit.
- F09 shipped: `/tools/spectrum-edit` with a URL codec (`h,ed,from,to`), band builder (Hz → bins, target Re/Im/magnitude/phase, zero/scale/set), edit list with remove/clear, seven presets, Hermitian toggle with complex-output warning and imaginary-energy ratio, uPlot charts for Re/Im/magnitude/phase, 200 ms debounced worker derive, capped selection with notice, and processed-lane playback; five golden presets at rtol 1e-12.
- Semantics pinned by D-025: rectangular analysis frame (bin edits are unambiguous), next-power-of-two zero-pad, Hermitian ON mirrors and keeps output real; OFF computes the complex IFFT, reports `Σ(Im x)²/Σ(Re x)²`, and plays the real part as a labelled teaching mode; freehand brush stays deferred.
- Gates: `pnpm check` exit 0 (dsp 951/951, web 286/286, scripts 13/13, i18n OK, biome 188 files); `pnpm e2e` 37/37 with zero console errors in fa + en, including both spectrum-editor locales and the nine-route sidebar sweep. Perf on the same run: overview first paint 393 ms (< 1000 ms gate), spectrogram first tiles 537 ms (< 3000 ms gate).
- Test-infra ruling: the web Vitest timeout is 15 s (was Vitest's 5 s default) because the nine-route static-render sweep and one phase-vocoder op test legitimately exceeded 5 s under full-suite CPU contention; no assertion was weakened.
- Carries: `spectrumEdit.*` Persian copy needs owner review (added to the fa backlog); the default range analyses the first 65 536 samples and the hint says so, while the cap notice appears only when an explicit longer range is requested; full-band `linearPhase`/`randomPhase` presets expand to one edit per bin, so their share URLs can be very large (future fix: encode preset name + seed); `present.md` (owner-friendly digest dated 2026-10-26) arrived in `754ad66` and still needs an owner keep/remove decision.
- **Next step:** owner review of the completed Wave 3 branch → PR to `main`.

## 2026-11-01 — Wave 3 audit close-out (F03/F06/F07/F10)

- Independent review of `git diff origin/main...HEAD` found seven integration defects; all fixed in this audit commit:
  - Reverb IR panel now pins `wetMix=1`/`preDelayMs=0`, so it shows the raw IR instead of a mixed delta.
  - Reverse card reverses the same 65 536-sample analysis window it compares, instead of reversing the whole slice and analysing its tail.
  - Uploaded-IR spectrum now maps Hz with the IR's own sample rate.
  - Player selection readout uses the original source rate, not the active processed-lane rate.
  - A/B playhead mapping clamps to `lengthSamples - 1`, so switching lanes at the end no longer restarts from zero.
  - The waveform tool maps the active-lane playhead back into original-source samples, so a processed lane at another rate no longer misplaces the playhead.
  - Aliasing demo receives the same frequency clamped to `2 * targetRateHz` that the readout displays.
- Reverb conv-step chart now formats its sample-index x axis as integers, not Hz; extent spectra copy only the 65 536-sample analysis frame they use.
- Extent `extentProcess` now returns `beforeSupportStartSample`/`beforeSupportEndSample`, and the before waveform highlights support as the plan requires.
- Speed e2e now waits for the demo source to settle before clicking a preset; the prior 36/37 run was a race, not a product failure.
- Gates: `pnpm check` exit 0 (dsp 951/951, web 286/286, scripts 13/13, i18n OK, biome 188 files); `pnpm e2e` 37/37 with zero console errors in fa + en. Perf on that run: overview first paint 396 ms (< 1000 ms), spectrogram first tiles 495 ms (< 3000 ms).
- Carries: all Wave 3 Persian copy still needs owner review; `present.md` still needs a keep/remove decision; full-band phase presets can produce very large share URLs (future fix: encode preset + seed); freehand spectrum drawing and full theory panels remain deferred; extent/reverb mini-waveform envelopes still bucket on the main thread (move to a worker envelope before whole-file 96 kHz sources); a pre-existing Wave 2 FFT phase-mask bug treats already-dB magnitudes as linear, so the default phase chart can be blank (fix separately).
- **Next step:** owner review and PR `feat/wave-3` → `main`.

## 2026-11-01 — Wave 3 merged (PR #9)

- `main` fast-forwarded `ada6da8..834b426` (merge of `feat/wave-3`): 27 commits, 63 files, +11,357/−98. Wave 3 plans 01–05 are done and the audit fixes from `3224638` are in.
- Re-verified on merged `main`: `pnpm check` exit 0; `pnpm e2e` 37/37 with zero console errors in fa + en; perf overview first paint 243 ms, spectrogram first tiles 326 ms.
- Removed stale `present.md` (dated 2026-10-26, pre-Wave-2 close); recoverable from `754ad66`. Updated `docs/plans/README.md` Wave 3 status.
- Carries unchanged: Wave 3 Persian review, huge full-band phase preset share URLs, pre-existing Wave 2 FFT phase-mask bug, main-thread waveform envelopes, deferred freehand/theory panels.

## 2026-11-02 — Wave 4 plans written (F04/F05/F06)

- Added `docs/plans/wave-4/README.md` plus four executable plans:
  `01-browser-codec-lab.md`, `02-backend-real-codecs.md`,
  `03-real-codec-ui-and-metrics.md`, `04-comparison-rate-distortion-closeout.md`.
- Pinned decisions D-026…D-031: reuse `/ingest` with a 16-bit PCM excerpt;
  cross-correlation delay/trim; PSNR peak 1.0 and 20 ms segmental frames;
  `/health.codecs`; F06 verify-only; 30 s sequential comparison batch.
- No code or dependencies changed. Next: execute plan 01.

## 2026-11-02 — Wave 4 plan 01 complete (F04 browser codec lab)

- Tasks 1–4 complete on `feat/wave-4`: PCM/WAV seam (`15d80ce`), `codecLabProcess` worker op (`827995e`), `/tools/codec-lab` view + URL state + en/fa copy (`8f34c54`), and Persian/English e2e (`05f8389`).
- The lab runs RLE, canonical Huffman, delta+Huffman, μ-law, A-law, and the MDCT toy codec in the worker; it shows bit-exact status, size/bitrate/ratio, entropy, MSE/SNR/segmental SNR/PSNR, byte histogram, Huffman code lengths, and MDCT sparsity/frame count. Lossless round-trips are bit-exact on the Int16 PCM grid; companding and MDCT are labelled lossy.
- Stats convention: `bitsPerSample = 8·compressedSizeBytes/N`; Huffman/delta count the 256-byte codebook table; MDCT counts the Huffman table plus 8 bytes per frame step. PSNR uses peak 1.0 and segmental SNR 20 ms frames (D-028). The op caps a processed selection at 30 s (`badParams`); this is a preview decision, not a codec limit.
- Test-infra fix: the phase-vocoder noise check no longer calls a matcher per sample (192 k samples exceeded its 24 s timeout); it now fails fast on the first non-finite sample and still asserts the same 10× RMS bound. Focused file 16/16.
- Gates: `pnpm check` exit 0 (dsp 966/966, web 298/298, scripts 13/13, biome 194 files, i18n OK); `pnpm e2e` 40/40 (1.1 min), zero console errors in fa + en.
- Carries: `codecLab.*` Persian copy needs owner review; if the measured 30 s MDCT worker time exceeds the §9 budget, lower the cap and record it; `e2e/tools.spec.ts` still names “nine routes” although `TOOL_IDS` now holds ten (codec lab has its own spec). No real-codec UI yet — plans 02–04.
- **Next step:** execute Wave 4 plan 02 — `docs/plans/wave-4/02-backend-real-codecs.md`.

## 2026-11-02 — Wave 4 plan 02 complete (F04 backend real codecs)

- Tasks 1–4 complete on `feat/wave-4`: codec specs/probe (`206dce9`), delay alignment (`21b8162`), `POST /api/v1/codec/encode` (`5a2b244`), and `/health.codecs` + regenerated OpenAPI/TS client (`4f5f133`).
- Shipped: `codecs.py` resolves WAV/FLAC/MP3/AAC/Opus/Vorbis from `ffmpeg -encoders`, validates per-codec params, and encodes with fixed argument arrays. `alignment.py` finds delay by normalized FFT cross-correlation, returns the trim offsets and count, and the route stores only the aligned decoded excerpt under a fresh `audio_id`. Lossless bit-exactness is checked after alignment on the Int16 PCM reference; lossy results are never labelled exact.
- Codec availability on the dev Mac (ffmpeg 9.0.2): `wav`, `flac`, `mp3`, `aac`, `opus`, `vorbis`. Native experimental Vorbis rejects mono, so its spec encodes as stereo and the decode path downmixes back to mono; `/health.codecs` reports it and the route round-trips it.
- Measured encode time, 30 s 44.1 kHz mono, one run each: WAV 70 ms, FLAC 92 ms, MP3 231 ms, AAC 389 ms, Opus 196 ms, Vorbis 304 ms. Faster than the §9 interaction budget for the default excerpt; these are single-run observations, not a benchmark suite.
- Health/API contract: `GET /health` now returns `{status, version, ffmpeg, codecs}`; OpenAPI includes `/codec/encode`, `CodecEncodeRequest`, `CodecEncodeResponse`; `client.ts` exports `CodecName`, `CodecParams`, `CodecEncodeRequest`, `CodecEncodeResponse`.
- Test-infra fix: `test_codecs.py` clears the process-wide `available_encoders` cache around every test; without it a mocked empty probe leaked into the route tests when both files ran in one process.
- Gates: backend `pytest` 133/133, `ruff` clean, `mypy` clean (25 source files); `pnpm check` exit 0 (dsp 966/966, web 298/298, scripts 13/13, i18n OK); `pnpm e2e` 40/40, zero console errors in fa + en.
- Carries: Docker ffmpeg codec availability is not verified in this session — the runtime probe and `/health.codecs` degrade honestly, and a missing encoder returns `codec_unavailable`. Real-codec UI/e2e belongs to Plan 03. No perceptual metric (PESQ/ViSQOL) in this wave. No new Persian strings in Plan 02.
- **Next step:** execute Wave 4 plan 03 — `docs/plans/wave-4/03-real-codec-ui-and-metrics.md`.

## 2026-11-02 — Wave 4 plan 03 complete (F04 real-codec panel + F05 metrics)

- Tasks 1–5 complete on `feat/wave-4`: backend excerpt lane/cache (`d5da56b`), real-codec panel + URL state + copy (`1be1f11`), metrics wrapper and `/tools/metrics` (`c76cabf`), metrics/real-codec e2e (`d2af73c`), and this close-out.
- Shipped: the codec lab uploads only the selected mono 16-bit PCM excerpt through `/ingest`, calls `/codec/encode`, fetches the aligned WAV, and shows size/bitrate/delay/bit-exactness plus MSE/SNR/segmental SNR/PSNR. `/health.codecs` disables missing encoders with a translated hint; with no backend the real card stays disabled and says offline. `/tools/metrics` compares the original and processed lanes only when rates and lengths match, and always shows the PSNR peak = 1.0 note.
- Gates: `pnpm check` exit 0 after Task 3 (dsp 966/966, web 316/316, scripts 13/13, biome 199 files, i18n OK); `pnpm e2e` 43/43 (51 s), zero console errors in fa + en. Backend untouched in this plan, so its Plan 02 results stand.
- Carries: `codecLab.real.*` and `metrics.*` Persian copy needs owner review. The metrics view computes the full-buffer metrics on the main thread; plan 03 mandates this wrapper, but a 5-minute comparison may warrant a worker op later. Real-codec e2e covers only the no-backend degradation path; pytest and unit tests cover the live backend. Metrics for arbitrary processed lanes cannot show compression ratio/bitrate/entropy (no codec metadata); the codec lab keeps those stats.
- **Next step:** execute Wave 4 plan 04 — `docs/plans/wave-4/04-comparison-rate-distortion-closeout.md`.

## 2026-11-02 — Wave 4 plan 04 Task 3 (F06 verified)

- Extended `apps/web/e2e/speed.spec.ts` on `feat/wave-4`: resample 2× halves the demo duration to 2.500 s and disables semitones; time-stretch 2× also halves it and enables semitones; +12 semitones at 1× time-stretch keeps 5.000 s; both locales stay at zero console errors.
- F06 shipped in Wave 3 Plan 01; Wave 4 Plan 04 only added coverage and made no implementation change. Verified with `pnpm e2e` 45/45 (1.5 min) after the Task 2 comparison test landed.
- **Next step:** finish Wave 4 close-out (full gates, measured batch time, docs).

## 2026-11-02 — Wave 4 plan 04 complete + Wave 4 CLOSED (F04/F05/F06)

- Tasks 1–4 complete on `feat/wave-4`: comparison model/table (`adedbb0`), batch runner + rate–distortion chart (`5e13c2e`), F06 e2e verification (`2bd2352`), and this close-out.
- Shipped: the codec lab builds `handwrittenRow`/`realRow` records, sorts errors last then by bitrate, and offers Copy CSV (fixed 3 decimals, `Infinity`/`NaN` literals). “Run comparison” executes the default list (RLE, Huffman, delta+Huffman, μ-law, A-law, MDCT 64/128/256 kbps, then available real codecs) sequentially on a 30 s-capped excerpt, appends rows as each point completes, reports `completed/total`, and cancels by stopping the queue and aborting the in-flight backend request. Failed points stay as translated error rows. The uPlot scatter plots finite SNR or PSNR against actual stream bitrate with labelled axes in LTR; lossless `∞` points stay in the table but not the chart.
- Measured in the static-preview e2e (no backend, 5 s chirp): the full 8-point hand-written batch filled 8 rows and the chart in 6.8 s wall-clock including page load and assertions. This is an e2e observation, not a 30 s/real-codec benchmark.
- Codec availability (dev Mac ffmpeg 9.0.2): `wav`, `flac`, `mp3`, `aac`, `opus`, `vorbis`; `/health.codecs` disables missing encoders. With no backend the batch still runs the hand-written points and the real card shows the translated offline note.
- F06 verified, not changed: resample and time-stretch both halve the demo duration at 2× (2.500 s), semitones are disabled only in resample mode, and +12 semitones at 1× time-stretch keeps 5.000 s; fa + en, zero console errors.
- Gates: `pnpm check` exit 0 (biome 205 files, dsp 966/966, web 327/327, scripts 13/13, i18n OK); `pnpm e2e` 45/45 (1.5 min), zero console errors in fa + en, perf overview 325 ms (< 1000 ms) and spectrogram first tiles 407 ms (< 3000 ms). Backend: `pytest` 133/133, `ruff` clean, `mypy` clean (25 source files).
- Carries: Persian review backlog covers `codecLab.*` (including `comparison.*`), `metrics.*`, and `speed.*`. `realRow` and `/tools/metrics` compute metrics on the main thread (same wrapper ceiling; move to a worker op if a 5-minute comparison visibly blocks). Real-codec e2e remains offline-only in the static preview; pytest/unit tests cover the live lane. Docker ffmpeg codec availability is still unverified. No perceptual metric in the chart. `e2e/tools.spec.ts` still says “nine routes” although there are now more tools.
- Wave 4 is closed with no push. **Next step:** plan Wave 5 — Intelligence & teaching (F14 ML jobs, F11 filters UI, F16 education); owner review of the Persian copy is still pending.

## 2026-11-03 — Wave 5 plan 01 complete (F14 ML platform)

- Tasks 1–6 complete on `feat/wave-5`: CC0 demo assets (`ff644f6`), ML settings/optional extra (`e5140e6`), pinned model registry + downloader (`c22d52f`), bounded jobs + SSE routes (`c929219`), AI lab shell + job client (`03dcd75`), and this close-out.
- Shipped: five pinned tasks (`denoise`, `superres`, `separation`, `asr`, `neural-codec`) with `GET /models`; an in-process max-1 job manager with queue cap, TTL purge, cancel, and SSE events (`progress|done|error|cancelled`); `POST /ml/{task}`, `GET /jobs/{id}/events`, `DELETE /jobs/{id}`; a 30 s server-enforced excerpt cap; and one `/tools/ai` shell with five URL-synced tabs, model availability banner, run/cancel, progress, result JSON, and backend-absent disabling.
- Generated artifacts: `apps/api/openapi.json` and `apps/web/src/api/schema.d.ts` now include the ML routes and models. `pnpm gen:api` exports the app schema directly; it does not require a live server despite the plan wording.
- Models remain uninstalled in this session. The registry, downloader, and gated real-model tests are ready, but no live encode/denoise/separation/ASR/neural-codec job was executed. Plans 02–03 install and wrap the loaders; Plan 06 runs the real smoke.
- Gates: `pnpm check` exit 0 (dsp 966/966, web 342/342, scripts 13/13, i18n OK, biome 212 files); `pnpm e2e` 45/45 in 1.0 min with zero console errors in fa + en, including `/tools/ai` in both locales and the backend-absent disabled run control; perf overview first paint 219 ms (< 1000 ms) and spectrogram first tiles 348 ms (< 3000 ms). Backend `pytest` 151/151, `ruff` clean, `mypy` clean (37 source files). Demo assets `fetch_f14.py --check` OK (4 assets).
- Carries: `ai.*` Persian copy needs owner review. Real model loading is deferred to Plans 02–03. D-032–D-036 are now in `docs/DECISIONS.md`; D-037–D-040 stay in the Wave-5 README until Plan 06 close-out. The AI client uses a deliberate plain-fetch seam, so the regenerated OpenAPI types are not yet consumed by the view.
- **Next step:** execute Wave 5 plan 02 — `docs/plans/wave-5/02-denoise-superres.md`.

## 2026-11-03 — Wave 5 plan 02 complete (F14 denoise + super-resolution)

- Tasks 1–6 complete on `feat/wave-5`: DPDFNet adapter (`bf44536`), denoise A/B tab (`6520158`), LavaSR adapter (`3575a3c`), sinc baseline op (`751e2b9`), super-resolution tab + e2e (`6ff49c4`), and docs/real smoke (this close-out commit). Two small fixes rode along: recorder idle snapshot (`210396b`) and ML type-check imports (`c740139`).
- Shipped denoise: `/tools/ai?task=denoise` loads the CC0 noisy speech demo, uploads a ≤30 s excerpt, runs DPDFNet at 48 kHz, restores the source rate and exact input length, shows input/output RMS, and compares original/noisy/denoised through the store's processed lane. Missing model and offline backend disable the run with translated hints.
- Shipped super-resolution: `/tools/ai?task=superres` band-limits to 8/12/16 kHz with `resampleRational(..., "kaiserSinc")`, restores the sample rate at the source rate, and compares original/band-limited/restored. The sinc path is the classical baseline and works offline; LavaSR runs as a backend job and adds the AI-approximation caption. `?task=superres&demo=speech` auto-loads the speech demo.
- Comparison protocol: the source is capped at 30 s; one worker pass downsamples with the anti-alias filter, a second restores the sample count at the source rate; LavaSR receives exactly that band-limited source-rate buffer. All three lanes share start sample, length, and rate. For the sinc path the band-limited and restored lanes are intentionally identical: the filter restores rate, never the removed band. The optional LavaSR `denoiser_core.onnx` remains off so the experiment isolates bandwidth extension.
- Real-model smoke on the local CPU laptop, cached weights, `HF_HUB_OFFLINE=1`: `AVALAB_RUN_ML_TESTS=1 ... pytest -q -m ml` → 2 passed, 172 deselected in 1.55 s. Live API + Vite dev UI: denoise RMS −29.5 dB → −30.8 dB; superres model input `8–48 kHz`, output `48 kHz`; both jobs completed and the caption rendered with zero console errors. The e2e suite still stubs the backend, so this live run is the plan's CPU smoke.
- Gates: `pnpm check` exit 0 (biome 220 files, dsp 966/966, web 356/356, scripts 13/13, i18n OK); `pnpm e2e` 47/47 in 1.2 min with zero console errors in fa + en; perf overview first paint 450 ms (< 1000 ms) and spectrogram first tiles 614 ms (< 3000 ms). Backend `pytest` 172 passed / 2 skipped, `ruff` clean, `mypy` clean (41 source files).
- Carries: `ai.superres.*` Persian copy joins the Wave-5 review backlog; D-037–D-040 stay in the Wave-5 README until Plan 06 close-out; LavaSR's ONNX repo still has no license field; full-file ML is unsupported by design; the three super-resolution A/B lanes reuse the single processed lane instead of extending the store.
- **Next step:** execute Wave 5 plan 03 — `docs/plans/wave-5/03-separation-asr-codec.md`.

## 2026-11-03 — Wave 5 plan 03 complete (F14 separation, ASR, neural codec)

- Tasks 1–7 complete on `feat/wave-5`: htdemucs separation adapter (`2680939`), separation tab (`7f1deee`), Whisper ASR + WER (`acc4e2a`), ASR tab (`c3a2498`), Encodec adapter (`85aa086`), neural-codec tab + rate–distortion point (`507f87f`), EnCodec stereo fix (`2d63be3`), and this docs/smoke close-out.
- Shipped separation: `/tools/ai?task=separation` runs htdemucs through a 15 s excerpt (30 s server cap), stores four stems in the fixed order `drums, bass, other, vocals`, and lets the student load any stem into the processed lane. Mono is duplicated to stereo for the model; output rates and lengths are explicit. Slow CPU jobs show an honest wait message and cancel through the shared job client.
- Shipped ASR: `/tools/ai?task=asr` transcribes the bundled English speech demo through Whisper tiny at 16 kHz. The reference transcript is fetched from `/demo/speech-kathleen-19s.txt` only for the matching demo; WER is computed client-side with NFKC, lower-case, punctuation-to-space, whitespace-collapsed normalization and the `(S+D+I)/N` word-level formula. Missing/empty reference is shown as a state, not scored as zero. Empty or silent audio returns a translated job error.
- Shipped neural codec: `/tools/ai?task=neural-codec` rounds a mono excerpt through `facebook/encodec_48khz` at 1.5/3/6/12/24 kbps, returns decoded audio at the source rate and exact length, shows estimated size/bitrate (labelled as estimates), and adds one `encodec-<bw>kbps` point to the existing codec rate–distortion chart using the same SNR definition. Codec-lab rows already produced by the user are appended as context; no automatic codec batch is triggered.
- Real-model smoke: `AVALAB_RUN_ML_TESTS=1 HF_HUB_OFFLINE=1 uv run --directory apps/api --extra ml pytest -q -m ml` → 5 passed, 198 deselected in 13.2 s on cached CPU weights. The smoke covered DPDFNet, LavaSR, HTDemucs, Whisper tiny, and EnCodec. The first EnCodec run failed because the 48 kHz processor expects stereo; the adapter now duplicates mono to stereo and downmixes the decoded output, with a non-gated fake-backend regression test (`2d63be3`).
- Gates: `pnpm check` exit 0 (biome 229 files, dsp 966/966, web 383/383 across 39 files, scripts 13/13, i18n OK); `pnpm e2e` 47/47 in 1.1 min with zero console errors in fa + en; perf overview first paint 224 ms (< 1000 ms) and spectrogram first tiles 333 ms (< 3000 ms). Backend `pytest` 198 passed / 5 skipped, `ruff` clean, `mypy` clean (47 source files). Model cache: all five pinned models present (`--check` OK); Plan 03 weights were downloaded in this session (total cache ≈383 MB).
- Carries: `ai.asr.*` and `ai.neuralCodec.*` Persian copy joins the Wave-5 review backlog. Whisper tiny is weak for Persian; the WER experiment stays on the bundled English demo. EnCodec exposes no real bitstream, so size/bitrate remain estimates. Full-file ML is still unsupported by design. The e2e suite stubs the backend; the gated pytest smoke is the real CPU evidence. D-037–D-040 still move to Wave-5 README close-out in Plan 06; no push.
- **Next step:** execute Wave 5 plan 04 — `docs/plans/wave-5/04-filter-lab.md`.

## 2026-11-03 — Wave 5 plan 04 complete (F11 filter lab)

- Tasks 1–5 complete on `feat/wave-5`: `filterDesign` op (`71956df`), `filterApply` op (`d88aa2b`), URL/localStorage state (`57669b2`), the filter-lab view + route + copy (`39ab768`), and this e2e/docs close-out.
- Shipped `/tools/filters`: FIR/window, Butterworth, Chebyshev I, and RBJ biquad design with kind-aware bands; magnitude (dB), unwrapped phase, group delay, impulse, step, and pole-zero plots (pure SVG, LTR in both locales); stable/unstable badge and an omitted-roots note above 33 FIR taps; apply-to-selection (the first 30 s when the selection is the whole source) or apply-to-all through `filterApply`, installing the result in the processed A/B lane. Invalid cutoffs are rejected inline and disable the design; unstable IIR designs are flagged and never applied. No new DSP math: the ops compose the Wave-1 filter library.
- Delay handling: linear-phase FIR reports `floor(taps/2)` and the preview trims it; the causal IIR response is not trimmed, and the UI says so. Apply uses the exact coefficient arrays from the settled design.
- Performance measurement for the 30 s design budget: pure `filterDesign` on the dev laptop (257-tap Kaiser FIR, Butterworth order 8, Chebyshev I order 8, peaking biquad) measured **2.4 / 22.1 / 25.2 / 0.5 ms** per design (10-run average); the worst path is far below the 300 ms §9 gate. Design still runs in the worker with a 150 ms debounce.
- Gates: `pnpm check` exit 0 (biome 238 files, dsp 966/966, web 406/406 across 43 files, scripts 13/13, i18n OK); `pnpm e2e` 49/49 in 1.1 min, zero console errors in fa + en; the new filter spec covers the chirp demo, all six panels, kind/band/cutoff URL round-trips, invalid-cutoff rejection, apply-to-selection, and English apply-to-all with LTR axes.
- Carries: `filters.*` Persian copy joins the Wave-5 owner-review backlog. FIR roots are omitted above 33 taps (documented in the UI); biquad supports only lowpass/highpass/notch/peaking; whole-file FIR apply returns the same length as the source because preview delay compensation is on. Backend untouched in this plan.
- **Next step:** execute Wave 5 plan 05.

## 2026-11-04 — Wave 5 Docker close-out fixes

- Fixed `docker/web.Dockerfile`: the web image now copies `packages/dsp` source before `pnpm --filter @avalab/web build`. The package exports `./src/index.ts`, so the stale "not a build dependency" comment was wrong and the image build failed without the source.
- Fixed `docker/api.Dockerfile`: both `uv sync` layers install the `ml` extra (D-033) and use a uv cache mount. Linux torch/torchaudio now resolve from the PyTorch CPU index (D-037), removing CUDA packages and `triton` from the image.
- Gates run in this session: `docker compose build api web` succeeds; API image 1.12 GB, web image 109 MB. `docker compose up -d` reports API healthy. `/api/v1/health` → `ffmpeg: true`, codecs `wav, flac, mp3, aac, opus, vorbis`. `/api/v1/models` lists all five pinned models with `state: missing` (clean cache; honest, no network fetch). Web root returns 200 and the Caddy `/api` proxy returns the same health payload. Browser check against the Docker stack loaded the pink-noise demo (`5.000 s` readout) and opened `/tools/ai` with zero console errors.
- Caveat: host port 8080 is occupied by Homebrew Apache locally; the smoke used a temporary `18080:80` override outside the repo. Models were not cached in the Docker smoke, so `/tools/ai` run controls stay disabled; the model/offline smoke and CPU latency table were already done in `957e54d`. Remaining close-out work is plan Task 4 docs and Task 5 final verification.
- **Next step:** execute `docs/plans/wave-5/06-closeout.md` Task 4.

## 2026-11-03 — Wave 5 plan 05 complete (F16 teaching layer)

- Tasks 1–7 complete on `feat/wave-5`: theory framework + KaTeX (`ddde811`), F11 theory (`d827933`), F14 theory (`86bd062`), guided experiments (`32e6f10`), demo share links (`a62dcb9`, docs checkbox fix `3b07dc1`), WAV/PNG export (`e604e77`), and this e2e/docs close-out.
- Shipped `/tools/filters` and all five `/tools/ai` tabs with collapsible theory panels: original academic sections, original formulas rendered LTR by KaTeX, “what to observe” bullets, and pitfalls. Failing TeX throws in tests; no raw HTML path.
- Shipped `/experiments` with three guided experiments (filters, super-resolution, ASR + codec) and 11 deep links into real controls. Each step states the expected observation; links carry URL-serialized tool params. Sidebar and both locales included.
- Shipped demo share-by-URL: each bundled demo card copies an absolute URL with tool params plus `demo=<id>`; on load the app validates the id from the closed union, boots the demo once per navigation, and never serializes uploads. `SessionSource.demoId` is optional and file sources stay undefined.
- Shipped user-triggered exports: `filters.export.wav` (`avalab-filters.wav`), `ai.export.wav` (`avalab-ai-<task>.wav`), and `codecLab.comparison.chart.exportPng` (`avalab-rate-distortion.png`). WAV uses `encodeWavPcm16`; PNG captures the uPlot canvas and rejects an empty canvas.
- E2E covers both locales: experiments, theory + KaTeX LTR, demo share clipboard → navigation → one demo request, WAV header (RIFF/WAVE/48000/16), PNG signature, and all five AI theory panels. The first run correctly exposed that the filter lab's empty state has no controls or theory panel; the spec now boots the demo before asserting them.
- Gates: `pnpm check` exit 0 (biome 256 files, dsp 966/966, web 438/438 across 51 files, scripts 13/13, i18n OK); `pnpm e2e` 52/52 in 1.2 min with zero console errors in fa + en. Plan 05 touched no backend code; its Plan 03 backend results stand.
- Carries: `theory.*`, `filters.theory.*`, `ai.theory.*`, `experiments.*`, `input.demo.share*`, and export copy join the Wave-5 Persian review backlog. The share bootstrap is mounted on demo-row pages only, so `/tools/ai?demo=…` does not boot a demo (super-resolution keeps its own speech-demo link); accepted because share buttons exist only on demo-row pages. Filtered AI results also show the AI WAV button; accepted simplification. D-037–D-040 still move to Wave-5 README close-out in Plan 06.
- **Next step:** execute Wave 5 plan 06 — `docs/plans/wave-5/06-closeout.md`.
