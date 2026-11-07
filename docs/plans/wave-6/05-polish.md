# Wave 6 Plan 05 — Polish, Performance, Accessibility, Persian Review

## Metadata

- Spec: [`design.md`](design.md) §12.3
- Depends on: plans 00–04
- Scope: performance, main-thread audit, accessibility, RTL/Persian, robustness, consistency, docs hygiene
- Out of scope: new features, new dependencies, deployment, report content

## Global constraints

- Fixes only; no new feature scope. Any gap found goes to `docs/PROGRESS.md` unless it blocks a P0/P1 gate.
- Performance numbers are measured in this session, never estimated.
- No main-thread DSP; all audio loops stay in workers.
- Every UI change is verified in `fa` RTL and `en` LTR.
- Persian copy is reviewed for natural academic language; flag anything uncertain.
- No commit.

## Review focus

1. **Measured performance:** 5-minute 44.1 kHz file meets AGENTS §9 budgets or has a documented, honest fallback.
2. **Main-thread purity:** no FFT/STFT/filter/codec loops outside `packages/dsp` + workers.
3. **Accessibility:** keyboard path, focus, labels, contrast, reduced motion, colorblind-safe plots.
4. **RTL:** no physical `left/right` layout; plots and formulas stay LTR.
5. **Robustness:** no spinner without cancel/error; no empty catch; no console errors.

## File map

Create:
- `apps/web/e2e/performance.spec.ts`
- `apps/web/e2e/accessibility.spec.ts`
- `apps/web/e2e/rtl.spec.ts`
- `docs/plans/wave-6/performance.md` (measurements + budget table)
- `docs/plans/wave-6/persian-review.md` (review checklist + owner sign-off list)

Modify (only where a gate fails):
- `apps/web/src/features/**`
- `apps/web/src/components/**`
- `apps/web/src/app/**`
- `apps/web/src/styles/app.css`
- `packages/dsp/src/**`
- `apps/web/src/i18n/{en,fa}.json`
- `docs/PROGRESS.md`

## Task 1 — Performance harness and 5-minute check

**Files:** `performance.spec.ts`, `performance.md`

1. Add a deterministic 5-minute 44.1 kHz mono WAV fixture to the e2e fixtures (generated, not committed as a large binary; generate once in the test setup with a Node script or `ffmpeg` if available, otherwise build in Python in `tools/golden` and cache under the test temp dir).
2. Measure with `performance.now()`:
   - ingest/decode → waveform overview;
   - spectrogram overview;
   - FFT of a 30 s excerpt;
   - 10 s codec-lab MDCT encode/decode;
   - filter apply to a 30 s excerpt;
   - reverb apply to a 30 s excerpt;
   - loudness measure of the whole file;
   - pipeline on a 30 s excerpt.
3. Budgets from AGENTS §9:
   - waveform overview `< 1 s`;
   - spectrogram overview `< 3 s`;
   - live parameter change on a 10–30 s excerpt `< 300 ms` where mathematically possible;
   - no main-thread block `> 16 ms`.
4. Record measured medians and device in `performance.md`. If a budget fails:
   - profile first (`performance.mark`/`measure`);
   - optimize in TypeScript (typed arrays, precomputed twiddles, fewer allocations);
   - do not add WASM without a recorded benchmark and owner approval.
5. Tests assert only stable upper bounds (2× budget) to avoid CI flakiness; the report records the real numbers.
6. Run `pnpm --filter @avalab/web e2e -- performance.spec.ts` and paste raw numbers into `performance.md`.

## Task 2 — Main-thread DSP audit

1. Grep every `.ts/.tsx` under `apps/web/src` for `for (` loops over audio arrays, `fft(`, `stft(`, `convolve(`, `encode*`, `quantize*`.
2. Allowed: UI formatting loops over ≤ 512 plot points, canvas drawing, and worker-boundary copies.
3. For each violation:
   - move the computation into `packages/dsp` if it is an algorithm, or into an existing worker op if it is glue;
   - add/adjust a worker-op test.
4. Add a static guard test `apps/web/src/session/mainThreadDsp.test.ts` that scans `features/**` source text for direct DSP imports and fails on `applySpectrumCurves`, `fftRadix2`, `stft`, `mdct*`, `convolve*`, `measureLoudness` imports outside `session/ops.ts` and canvas-only modules.
5. Run `pnpm check`.

