# ML models

All models are pinned by commit. We never train models and never download
weights during a request. `apps/api/scripts/download_models.py --all` prefetches
the flat per-task cache and skips tasks that are already complete; after that
the API runs with `HF_HUB_OFFLINE=1`.

| Task | Model | Revision | Files | Size | License | Loader |
|---|---|---|---|---|---|---|
| denoise | `Ceva-IP/DPDFNet` | `dd6818d00f50c836fed43a6243ebe49116de5964` | `onnx/dpdfnet2_48khz_hr.onnx` | 10.5 MB | Apache-2.0 | `sherpa-onnx` |
| superres | `TigreGotico/audiosronnx-lavasr` | `b3df8a262cf44e59bf84a40b7084f4479ca566b4` | `backbone.onnx`, `spec_head.onnx`, `denoiser_core.onnx` | 57.1 MB | Apache-2.0 upstream; ONNX repo card has no license field | `audiosronnx` LavaSR |
| separation | `adefossez/HTDemucs` | `cbc8a9b1a87023b7fd74e7b3412e6321c0eab003` | `htdemucs.yaml`, `955717e8.safetensors` | 84.0 MB | MIT upstream; model card has no license field | `demucs` |
| asr | `Systran/faster-whisper-medium` | `08e178d48790749d25932bbc082711ddcfdfbc4f` | `model.bin`, `config.json`, `tokenizer.json`, `vocabulary.txt` | 1.53 GB | MIT | `faster-whisper` CTranslate2 |
| neural codec | `facebook/encodec_48khz` | `c3def8e7185ac8c8efdce6eb8c4a651e487a503e` | `config.json`, `model.safetensors`, `preprocessor_config.json` | 76.3 MB | MIT | `transformers` EnCodec |
| classification | `MIT/ast-finetuned-audioset-10-10-0.4593` | `f826b80d28226b62986cc218e5cec390b1096902` | `config.json`, `model.safetensors`, `preprocessor_config.json` | 346.4 MB | BSD-3-Clause | `transformers` AST |

Total download: 2,104,958,472 bytes (about 1.96 GiB / 2.1 GB). The ASR
model exceeds the 400 MB per-model budget and the total exceeds the 2 GB
decimal budget; this is an explicit owner override (D-058).

## Runtime contracts

- **DPDFNet**: 48 kHz speech denoiser, mono. The wrapper resamples the source
  to 48 kHz, runs the model, then resamples back to the source rate and
  trims/pads to the input length exactly. It is trained on speech; music and
  strongly non-speech material may be altered. It is not a speech enhancer
  for arbitrary noise types, and the first version processes only the requested
  excerpt (no streaming).
- **LavaSR**: accepts 8–48 kHz speech; internally processes at 16 kHz and
  restores 48 kHz. The spectral merge preserves the original band below
  `min(source_rate, 16 kHz) / 2`. Output is resampled back to the source rate
  and trimmed/padded to the input length. The restored high band is estimated,
  not recovered exactly, and the model is speech-focused. The optional
  `denoiser_core.onnx` is downloaded but the first version leaves denoising off
  so the super-resolution experiment isolates bandwidth extension.
- **HTDemucs**: 44.1 kHz, stereo; four stems (`drums`, `bass`, `other`,
  `vocals`). Mono input is duplicated to stereo, then stems are stored as mono
  unless both input channels exist. CPU jobs use the platform's 30 s excerpt
  cap; the UI defaults to 15 s and shows an honest CPU wait message.
- **faster-whisper medium**: 16 kHz mono. The wrapper loads the pinned
  CTranslate2 model, resamples the source, transcribes one 30 s-bounded
  excerpt, and returns `text` plus segments whose timestamps are relative to
  that excerpt. CPU uses int8; CUDA uses float16. Empty or silent input is an
  error, not an empty transcript. The model is multilingual, including
  Persian. The bundled English speech demo has a reference transcript for WER;
  a Persian excerpt has no bundled reference, so WER stays hidden. WER
  normalization and the `(S+D+I)/N` definition are documented in
  `docs/ALGORITHMS.md`.
- **EnCodec 48 kHz**: the 48 kHz processor expects stereo, so the wrapper
  duplicates mono to two channels, runs encode/decode at the requested
  bandwidth, and downmixes the decoded stereo back to mono. The wrapper reports
  estimated encoded size and decoded audio, not a real container bitstream.
  Length is restored exactly by trimming or zero-padding after resampling back
  to the source rate.
