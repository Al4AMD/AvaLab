# AvaLab report and slides

Build and verification notes for the Persian deliverable PDFs:

- `docs/deliverables/avalab-report-fa.pdf`
- `docs/deliverables/avalab-slides-fa.pdf`

## Build

Requirements: Node 22, pnpm, and the Playwright Chromium browser installed for
`apps/web`. The builder resolves Playwright from `apps/web` and serves the repo
through a local static HTTP server; it does not need the backend or the models.

```sh
pnpm install
pnpm exec playwright install chromium
pnpm build:docs
```

`pnpm build:docs` runs `docs/build-pdfs.mjs`. It loads `docs/report/index.html`
and `docs/slides/index.html` at a fixed Persian/RTL viewport, waits for
`document.fonts.ready` and every image, rejects console errors, page errors,
failed requests, missing fonts, horizontal overflow, and page/slide overflow,
then writes both PDFs with `page.pdf()`.

Expected build log (last run, 2026-11-06):

```text
report: 31 pages, 5347148 bytes -> docs/deliverables/avalab-report-fa.pdf
slides: 16 pages, 3274287 bytes -> docs/deliverables/avalab-slides-fa.pdf
built report 31 pages / slides 16 pages in 5206 ms
```

Builds are deterministic for the same Chromium/font/image inputs. Wall-clock
time and PDF byte sizes can vary slightly across Chromium versions.

## Sources

- `docs/report/index.html`, `docs/report/report.css` — A4 report, 12 sections.
- `docs/slides/index.html`, `docs/slides/slides.css` — 16 slides, 16:9.
- `docs/report/assets/*.png` — application screenshots at 1440×900, DPR 2
  (2880×1800): waveform, spectrogram, FFT, spectrum editor, generator,
  sampling, extent, speed, codec lab, filters, reverb, psychoacoustics,
  pipeline, plus cached AI denoise/super-resolution figures.
- `apps/web/public/fonts/Vazirmatn-Regular.woff2` and
  `Vazirmatn-Bold.woff2` — self-hosted, no CDN.
- `apps/web/public/demo/` — bundled CC0 demo clips used by the screenshots.
  Provenance is in `docs/THIRD_PARTY.md`.

Screenshots are captured with `node docs/capture-report-assets.mjs` (fixed
Persian dark theme and viewport). AI screenshots are one-time cached outputs
under `docs/report/assets/ai/`; the PDF build never calls the API or a model.
Recapture only when a view's visible UI changes and regenerate the PDFs after.

## Verification

Checked with PyMuPDF 1.24.14 (no Poppler on the build machine):

- report 31 pages, A4 594.96×841.92 pt;
- slides 16 pages, 338.67×190.5 mm;
- embedded fonts: Vazirmatn Regular/Bold and Menlo; the slides also embed two
  Type3 glyphs for the arrow characters; no Tahoma/Helvetica fallback;
- extracted report text contains Persian characters, both `fa` and `en` demo
  labels, and the measured readouts;
- rendered pages checked visually: cover, formulas, every lab screenshot page,
  codec/pipeline pages, references, and representative slides; no clipped text
  or overlapping boxes.

## Caveats

- The report is machine-drafted Persian; terminology and final copy still need
  the owner's review (`docs/plans/wave-6/persian-review.md`).
- The AI figures are pre-computed evidence, not a live model run; the AI
  section labels them as approximations.
- The report states only measured numbers recorded in `docs/PROGRESS.md` and
  `docs/plans/wave-6/performance.md`.
