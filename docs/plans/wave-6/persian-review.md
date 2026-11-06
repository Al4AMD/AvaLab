# Wave 6 Plan 05 — Persian copy review

Status: **agent review complete; owner sign-off pending**

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
| sparsity | تُنُکی | Needs instructor confirmation |
| overshoot (Gibbs) | بیش‌جهش | Needs instructor confirmation |
| correlated (error) | همبسته | Needs instructor confirmation |
| demo clip | کلیپ نمونه | Understandable; «نمونهٔ صوتی» is an alternative |

## Owner sign-off list

- [ ] Approve «تُنُکی» for coefficient sparsity, or choose «تنک‌بودن».
- [ ] Approve «بیش‌جهش» for Gibbs overshoot, or choose «فراجهش».
- [ ] Approve «همبسته» for correlated quantization error, or choose
      «وابسته به سیگنال».
- [ ] Decide whether «کلیپ نمونه» should become «نمونهٔ صوتی» in the player
      (one e2e assertion would need the same change).
- [ ] Review the AI/model disclaimer wording: «تقریبی است» is honest but
      the instructor may prefer a stronger academic caveat.
- [ ] Confirm the first-use English parentheticals match the instructor’s
      preferred course terminology.

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