- **AST AudioSet classification**: multi-label, not softmax. The wrapper
  resamples mono audio to 16 kHz and splits the excerpt into non-overlapping
  10 s windows (AST's fixed input is 10.24 s). It applies sigmoid to every
  class logit per window, averages scores across windows, and returns the top
  1–20 labels. Scores are independent and do not sum to 100%. The labels are
  AudioSet's English taxonomy; the UI does not translate them. A silent
  excerpt is an error, not an empty classification. The 30 s job cap means at
  most three windows.

## Real-model smoke (2026-11-03; ASR re-run 2026-11-09)

Command (cached weights, no network):

```bash
AVALAB_RUN_ML_TESTS=1 HF_HUB_OFFLINE=1 \
  uv run --directory apps/api --extra ml pytest -q -m ml
```

Result after Plan 03: `5 passed, 198 deselected` in 13.2 s. DPDFNet ran a
0.5 s tone at 16 kHz and returned finite, length-matched audio. LavaSR ran the
8–48 kHz speech fixture with the high band (10–20 kHz) increased by more than
3 dB. HTDemucs returned four length-matched 44.1 kHz stems, and EnCodec
decoded finite audio at the source rate and exact length. On 2026-11-09 the
faster-whisper medium ASR smoke passed offline on the 19.6 s speech demo
(`1 passed`, 12.43 s including load; non-empty English text and segments).
On 2026-11-08 the AST smoke passed
offline (`1 passed`, 7.4 s): the 15 s music demo returned ranked, descending
AudioSet scores (Music 0.60, Rock music 0.15, ...). The first EnCodec run exposed that the
48 kHz processor rejects mono; the wrapper now duplicates mono to stereo and
downmixes the decoded output (commit `2d63be3`).

All six wrappers also have non-gated fake-model tests covering source rates
8 000, 16 000, 22 050, 44 100, 48 000 and 96 000 Hz, exact output length,
short-input padding/trimming, silence, empty input and non-finite rejection.
The EnCodec fake-backend test pins the stereo processor input and mono output
without downloading weights.

## Measured CPU latency (2026-11-03; ASR re-measured 2026-11-09)

Single-run observations on the owner's Intel Core i9-8950HK laptop, CPU only,
cached weights, `HF_HUB_OFFLINE=1`. “Load” is the one-time lazy model/backend
load in the API process; “run” is the adapter call on the shipped demo excerpt
after loading. These are observations, not a benchmark suite, and they will
vary with CPU, thread count and excerpt content. The 30 s Persian excerpt
re-measured 2026-11-09 took 18.6 s (RTF 0.62) after a 3.9 s load, with
auto-detected `fa`.

| Task | Demo excerpt | Load (ms) | Run (ms) |
|---|---|---:|---:|
| denoise | 19.6 s noisy speech, 48 kHz | 185 | 5 552 |
| superres | 19.6 s speech band-limited to 8 kHz, 48 kHz | 192 | 1 738 |
| separation | 15.0 s music, 48 kHz | 1 729 | 14 398 |
| asr | 19.6 s speech, 48 kHz → 16 kHz | 4 510 | 10 350 |
| neural codec | 19.6 s speech, 6 kbps, 48 kHz | 110 | 6 254 |
| classification | 15.0 s music, 48 kHz | 4 669 | 2 272 |

The API loads each backend once and keeps it for the process lifetime. Jobs
have a 30 s excerpt cap (D-035); the demo clips are shorter, so the table
reflects the full shipped excerpts. Separation is the slowest tool; the UI
defaults to 15 s and shows the CPU wait note.

## License notes

- LavaSR upstream `YatharthS/LavaSR` is Apache-2.0. The ONNX export repo
  `TigreGotico/audiosronnx-lavasr` has no license metadata; `audiosronnx`
  declares Apache-2.0 and cites the upstream. Recorded as D-040.
- `adefossez/HTDemucs` has no license field on its model card; upstream
  `adefossez/demucs` is MIT. Recorded as a review item.
- `Systran/faster-whisper-medium` is MIT; `faster-whisper` 1.2.1 and
  CTranslate2 4.8.5 are MIT, and PyAV 19.0.2 is BSD-3-Clause. Recorded as
  D-058.
- No model weights are committed to the repository.

## Offline check

```bash
uv run --directory apps/api --extra ml python scripts/download_models.py --check
HF_HUB_OFFLINE=1 uv run --directory apps/api --extra ml python scripts/download_models.py --check
```

The second command proves the cache is complete without network access. The API
`GET /api/v1/models` reports `available` only when every pinned file exists.
With `HF_HUB_OFFLINE=1` and the populated cache, `GET /api/v1/models` returned
all six entries as `available` and no network access was needed.

The missing-cache path was checked by starting the API with an empty
`AVALAB_ML_MODEL_CACHE_DIR`. `GET /api/v1/models` reported `missing` for all
six tasks, `/tools/ai` rendered all tabs, and the model-bearing run controls
were disabled with a translated missing-model hint. The super-resolution
`path=sinc` baseline stays enabled because it is a signal-processing baseline,
not a learned model; switching to `path=lavasr` shows the missing-model hint
and disables the run control.
