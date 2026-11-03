# Wave 5 · Plan 05 — Teaching layer (F16)

**Status:** pending.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** F16 for Wave 5: theory panels for F11/F14, three guided experiments, share-by-URL for bundled demo clips, and WAV/PNG export. Older labs get theory in Wave 6.

**Architecture:** `features/theory/` owns a small KaTeX panel with sections and LTR formula rendering. `features/education/` owns experiment data and `/experiments`. `lib/share.ts` builds share URLs from tool params plus an optional `demoId`; `SessionSource` gains an optional `demoId`, and the demo loader passes it. Export helpers live in `lib/download.ts` and use existing WAV encoding/uPlot canvases.

**Tech Stack:** `katex` (MIT), React, uPlot, existing `encodeWavPcm16`, `lib/url-state`.

**Spec:** `AGENTS.md` F16, §6; `docs/plans/wave-5/README.md` D-036, D-038.

## Global Constraints

- Theory copy is original, concise, academic; cite textbooks by reference only.
- Formulas render LTR in both locales; surrounding prose follows the locale direction.
- Share URLs encode only tool params and bundled demo ids; never user audio.
- Unknown demo ids/params fall back field-by-field.
- Exports are user-triggered; no background downloads.
- All strings through i18n; Persian flagged for review.

## Review Focus

1. **Math safety** — KaTeX renders only our strings; no raw HTML injection; malformed formulas fail visibly in tests.
2. **Share safety** — uploads never enter the URL; demo id is a closed union; unknown id falls back.
3. **Demo boot** — a shared demo URL loads once, does not loop, and does not overwrite a user-loaded file on later navigation.
4. **Export correctness** — WAV header/rate/length match the processed source; PNG is non-empty and LTR.
5. **Experiment honesty** — each step has an expected observation and uses real controls; no fake results.

---

### Task 1: Theory framework and KaTeX

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml`
- Create: `apps/web/src/features/theory/TheoryPanel.tsx`
- Create: `apps/web/src/features/theory/Formula.tsx`
- Create: `apps/web/src/features/theory/TheoryPanel.test.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`

**Interfaces:**
- `TheoryPanel` props: `{ titleKey: string; sections: readonly { headingKey: string; bodyKey: string; formula?: string }[] }`.
- `Formula` props: `{ tex: string; display?: boolean }`; uses `katex.renderToString` with `throwOnError: true`, `output: "html"`, wrapped in `dir="ltr"`.
- Accessible `<details>`/`<summary>` or section structure; no raw HTML.

- [x] **Step 1: Add `katex` + `@types/katex`; run install.**
- [x] **Step 2: Write failing tests** for formula rendering, LTR wrapper, section headings, and invalid TeX throwing in test mode.
- [x] **Step 3: Implement components and add `theory.*` shell keys.**
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Commit** `feat(F16): add theory panel and KaTeX formula`.

### Task 2: F11 theory content

**Files:**
- Create: `apps/web/src/features/filters/filterTheory.ts`
- Modify: `apps/web/src/features/filters/filterLabView.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`

**Interfaces:**
- Sections: transfer function `H(z)=B(z)/A(z)`, FIR window method, IIR Butterworth/Chebyshev, group delay, pole-zero stability.
- “What to observe” bullets: cutoff vs transition width, order vs ringing, linear-phase FIR delay, poles near unit circle.
- Pitfalls: cutoff above Nyquist, unstable IIR, confusing phase delay with group delay.

- [x] **Step 1: Write a data test** asserting every section has fa/en keys and every formula is non-empty.
- [x] **Step 2: Run** focused test — expected FAIL.
- [x] **Step 3: Implement content in both locales; place the panel in the filter lab.**
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Commit** `feat(F16): add filter theory panel`.

### Task 3: F14 theory content

**Files:**
- Create: `apps/web/src/features/ai/aiTheory.ts`
- Modify: `apps/web/src/features/ai/aiLabView.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`

**Interfaces:**
- Per-tab theory keys: denoise (spectral masking/learned suppression), super-resolution (bandwidth extension vs interpolation), separation (masking/source reconstruction), ASR (acoustic model + WER), neural codec (RVQ/bitrate/distortion).
- Each panel: one formula or block diagram description, 1–2 paragraphs, “what to observe”, pitfalls, “AI approximation” caption.

- [x] **Step 1: Write a data test** for five tabs × fa/en keys and non-empty content.
- [x] **Step 2: Run** focused test — expected FAIL.
- [x] **Step 3: Implement content and render the panel per tab.**
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Commit** `feat(F16): add AI tool theory panels`.

### Task 4: Guided experiments and route

**Files:**
- Create: `apps/web/src/features/education/experiments.ts`
- Create: `apps/web/src/features/education/experiments.test.ts`
- Create: `apps/web/src/features/education/experimentsView.tsx`
- Create: `apps/web/src/features/education/experimentsView.test.tsx`
- Modify: `apps/web/src/app/routes.tsx`
- Modify: `apps/web/src/app/sidebar.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`

**Interfaces:**
- `Experiment = { id: "filters" | "superres" | "asr-codec"; titleKey; goalKey; steps: { instructionKey; observationKey; link?: { path; search } }[] }`.
- E1: low-pass cutoff/order → ringing/group delay.
- E2: downsample to 8 kHz → sinc vs LavaSR.
- E3: encode speech at several bitrates → ASR transcript/WER.
- `/experiments` route lists three cards; each step links to the relevant lab with params.
- Sidebar `nav.experiments`; no new dependency.

- [x] **Step 1: Write data tests** for three experiments, non-empty steps, valid links, and fa/en key parity.
- [x] **Step 2: Write view tests** for cards, steps, and links.
- [x] **Step 3: Run** focused tests — expected FAIL.
- [x] **Step 4: Implement data/view/route/sidebar/i18n.**
- [x] **Step 5: Run** `pnpm check` — expected PASS.
- [x] **Step 6: Commit** `feat(F16): add guided experiments`.

### Task 5: Demo share-by-URL

**Files:**
- Create: `apps/web/src/lib/share.ts`
- Create: `apps/web/src/lib/share.test.ts`
- Modify: `apps/web/src/session/store.ts`
- Modify: `apps/web/src/features/input/offline.ts`
- Modify: `apps/web/src/features/input/demo.tsx`
- Create: `apps/web/src/features/input/demoDeepLink.ts`
- Create: `apps/web/src/features/input/demoDeepLink.test.ts`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`

