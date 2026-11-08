# Deployment

AvaLab deploys as two containers: Caddy serves the built SPA and proxies
`/api/*` to the FastAPI container. The default path is CPU-only and works
offline after a one-time model prefetch.

Owner decision (2026-11-07): the primary target is a CPU-only university
server, but the same Compose stack must stay runnable on the owner's laptop
for local presentations. No public domain is assigned yet; use
`http://127.0.0.1:<port>` for now. When a domain is assigned, either let Caddy
terminate TLS or put the stack behind the university proxy as described under
[Reverse proxy and SSE](#reverse-proxy-and-sse). Do not commit a real domain
or certificate.

## Prerequisites

- Docker Engine with Compose v2 (this session used Docker 29.7 and Compose 5.3).
- About 8 GB free disk: the API image carries PyTorch and ffmpeg (about 5 GB),
  while the pinned model weights total about 696 MiB (730 MB).
- Port 80 inside the `web` container; publish it on any free host port.
- For `docker/smoke.sh`: host `curl`, Python 3, and Playwright Chromium
  (`pnpm --filter @avalab/web exec playwright install chromium`).
- ffmpeg is already inside the API image; no host ffmpeg is required.

No secret, real domain, or personal path is stored in the repository. Put
local values in `.env`, which is git-ignored.

## Quick start

```bash
cp .env.example .env
docker compose build
AVALAB_HTTP_PORT=8080 docker compose up -d
curl -fsS http://127.0.0.1:8080/api/v1/health
```

The web app is at `http://127.0.0.1:8080`. The API is only published through
Caddy at `/api/v1`. Port 8080 may be occupied on the development laptop; use a
temporary host port instead:

```bash
AVALAB_HTTP_PORT=18080 docker compose up -d
```

The API runs as UID/GID 10001, not root. Its upload, duration, channel, TTL,
and ML limits come from environment variables. CORS defaults to same-origin
only.

## Model prefetch and offline operation

The API container sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`. Start
with network access once to fill the `avalab-models` volume:

```bash
docker compose build api
docker compose run --rm --no-deps \
  -e HF_HUB_OFFLINE=0 -e TRANSFORMERS_OFFLINE=0 \
  api python scripts/download_models.py --all
docker compose run --rm --no-deps \
  api python scripts/download_models.py --check
```

If the volume was created by an older root-running image, fix ownership once
before prefetching:

```bash
docker compose run --rm --no-deps --user root api chown -R avalab:avalab /models
```

`--all` downloads roughly 696 MiB / 730 MB (the project budget allows up to 2 GB).
Pinned sizes:

| Task | Model | Bytes |
|---|---|---:|
| denoise | `Ceva-IP/DPDFNet` | 10,493,337 |
| superres | `TigreGotico/audiosronnx-lavasr` | 57,143,745 |
| separation | `adefossez/HTDemucs` | 84,025,461 |
| asr | `openai/whisper-tiny` | 155,434,424 |
| neural_codec | `facebook/encodec_48khz` | 76,292,186 |
| classification | `MIT/ast-finetuned-audioset-10-10-0.4593` | 346,432,008 |

The cache is `avalab-models`, mounted at `/models`, owned by UID 10001. It is
independent of container lifetime. `docker compose down` keeps it; only
`docker compose down -v` deletes it.

To confirm offline behavior manually:

```bash
docker compose up -d
docker compose exec api python scripts/download_models.py --check
# Now disconnect the API from the Compose network and restart it:
API_ID="$(docker compose ps -q api)"
docker network disconnect avalab_default "$API_ID"
docker restart "$API_ID"
docker exec "$API_ID" python scripts/download_models.py --check
docker network connect avalab_default "$API_ID"
```

`docker/smoke.sh` automates a stronger version: it restarts the API with the
network removed, uploads audio, and completes a denoise job before reconnecting.

## Environment reference

Compose reads `.env` for interpolation. The API reads the same `AVALAB_*`
variables through pydantic-settings.

| Variable | Default | Purpose |
|---|---|---|
| `AVALAB_HTTP_PORT` | `8080` | Host port published by the `web` service. |
| `AVALAB_STORAGE_DIR` | `/data` in Docker | Temporary audio storage. |
| `AVALAB_MAX_UPLOAD_BYTES` | `209715200` | Upload byte cap (200 MB). |
| `AVALAB_MAX_DURATION_SECONDS` | `300` | Audio duration cap. |
| `AVALAB_MAX_SAMPLE_RATE_HZ` | `96000` | Higher rates are resampled down. |
| `AVALAB_MAX_CHANNELS` | `2` | More channels are downmixed. |
| `AVALAB_TTL_MINUTES` | `60` | Audio deletion delay. |
| `AVALAB_TTL_SWEEP_INTERVAL_SECONDS` | `60` | TTL sweep period. |
| `AVALAB_ML_ENABLED` | `true` | Global ML switch. |
| `AVALAB_ML_MAX_CONCURRENCY` | `1` | ML worker count; keep 1 on CPU. |
| `AVALAB_ML_MAX_EXCERPT_SECONDS` | `30` | Per-job audio limit. |
| `AVALAB_ML_DEVICE` | `cpu` | `cuda` moves ASR, separation and Encodec to CUDA; super-resolution uses CUDA only if the ONNX runtime exposes it; denoise stays CPU. |
| `AVALAB_ML_MODEL_CACHE_DIR` | `/models` in Docker | Must match the mounted cache volume. |
| `AVALAB_CORS_ORIGINS` | `[]` | JSON array for split-origin deployments. |
| `AVALAB_PUBLIC_ORIGIN` | empty | One origin appended to the CORS allow-list; canonicalized to `scheme://host[:port]`. |

`HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` are set by `compose.yaml`; the
prefetch commands override them only for the download run. Compose also sets
`HF_HOME=/tmp/huggingface`, so the Hub download cache is ephemeral while the
copied per-task files stay in `/models`. Do not put a real domain in a
committed file.

## Reverse proxy and SSE

Caddy handles `/api/v1/jobs/*` before the generic `/api/*` handler and sets
`flush_interval -1` so job progress is not buffered. Compression is applied
only to static SPA responses; SSE is never compressed. The API also sends
`X-Accel-Buffering: no`.

A university reverse proxy in front of the stack must:

- disable response buffering for `/api/v1/jobs/*/events`;
- use a read timeout longer than the longest ML job (default 10 minutes);
- forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`;
- terminate TLS at the university proxy and keep the app on HTTP inside the
  private network;
- set `AVALAB_CORS_ORIGINS` only if the SPA and API are on different origins.

Check incremental delivery with a real job id:

```bash
curl -N -H 'Accept: text/event-stream' \
  http://127.0.0.1:8080/api/v1/jobs/<job-id>/events
```

Progress lines should appear as events occur, not as one blob after the job
finishes.

## Optional GPU override

GPU is **untested on the owner's hardware** and is not part of any gate. The
base image is CPU-only. Build an API image with a CUDA-enabled PyTorch and
torchaudio stack, then reference it explicitly:

```bash
AVALAB_GPU_API_IMAGE=registry.example/avalab-api:cuda \
  docker compose -f compose.yaml -f compose.gpu.yaml up -d
```

The override requests all NVIDIA devices and sets `AVALAB_ML_DEVICE=cuda`. It
also resets the Compose `build` key so the CPU image is not silently built.
With the CUDA setting, ASR, separation and Encodec load through PyTorch CUDA;
LavaSR uses `CUDAExecutionProvider` only when the owner's ONNX runtime exposes
it, otherwise it falls back to CPU. DPDFNet denoising remains CPU-only. The
host needs an NVIDIA driver and the NVIDIA Container Toolkit. No GPU result has
been measured in this repository.

## Verification

Run the full acceptance smoke:

```bash
pnpm --filter @avalab/web exec playwright install chromium  # once
AVALAB_HTTP_PORT=18080 docker/smoke.sh
```

The script builds both images, starts the stack, checks health and all six
model states, uploads generated audio, verifies a bit-exact FLAC round trip,
checks incremental denoise SSE events, opens the SPA in Playwright in Persian
and English, restarts the API with the network disconnected, and confirms the
model and storage volumes survive `docker compose down`/`up`.

The script uses the default Compose project name so it can reuse the prefetched
model cache. Run it only where stopping this project is acceptable.

Verification results from the latest session:

- Date: 2026-11-08; host port 18080.
- `docker compose build` succeeded for both images. API image 1,298,509,301
  bytes; web image 31,842,520 bytes. Observed memory during the smoke: API
  177.1 MiB, web 25.21 MiB.
- `/api/v1/health` returned `status=ok`, `ffmpeg=true`; all six models were
  `available`; model volume size about 696 MiB.
- 10 s mono 16 kHz WAV upload succeeded; FLAC encode returned `lossless=true`,
  `bit_exact=true`, `size_bytes=73627`.
- Denoise SSE produced 6 events, first at 0.008 s and terminal `done` at
  3.513 s, so progress arrived incrementally.
- Playwright loaded the SPA in Persian RTL and switched to English LTR with
  zero console errors.
- With the API disconnected from `avalab_default` and restarted, all six
  model files still reported `available`, and a 2 s denoise job loaded the
  model and reached `done`. Other model backends were not run offline.
- After reconnect, `docker compose down` and `up`, all six models remained
  available and a previously ingested audio id still served RIFF audio.
- The smoke script exited 0: `docker/smoke.sh` with `AVALAB_HTTP_PORT=18080`.

## Backup and cleanup

Named volumes are `avalab_avalab-models` and `avalab_avalab-storage`. Back them
up while the stack is stopped or idle:

```bash
docker run --rm -v avalab_avalab-models:/from -v "$PWD":/backup alpine \
  tar czf /backup/avalab-models.tgz -C /from .
docker run --rm -v avalab_avalab-storage:/from -v "$PWD":/backup alpine \
  tar czf /backup/avalab-storage.tgz -C /from .
```

Uploaded audio is temporary. Keep `AVALAB_TTL_MINUTES` and the sweeper enabled
unless a separate cleanup process owns the data. **`docker compose down -v`
deletes both volumes**, including the downloaded models; use it only when that
is intended.

## Troubleshooting

- **Port already allocated:** change `AVALAB_HTTP_PORT`; the container still
  listens on port 80 internally.
- **`/models` shows `missing`:** run the prefetch command and then
  `download_models.py --check`. The cache must be mounted at `/models` and
  owned by UID 10001.
- **SSE arrives as one blob:** verify the Caddy `/api/v1/jobs/*` handler has
  `flush_interval -1`, then check any upstream proxy for response buffering.
- **Browser CORS error:** same-origin deployments need no CORS entry. For a
  split origin, set `AVALAB_PUBLIC_ORIGIN` or the JSON `AVALAB_CORS_ORIGINS`.
- **CPU jobs are slow:** expected on CPU; keep `AVALAB_ML_MAX_CONCURRENCY=1`,
  use the 30 s excerpt limit, and report progress in the UI. Do not raise the
  concurrency on a laptop.
- **Model cache lost after restart:** check that the stack was not stopped with
  `docker compose down -v` and that `AVALAB_ML_MODEL_CACHE_DIR=/models`.
- **Permission denied writing `/data` or `/models`:** the named volume was
  created by a different UID. Recreate it after confirming the data is
  disposable, or restore ownership to 10001.
