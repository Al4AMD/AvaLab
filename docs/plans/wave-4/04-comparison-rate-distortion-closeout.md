# Wave 4 · Plan 04 — Comparison, rate–distortion, F06 close-out

**Status:** done (2026-11-02; commits `adedbb0`, `5e13c2e`, `2bd2352`, plus this close-out).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One comparison table and one rate–distortion chart put every
hand-written and real codec side by side (bitrate, compression ratio, SNR,
PSNR, encode time, bit-exactness). The batch runner encodes a 30 s excerpt
sequentially, reports progress, and cancels cleanly. F06 time-stretch/pitch
is verified with e2e coverage and marked done. The wave closes with docs and
all gates green.

**Architecture:** `features/codecLab/comparison.ts` owns the pure row/point
model and sorting. `features/codecLab/comparisonRunner.ts` owns the
sequential batch over the existing `codecLabProcess` worker op and
`runRealCodec` backend lane. `features/codecLab/rateDistortionChart.tsx` is a
thin uPlot scatter. The codec lab view hosts the table, chart, and batch
controls. No new dependencies.

**Tech Stack:** As Wave 3. Existing `uplot`. New deps: none.

**Spec:** `AGENTS.md` F04, F05, F06, §9; `docs/DECISIONS.md` D-029–D-031.

## Global Constraints

- The comparison batch uses one 30 s excerpt for every point.
- Runs are sequential: one worker op or one backend call at a time. The
  worker op cannot be interrupted mid-transform; cancel stops scheduling and
  aborts the in-flight backend call.
- Points with non-finite SNR/PSNR (`Infinity` for lossless identical) are
  excluded from the chart but remain in the table with `∞`.
- The chart is LTR in both locales; axes have units (kbps, dB).
- All strings through i18n; fa machine-drafted + flagged.
- `pnpm check` + `pnpm e2e` green; both locales; zero console errors.

## Review Focus

1. **Comparable points** — every row is built from the same excerpt; bitrate
   is the actual stream bitrate, not the requested preset; ratio uses the
   same `originalBytes = 2N`.
2. **Batch determinism** — the same selection and codec list produce the same
   rows in the same order; a failed point is recorded as an error row, not a
   silently missing point.
3. **Cancel** — cancel stops the queue, aborts the in-flight backend request,
   and leaves the completed rows visible.
4. **Chart honesty** — lossless points with `∞` quality are not plotted;
   axes are labeled; the chart does not interpolate between unrelated codecs.
5. **F06 verification** — at 2× speed both resample and time-stretch halve
   the duration; time-stretch preserves pitch while resample changes it.
   Pitch-shift +12 changes pitch but preserves duration. The existing
   implementation is not rewritten.

---

### Task 1: Comparison model and table

**Files:**
- Create: `apps/web/src/features/codecLab/{comparison.ts,comparison.test.ts}`
- Modify: `apps/web/src/features/codecLab/codecLabView.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`

**Interfaces:**
- `export type ComparisonFamily = "handwritten" | "real";`
- `export type ComparisonRow = { id: string; family: ComparisonFamily; codec: string; labelKey: string; bitrateKbps: number; compressionRatio: number; snrDb: number; psnrDb: number; encodeMs: number; bitExact: boolean; lossless: boolean; sampleCount: number; errorKey?: string; };`
- `export function handwrittenRow(meta: CodecLabMeta, labelKey: string): ComparisonRow`
  — uses `meta.bitrateKbps`, `meta.compressionRatio`, `meta.snrDb`,
  `meta.psnrDb`, `meta.encodeMs`, `meta.bitExact`, `meta.sampleCount`;
  `lossless` = codec is `rle | huffman | deltaHuffman`.
- `export function realRow(run: RealCodecRun, codec: RealCodecName, labelKey: string): ComparisonRow`
  — uses `stats`; `encodeMs` is backend encode time only.
- `export function sortComparisonRows(rows: readonly ComparisonRow[]): ComparisonRow[]`
  — errors last; then `bitrateKbps` ascending; tie by `labelKey`.
- `export function comparisonToCsv(rows: readonly ComparisonRow[]): string`
  — header + rows; numbers fixed to 3 decimals; `∞` as `Infinity`; no
  localized strings. Used by a “Copy CSV” button (clipboard API; translated
  success/failure status).
- Codec lab view adds a comparison card:
  - Table columns: method, family, bitrate kbps, ratio, SNR dB, PSNR dB,
    encode ms, bit-exact, lossless.
  - Rows come from the last hand-written result and the last real result.
  - Empty state hint; error rows show the translated error key.
  - “Copy CSV” button; no download dependency.

- [ ] **Step 1: Write failing tests** for row construction, lossless flag,
  sorting (errors last, bitrate asc), CSV escaping (commas/quotes), and
  `∞` formatting.
- [ ] **Step 2: Run** `pnpm --filter @avalab/web test -- comparison` — expected FAIL.
- [ ] **Step 3: Implement** the model + table + i18n
  (`codecLab.comparison.*`).
- [ ] **Step 4: Run** `pnpm check` — expected PASS.
- [ ] **Step 5: Commit** `feat(F04): add codec comparison table`.