**Interfaces:**
- `DemoClipId` extends the current union with `"speech" | "speechNoisy" | "music"`.
- `SessionSource.demoId?: DemoClipId`; `loadSource(..., demoId?)` stores it; all other callers unchanged.
- `loadDemoClip` passes `clip.id` into `loadSource`.
- `buildShareUrl({ path, params, demoId? }): string` uses `encodeParams`; no audio bytes.
- `demoDeepLink` reads `?demo=`, validates the id, loads once per navigation, and removes nothing from the URL.
- Demo row gets a “Copy share link” button per clip; uploads never show it.

- [x] **Step 1: Write tests** for round-trip, unknown demo fallback, no upload serialization, one-load guard, and `demoId` stored on the source.
- [x] **Step 2: Run** focused tests — expected FAIL.
- [x] **Step 3: Implement the store/loader/share/deep-link changes and UI.**
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Commit** `feat(F16): add demo share links`.

### Task 6: WAV and chart PNG export

**Files:**
- Create: `apps/web/src/lib/download.ts`
- Create: `apps/web/src/lib/download.test.ts`
- Modify: `apps/web/src/features/filters/filterLabView.tsx`
- Modify: `apps/web/src/features/ai/aiLabView.tsx`
- Modify: `apps/web/src/features/codecLab/rateDistortionChart.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`

**Interfaces:**
- `downloadWav(samples: Float32Array, sampleRateHz: number, filename: string): void` uses `encodeWavPcm16`.
- `downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): Promise<void>`; rejects on empty canvas.
- `downloadChartPng(uplot: uPlot, filename: string): Promise<void>` wraps the plot canvas.
- F11/F14 add “Export WAV”; plots add “Export PNG”; filenames are locale-free ASCII.

- [x] **Step 1: Write tests** for WAV header, filename sanitization, empty canvas rejection, and PNG non-empty blob.
- [x] **Step 2: Run** focused tests — expected FAIL.
- [x] **Step 3: Implement helpers and buttons.**
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Commit** `feat(F16): add WAV and PNG export`.

### Task 7: E2E, i18n, docs

**Files:**
- Create: `apps/web/e2e/education.spec.ts`
- Modify: `apps/web/e2e/tools.spec.ts`
- Modify: `docs/PROGRESS.md`

- [ ] **Step 1: E2E** `/experiments`, theory panel, demo share link load, WAV/PNG download, both locales, zero console errors.
- [ ] **Step 2: Run** `pnpm check`, `pnpm e2e` — expected PASS.
- [ ] **Step 3: Update `PROGRESS.md` and flag Persian copy.**
- [ ] **Step 4: Commit** `test(F16): verify teaching layer`.

## Completion Gate

- Theory panels render for F11 and all five F14 tabs.
- Three experiments with expected observations and working links.
- Share link loads a bundled demo once; uploads never shareable.
- WAV and PNG exports valid.
- Both locales, RTL, formulas LTR, zero console errors.
