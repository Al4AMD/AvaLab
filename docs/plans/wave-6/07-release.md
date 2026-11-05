# Wave 6 Plan 07 — Persian Report, Slides, and Release Gate

## Metadata

- Spec: [`design.md`](design.md) §11–§12
- Depends on: plans 00–06
- Scope: Persian A4 report, 16:9 slides, screenshots, PDF build/verification, final acceptance
- Out of scope: publishing, pushing, tagging, or committing unless the owner explicitly asks
- Owner inputs needed: report PDF commit approval, final Persian review, university details

## Global constraints

- Persian prose; Latin formulas, code, paths, and numeric readouts in LTR islands.
- Self-hosted Vazirmatn only; no third-party CDN.
- No pandoc/tectonic/typst; Playwright Chromium `page.pdf()`.
- Generated PDFs go to `docs/deliverables/`; commit only with owner approval.
- Demo media must be self-generated, public domain, or CC0.
- AI figures use cached/precomputed outputs; the report build must not depend on a live model run.
- No commit, push, tag, or deploy without explicit owner instruction.

## Review focus

1. **Academic correctness:** formulas, units, definitions, and course mapping are right.
2. **Persian quality:** natural academic prose, correct RTL shaping, consistent terminology.
3. **Build determinism:** fixed viewport, fixed demo clips, no live API/model dependency.
4. **PDF integrity:** fonts embedded, page count stable, no clipped or overflowed text.
5. **Honesty:** limitations, approximations, model provenance, and measured numbers are stated.

## File map

Create:
- `docs/report/index.html`
- `docs/report/report.css`
- `docs/report/assets/` (figures, diagrams, precomputed AI screenshots)
- `docs/report/content/` (section HTML fragments if needed)
- `docs/slides/index.html`
- `docs/slides/slides.css`
- `docs/slides/assets/`
- `docs/build-pdfs.mjs`
- `docs/capture-report-assets.mjs`
- `docs/deliverables/.gitkeep`
- `docs/REPORT.md` (build/run notes)

Modify:
- `package.json` (add `build:docs`)
- `README.md`
- `docs/PROGRESS.md`
- `docs/DECISIONS.md` (report build decision)
- `docs/THIRD_PARTY.md` (fonts/media provenance)

## Task 1 — Report scaffold and shared PDF builder

**Files:** `docs/report/*`, `docs/build-pdfs.mjs`, `package.json`

1. Static HTML/CSS, no framework:
   - `index.html` with semantic sections;
   - `report.css` with `@page { size: A4; margin: 18mm 16mm; }`, print colors, page breaks, RTL base, `dir="ltr"` islands for formulas/numbers;
   - fonts referenced from `apps/web/public/fonts/Vazirmatn-*.woff2`.
2. `build-pdfs.mjs`:
   - Node 22 ESM;
   - resolve Playwright from `apps/web` via `createRequire(fileURLToPath(new URL("../apps/web/package.json", import.meta.url)))` (cwd-independent);
   - start a local static HTTP server rooted at the repo;
   - open the report and slides pages with `chromium`;
   - set `locale: "fa-IR"`, fixed viewport, `deviceScaleFactor: 1`;
   - wait for `document.fonts.ready` and all images;
   - fail on console errors, page errors, failed requests, or missing fonts;
   - assert no horizontal overflow (`scrollWidth <= clientWidth`) and every `.page`/`.slide` fits;
   - `page.pdf({ printBackground: true, preferCSSPageSize: true })`;
   - write `docs/deliverables/avalab-report-fa.pdf` and `docs/deliverables/avalab-slides-fa.pdf`;
   - close browser and server in `finally`.
3. Add root script `build:docs`: `node docs/build-pdfs.mjs`.
4. Build once and confirm both PDFs are non-empty.

## Task 2 — Report content

**Files:** `docs/report/index.html`, assets

Required sections, in Persian:

