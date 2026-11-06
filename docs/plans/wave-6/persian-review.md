# Wave 6 Plan 05 — Persian copy review

Status: **agent review complete; owner chose general terms on 2026-11-07**

Scope: the keys added or changed in the uncommitted Plans 00–04 work
(`git diff 48f3bae -- apps/web/src/i18n/fa.json`, ~950 added lines), the 13
short tool descriptions added in Plan 05 Task 6, plus a full-file terminology
pass. `pnpm i18n:check` confirms `fa.json` and
`en.json` have identical key sets.

## What was checked

- Natural academic Persian, consistent terminology, and first-use
  «فارسی (English)» for technical terms.
- Units and symbols kept verbatim (`Hz`, `kHz`, `s`, `ms`, `dB`, `bit`,
  `kbps`); Latin digits remain in technical readouts.
- Plot/formula/readout strings stay LTR through `dir="ltr"` wrappers; no
  translated axis text is mirrored.
- Error, empty, cancelled, and offline messages give a recovery path.
- Persian and English key sets are identical and every key is used.

## Fixes made in this review

- Unified noise terminology from «نوفه» to the dominant «نویز» across the
  generator, FFT phase note, denoise, AI, and psychoacoustics copy.
- Added the English first-use term for companding:
  «فشرده‌سازی دامنه (Companding)».
- Fixed the missing ezafe in «مؤلفهٔ منحنی».
- Reworded the reverb header description from «پیچانیدن» to the academic
  «کانولوشن کردن»; the rest of the tool descriptions use the existing
  established terms («شکل‌موج», «طیف‌نگاره», «گزیده»).

## Terminology decisions

| Term | Persian used | Note |
|---|---|---|
| waveform | شکل‌موج | Existing UI term |
| spectrogram | طیف‌نگاره | Existing UI term |
| reverb | پژواک | AGENTS §4 uses «پژواک/طنین»; UI keeps «پژواک» |
| signal extent | گستردگی سیگنال | Owner’s course term; retained |
| quality metrics | سنجه‌های کیفیت | Existing UI term |
| companding | فشرده‌سازی دامنه | English parenthetical added at first use |
| noise | نویز | Unified in this review |
| sparsity | سهم ضرایب صفر | Owner chose the general wording in Plan 07 |
| overshoot (Gibbs) | فراجهش | Owner chose the general wording in Plan 07 |
| correlated (error) | وابسته به سیگنال | Owner chose the general wording in Plan 07 |
| demo clip | نمونهٔ صوتی | Owner chose the general wording in Plan 07 |

## Owner sign-off list

- [x] Use «سهم ضرایب صفر» for coefficient sparsity.
- [x] Use «فراجهش» for Gibbs overshoot.
- [x] Use «وابسته به سیگنال» for correlated quantization error.
- [x] Use «نمونهٔ صوتی» in the player (the e2e assertion was updated).
- [x] Keep the AI/model disclaimer wording at owner direction (general wording).
- [x] Owner chose general terms; no further parenthetical changes requested.

## Uncertain or intentionally preserved wording

- «رونوشت پیوند» (copy link) is correct but formal; «کپی پیوند» is the
  common alternative.
- «محک FFT» uses «محک» for benchmark; the instructor may prefer
  «بنچمارک» or «سنجش کارایی».
- «کدگذار» and «کدگذاری» are used consistently as the agent/process pair.
- Persian digits appear only in prose/action labels, not in technical
  readouts; this follows AGENTS §6.
- No machine-translated strings are known to remain; this review did not
  find any sentence that needs a machine-translation warning.