### Task 2: Batch runner and rate–distortion chart

**Files:**
- Create: `apps/web/src/features/codecLab/{comparisonRunner.ts,comparisonRunner.test.ts,rateDistortionChart.tsx}`
- Modify: `apps/web/src/features/codecLab/codecLabView.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`

**Interfaces:**
- `export type ComparisonRequest = { kind: "handwritten"; codec: CodecLabCodec; mdctBitsPerSecond: number } | { kind: "real"; codec: RealCodecName; params: RealCodecParams };`
- `export const COMPARISON_EXCERPT_SECONDS = 30;`
- `export function defaultComparisonRequests(availableReal: readonly RealCodecName[]): ComparisonRequest[]`
  — hand-written: RLE, Huffman, deltaHuffman, μ-law, A-law, MDCT at 64, 128,
    256 kbps; real: available codecs at their default params (MP3/AAC/Opus
    128 kbps, Vorbis quality 5, FLAC level 5, WAV none).
- `export async function runComparison(input: { samples; sampleRateHz; startSample; endSample }, requests, options: { runHandwritten: (request) => Promise<CodecLabMeta>; runReal: (request) => Promise<RealCodecRun>; signal?: AbortSignal; onProgress?: (completed, total, row) => void }): Promise<ComparisonRow[]>`
  - Sequential; checks `signal.aborted` before each request; a failed request
    becomes an error row (`errorKey`) and the batch continues.
  - No worker/backend calls inside this module; the view injects the two
    runners.
- `export function rateDistortionPoints(rows): { bitrateKbps: number[]; snrDb: number[]; labels: string[] }`
  — finite, positive bitrate and finite SNR only; stable order.
- `RateDistortionChart` props: `{ rows; heightPx? }` — uPlot scatter,
  `dir="ltr"`, x label “bitrate (kbps)”, y label “SNR (dB)”, points with
  labels in the legend. No line interpolation; no new dep.
- View:
  - Comparison card gains “Run comparison” and “Cancel”.
  - Progress text `completed/total`; completed rows render immediately.
  - Chart below the table; quality metric selector SNR/PSNR (PSNR finite
    points only).
  - On cancel: stop queue, abort backend, keep rows.
  - Batch uses `COMPARISON_EXCERPT_SECONDS` capped by the source length and
    the current excerpt start.

- [ ] **Step 1: Write failing tests** for default requests, sequential order,
  abort before the first request, failure → error row, progress callback,
  and finite point filtering.
- [ ] **Step 2: Run** `pnpm --filter @avalab/web test -- comparisonRunner` — expected FAIL.
- [ ] **Step 3: Implement** runner + chart + view wiring + i18n
  (`codecLab.comparison.run/cancel/progress/chart.*`).
- [ ] **Step 4: Run** `pnpm check` — expected PASS.
- [ ] **Step 5: Commit** `feat(F05): add comparison batch and rate-distortion chart`.

### Task 3: F06 verification

**Files:**
- Modify: `apps/web/e2e/speed.spec.ts`
- Modify: `docs/PROGRESS.md`, `docs/plans/wave-3/README.md` (status note only)

- [ ] **Step 1: Extend e2e**:
  - Resample 2×: duration halves, semitone control disabled.
  - Time-stretch 2×: duration halves, semitone control enabled.
  - Pitch-shift +12 in time-stretch mode: duration unchanged, result card
    visible, no console errors.
  - Both locales; zero console errors.
- [ ] **Step 2: Run** `pnpm e2e -- speed` — expected PASS.
- [ ] **Step 3: Mark F06 verified** in `PROGRESS.md`; note that Wave 3 plan 01
  shipped it and Wave 4 only added coverage.
- [ ] **Step 4: Commit** `test(F06): verify time-stretch and pitch shift`.

### Task 4: Wave close-out

**Files:**
- Modify: `docs/plans/wave-4/README.md`, `docs/plans/README.md`,
  `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/ALGORITHMS.md`,
  `docs/THIRD_PARTY.md`

- [ ] **Step 1: Run** full gates:
  - `pnpm check`
  - `pnpm e2e`
  - `uv run --directory apps/api pytest -q`
  - `uv run --directory apps/api ruff check .`
  - `uv run --directory apps/api mypy .`
- [ ] **Step 2: Record** measured comparison batch time, chart behavior,
  codec availability, and fa-review backlog.
- [ ] **Step 3: Update** all plan statuses to done, the wave table in
  `docs/plans/README.md`, and the next recommended step (Wave 5).
- [ ] **Step 4: Commit** `docs(F04/F05/F06): close wave 4`.

## Definition of Done

- Comparison table and rate–distortion chart work with hand-written and real
  codecs.
- Batch is sequential, cancellable, and reports errors as rows.
- F06 e2e verifies time-stretch, resample, and pitch-shift.
- All gates green; docs updated; no push.

## Carries

- No perceptual metric in the chart.
- Real-codec points are absent when the backend is offline; the table shows
  the hand-written points and an offline note.
- Persian copy for `codecLab.comparison.*` needs owner review.
