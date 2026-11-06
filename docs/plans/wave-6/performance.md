# Wave 6 Plan 05 — Measured performance

## Method

- Harness: `apps/web/e2e/performance.spec.ts` (Playwright, Chromium, static
  `vite preview` with the API absent, so every browser tool runs its offline
  path).
- Input: deterministic 5-minute mono WAV, 44.1 kHz, 16-bit PCM, two tones
  (440 Hz + 1 kHz) with low deterministic noise, generated in the test process
  and never committed.
- Three consecutive runs on the same machine. The table reports the median and
  the min–max range.
- Timings use `performance.now()` in the page. The file-change, decode-start,
  decode-done, and first-waveform marks are written by the page itself, so CDP
  file-transfer time and fixture generation are outside the timed window.
- The test gates only stable 2× upper bounds; this report records the real
  values.

## Device

| Item | Value |
|---|---|
| CPU | Intel Core i9-8950HK @ 2.90 GHz (6 logical cores reported by the browser) |
| OS | macOS 15.8.2 |
| Browser | Playwright Chromium 156 headless |
| Memory | 32 GB reported by `navigator.deviceMemory` |
| Node / pnpm | Node 22.23.3, pnpm 11.21.0 |

## Results

| Measurement | AGENTS §9 budget | Test gate (2×) | Median | Range (3 runs) |
|---|---:|---:|---:|---:|
| File change → waveform overview | diagnostic | — | 856.3 ms | 855.2–866.3 ms |
| `decodeAudioData` of the 5-minute WAV | diagnostic | — | 201.1 ms | 195.4–202.4 ms |
| Waveform overview after decode | < 1 000 ms | 2 000 ms | **304.4 ms** | 293.0–313.6 ms |
| Spectrogram overview | < 3 000 ms | 6 000 ms | **174.5 ms** | 160.6–189.7 ms |
| FFT of a 30 s excerpt | < 300 ms | 600 ms | **173.0 ms** | 166.9–173.8 ms |
| MDCT encode+decode, 10 s | 300 ms not viable (fallback) | 6 000 ms | **1 380.3 ms** | 1 365.0–1 410.8 ms |
| FIR filter, 30 s excerpt | < 300 ms | 600 ms | **140.6 ms** | 139.9–160.1 ms |
| Reverb, 30 s excerpt | 300 ms not viable (fallback) | 2 000 ms | **1 404.0 ms** | 1 403.9–1 405.9 ms |
| Pipeline, 30 s excerpt | < 300 ms | 600 ms | **252.7 ms** | 248.3–254.4 ms |
| Loudness, 5-minute source + 30 s processed | no explicit AGENTS budget | 10 000 ms | **368.3 ms** | 363.6–370.4 ms |

Worker-side details (median):

| Measurement | Worker time | Remainder |
|---|---:|---|
| FFT 30 s | 119.5 ms (bins) | +53.5 ms paint |
| MDCT 10 s | 1 028.1 ms (encode 414.7 + decode 613.4) | click/transfer/UI |
| Reverb 30 s | 678.5 ms | 250 ms debounce + transfer/render |
| Pipeline 30 s | 134.5 ms | transfer/render |
| Loudness | measured inside the 368.3 ms total | — |

## Budget outcomes

### Passing budgets

- Waveform overview after decode is 304 ms against the 1 s budget. The full
  file-change path is 856 ms; it includes the 201 ms browser decode plus store
  update and first paint.
- Spectrogram overview is 175 ms against 3 s.
- FFT of a 30 s excerpt is 173 ms against 300 ms.
- FIR filtering is 141 ms against 300 ms.
- Pipeline is 253 ms against 300 ms.
- Loudness takes 368 ms for the 5-minute original plus the 30 s processed lane.

### Documented fallbacks

**MDCT 10 s — 1 380 ms total, 1 028 ms worker.** The teaching codec is
deliberately O(frameCount·N²): 10 s at 44.1 kHz is 431 frames of a 1024×2048
basis, and the same matrix is used forward and inverse. A 300 ms live budget is
not mathematically possible without replacing the educational direct MDCT with
a different FFT-based transform. Encoding is an explicit button, not a slider,
so the test gates a stable 6 s upper bound instead. The measured encode/decode
times are shown in the Codec Lab result panel.

**Reverb 30 s — 1 404 ms total, 679 ms worker.** The 30 s preview convolved with
the 0.6 s room IR is 41 overlap-add blocks; the remaining time is the 250 ms
input debounce plus transfer and paint. The 300 ms target applies to slider
paths where mathematically possible; this explicit apply is heavier. The test
gates 2 s. A 30 s reverb on a 5-minute file is still far below the file length
and runs in the worker with progress/cancel semantics.

## Optimizations made in this task

1. **Session hash** — `inputHashFnv1a64`'s byte loop took 4.75 s for the
   52.9 MB 5-minute buffer. `inputHash64` now hashes two 32-bit FNV-1a lanes
   over the `Uint32Array` word view and finishes each with MurmurHash3 fmix32.
   This removed the post-decode overview stall (2.09 s → ~0.3 s).
2. **Spectrogram scheduling** — the view posted all ~51 chunk jobs at once, so
   a later FFT request queued behind stale chunks on the worker's single event
   loop. `workerJob.ts` now keeps one chunk in flight and requests the next in
   `finally()`, so cancel is effective between chunks.
3. **Inverse FFT** — ``ifft`` now delegates power-of-two spectra to
   ``ifftRadix2`` (one conjugated complex pass) instead of running two forward
   transforms and combining them.
4. **FFT plans** — `convolveFft` builds one radix-2 plan per call and reuses it
   for every block. The butterfly loop uses range-proven direct indexing; the
   helper-call version made room convolution 1.49 s vs 0.54 s.
5. **Convolution block choice** — `convolveFft` now uses a 4096-sample minimum
   default block, and kernels of 8 taps or fewer use the direct sum. The
   pipeline's default 3-tap FIR dropped from 1.95 s to 253 ms total.
6. **Short kernels** — the direct fallback keeps `convolveFft`'s existing
   length and numeric contract; the property tests against `convolveDirect`
   still cover both paths.

## Notes and limits

- The browser reports `hardwareConcurrency = 6`; the test is single-worker, so
  these are single-core-ish numbers on one performance core plus browser
  overhead.
- The 5-minute file is 52.9 MB of PCM; larger inputs are outside the F02/F01
  contract.
- The test also asserts zero console errors for the whole flow.
- Re-run with:
  `pnpm --filter @avalab/web build && pnpm --filter @avalab/web exec playwright test performance.spec.ts`
  (the preview server serves the built `dist`; rebuild after DSP changes).