1. **Cover:** project name, course names, owner, date, version.
2. **Executive summary:** what AvaLab is, who it serves, what is implemented.
3. **Course mapping:** table mapping F01–F18 to Signals and Systems and Multimedia Systems topics.
4. **Architecture:** SPA, worker DSP, FastAPI, ffmpeg, ML jobs, offline model cache; one data-flow diagram.
5. **Algorithms:** sampling/aliasing, quantization/SNR, DFT/FFT, STFT/windows, convolution/reverb, filters/poles-zeros, sampling-rate conversion, MDCT/psychoacoustics, lossless codecs, metrics, phase vocoder, BS.1770, pipeline execution.
6. **Feature walkthrough:** one subsection per lab with a screenshot and 2–4 observations.
7. **Guided experiments:** 2–3 full examples with expected observations.
8. **Benchmarks:** measured FFT/STFT/pipeline/loudness numbers from plan 05; device and method stated.
9. **AI tools:** tasks, pinned models, sizes, licenses, CPU limits, honest approximation notes.
10. **Limitations:** model quality, CPU speed, no perceptual metric, no accounts, browser/backend split.
11. **References:** textbooks by reference only; standards (BS.1770, μ-law/A-law); library docs.
12. **Licenses and provenance:** third-party libraries, models, fonts, demo audio.

Use only measured numbers from this repo. Do not invent benchmarks.

## Task 3 — Slides

**Files:** `docs/slides/index.html`, assets

1. 16:9 landscape, one `.slide` per page, `@page { size: 338.667mm 190.5mm; margin: 0; }`.
2. 14–18 slides:
   - title;
   - problem and goals;
   - architecture;
   - live DSP vs backend codecs/ML;
   - Signals and Systems highlights;
   - Multimedia highlights;
   - FFT/spectrogram demo;
   - codec lab and rate–distortion;
   - AI tools and honest limits;
   - pipeline builder;
   - psychoacoustics;
   - deployment/offline;
   - measured performance;
   - lessons and next steps.
3. Same fonts and LTR islands; large type, minimal text, one idea per slide.
4. Figures reuse report assets; no live API.

## Task 4 — Screenshot capture

**Files:** `docs/capture-report-assets.mjs`, `docs/report/assets/`

1. Script starts the built web app (`apps/web/dist`) or dev server and captures:
   - waveform + spectrogram with `pink-noise-5s.wav`;
   - FFT magnitude/phase with `chirp-log-100to8000hz-5s.wav`;
   - sampling aliasing with a generated sine;
   - codec lab with `music-life-turns-15s.wav`;
   - filters with `speech-kathleen-19s.wav`;
   - pipeline with two stages;
   - psychoacoustics with a loudest frame.
2. AI figures:
   - capture once with models available and save under `docs/report/assets/ai/`;
   - the PDF build reads only these files, never the API.
3. Fixed viewport `1440x900`, `deviceScaleFactor: 2`, dark theme, `fa` locale; also capture key screens in `en` if useful.
4. Assert no console errors and no loading spinners in the captured frame.
5. Record clip provenance in `docs/THIRD_PARTY.md`.

## Task 5 — PDF verification

1. Run `pnpm build:docs`.
2. Verify with available tools (`pdfinfo`, `pdffonts`, `pdftotext`):
   - page counts: report > 0 and slides 14–18;
   - all fonts embedded (`pdffonts` shows `emb yes` for Vazirmatn);
   - report text extracts Persian characters;
   - no missing images (build already fails on failed requests).
3. Visual check:
   - open every page as PNG (`pdftoppm -png`, if available) and inspect cover, a formula page, a screenshot page, and a slide;
   - no clipped text, no overflow, no overlapping boxes, RTL shaping correct.
4. Fix CSS/content and rebuild until clean.
5. Record build time and PDF sizes in `docs/REPORT.md`.

## Task 6 — Final acceptance gate

1. Run all gates and capture raw output:
   - `pnpm check`;
   - `pnpm e2e` (full suite, `fa` + `en`);
   - API `uv run pytest`, `uv run ruff check .`, `uv run mypy .`;
   - `docker/smoke.sh`;
   - `pnpm build:docs`.
2. Confirm every AGENTS §13 Definition-of-Done item:
   - bilingual/RTL;
   - algorithms documented + golden/property tests;
   - theory panels and experiments;
   - performance budgets;
   - no main-thread DSP;
   - no console errors in exercised flows;
   - `docs/PROGRESS.md` current.
3. Update `docs/PROGRESS.md` with:
   - completed features F01–F18 status;
   - known limitations;
   - Persian review status;
   - measured performance;
   - deployment status;
   - report/slides status.
4. Update `README.md` with final run/deploy/report commands.
5. Ask the owner:
   - approve committing `docs/deliverables/*.pdf`;
   - complete Persian review;
   - provide university domain/proxy details for deployment;
   - decide whether to tag a release.
6. Do not commit, push, tag, or deploy without explicit approval.
