# ML models

All models are pinned by commit. We never train models and never download
weights during a request. `apps/api/scripts/download_models.py --all` prefetches
the flat per-task cache; after that the API runs with `HF_HUB_OFFLINE=1`.

| Task | Model | Revision | Files | Size | License | Loader |
|---|---|---|---|---|---|---|
| denoise | `Ceva-IP/DPDFNet` | `dd6818d00f50c836fed43a6243ebe49116de5964` | `onnx/dpdfnet2_48khz_hr.onnx` | 10.5 MB | Apache-2.0 | `sherpa-onnx` |
| superres | `TigreGotico/audiosronnx-lavasr` | `b3df8a262cf44e59bf84a40b7084f4479ca566b4` | `backbone.onnx`, `spec_head.onnx`, `denoiser_core.onnx` | 57.1 MB | Apache-2.0 upstream; ONNX repo card has no license field | `audiosronnx` LavaSR |
| separation | `adefossez/HTDemucs` | `cbc8a9b1a87023b7fd74e7b3412e6321c0eab003` | `htdemucs.yaml`, `955717e8.safetensors` | 84.0 MB | MIT upstream; model card has no license field | `demucs` |
| asr | `openai/whisper-tiny` | `169d4a4341b33bc18d8881c4b69c2e104e1cc0af` | tokenizer/config files + `model.safetensors` | 155.4 MB | Apache-2.0 | `transformers` Whisper |
| neural codec | `facebook/encodec_48khz` | `c3def8e7185ac8c8efdce6eb8c4a651e487a503e` | `config.json`, `model.safetensors`, `preprocessor_config.json` | 76.3 MB | MIT | `transformers` EnCodec |

Total download: about 383 MB, below the 2 GB budget and under 400 MB per model.

## Runtime contracts

- **DPDFNet**: 48 kHz speech denoiser, mono. The wrapper resamples the source
  to 48 kHz, runs the model, then resamples back to the source rate and
  trims/pads to the input length.
- **LavaSR**: accepts 8–48 kHz speech; internally processes at 16 kHz and
  restores 48 kHz. The spectral merge preserves the original band below
  `min(source_rate, 16 kHz) / 2`. Output is resampled back to the source rate.
  The optional `denoiser_core.onnx` is downloaded but the first version leaves
  denoising off so the super-resolution experiment isolates bandwidth extension.
- **HTDemucs**: 44.1 kHz, stereo; four stems (`drums`, `bass`, `other`,
  `vocals`). Mono input is duplicated to stereo, then stems are stored as mono
  unless both input channels exist. CPU jobs are capped to a short excerpt.
- **Whisper tiny**: 16 kHz mono. Use the English speech demo for the WER
  experiment; tiny is weak for Persian. Segments carry start/end seconds.
- **EnCodec 48 kHz**: mono/stereo at 48 kHz; the wrapper reports estimated
  encoded size and decoded audio, not a real container bitstream.

## License notes

- LavaSR upstream `YatharthS/LavaSR` is Apache-2.0. The ONNX export repo
  `TigreGotico/audiosronnx-lavasr` has no license metadata; `audiosronnx`
  declares Apache-2.0 and cites the upstream. Recorded as D-040.
- `adefossez/HTDemucs` has no license field on its model card; upstream
  `adefossez/demucs` is MIT. Recorded as a review item.
- No model weights are committed to the repository.

## Offline check

```bash
uv run --directory apps/api --extra ml python scripts/download_models.py --check
HF_HUB_OFFLINE=1 uv run --directory apps/api --extra ml python scripts/download_models.py --check
```

The second command proves the cache is complete without network access. The API
`GET /api/v1/models` reports `available` only when every pinned file exists.