## Task 3 — Accessibility pass

**Files:** `accessibility.spec.ts`, affected components

1. Keyboard audit for every tool:
   - all controls reachable by Tab;
   - visible focus ring;
   - Space/Enter activate buttons;
   - dialogs trap focus and close on Escape;
   - no keyboard trap outside dialogs.
2. Labels:
   - every input/select/slider has a translated `aria-label` or `<label>`;
   - icon-only buttons have `aria-label`;
   - canvas plots have a text summary (`aria-label` or adjacent table).
3. Contrast:
   - dark and light tokens meet 4.5:1 for body text and 3:1 for large text;
   - accent is not the only cue; add text/icon for errors and state.
4. Motion:
   - `prefers-reduced-motion: reduce` disables non-essential transitions and playback animations;
   - no auto-playing audio without user action.
5. Plots:
   - spectrogram colormaps include a colorblind-safe option;
   - no information conveyed by color alone.
6. `accessibility.spec.ts`:
   - Tab through each tool header/controls;
   - open/close the shortcut help dialog;
   - assert focus returns;
   - assert no console errors;
   - run in `fa` and `en`.
7. Fix only failing gates; record the rest.

## Task 4 — RTL and Persian review

**Files:** `rtl.spec.ts`, `persian-review.md`, i18n

1. Scan for physical layout utilities: `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`, `border-l`, `border-r`. Replace with logical equivalents unless the element is intentionally LTR (plots/formulas).
2. Verify every technical readout, axis, formula, and code span is `dir="ltr"`.
3. `rtl.spec.ts`:
   - load each tool in `fa`;
   - assert sidebar and controls are mirrored;
   - assert plots and numeric readouts remain LTR;
   - no horizontal overflow at 1280 px, 768 px, and 390 px;
   - player dock remains usable at 768 px and 390 px (controls wrap, no clipped labels);
   - repeat key pages in `en`.
4. Persian copy review:
   - read every new key added in plans 01–04;
   - check natural academic tone, consistent terminology, and first-use «فارسی (English)»;
   - fix obvious issues; list uncertain terms for the owner in `persian-review.md`.
5. Ensure `fa.json` and `en.json` have identical key sets; `pnpm check` enforces it.
6. Record the owner-review status in `docs/PROGRESS.md`.

## Task 5 — Robustness and error paths

1. Exercise:
   - corrupted/unsupported upload → bilingual error, app usable;
   - >300 s file → clear rejection, no truncation;
   - backend offline → browser tools still work, AI/real-codec disabled with explanation;
   - model missing → `ai.models.disabled` or per-task unavailable message;
   - job cancel → terminal `cancelled`, no spinner;
   - worker error → visible error, previous result preserved;
   - empty/1-sample/DC/NaN input → typed error or documented result.
2. Confirm every long operation has progress, cancel, and error state. No spinner without an exit.
3. Confirm no empty `catch`; developer errors keep detail in console, user errors are translated.
4. Add missing e2e cases to the relevant spec.
5. Run the full `pnpm e2e`.

## Task 6 — UI consistency

1. Audit spacing, typography, button variants, panel headers, toolbars, empty states, and error styles against the existing scientific-instrument design.
2. Ensure every tool has:
   - a consistent header and short description;
   - an empty state with a working action (load demo/generate);
   - a theory panel in the same position;
   - a clear "apply to selection / whole file" affordance where relevant.
3. Do not redesign; use existing tokens/components.
4. Check dark and light themes, both locales.
5. Add screenshots only if already part of the e2e pattern; do not add a new visual-regression framework.

## Task 7 — Docs and TODO hygiene

1. Sweep `TODO`, `FIXME`, `XXX`, `@ts-ignore`, `eslint-disable`, and commented-out code.
2. Every remaining TODO must have an entry in `docs/PROGRESS.md`; remove the rest.
3. Update `docs/ALGORITHMS.md`, `docs/DECISIONS.md`, `docs/MODELS.md`, `docs/THIRD_PARTY.md` for any change made in this plan.
4. Update `docs/PROGRESS.md` with measured performance, accessibility status, Persian review status, and remaining known issues.
5. Run `pnpm check`, `pnpm e2e`, API pytest/ruff/mypy.
6. Do not commit.
