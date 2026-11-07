# Wave 6 Plan 06 — Deployment for University Use

## Metadata

- Spec: [`design.md`](design.md) §10
- Depends on: plans 00–05
- Scope: compose web+API, model-cache volume, offline mode, Caddy/SSE, env docs, proxy runbook, Docker verification
- Out of scope: cloud hosting, TLS certificates, GPU tuning beyond an untested override

## Global constraints

- CPU-only must work and is the default; GPU is optional and marked untested.
- Offline after one-time prefetch: `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`.
- No secrets, domains, or personal paths committed; everything via env.
- API runs as non-root; uploads remain untrusted; TTL cleanup stays enabled.
- SSE must not be buffered by Caddy or a university proxy.
- Local verification uses a temporary host port because `8080` is occupied.
- No commit.

## Review focus

1. **Offline truth:** the stack starts with networking disabled and all five models report `available`.
2. **SSE through proxy:** progress arrives incrementally, not after the job finishes.
3. **Persistence:** model cache and storage volumes survive container recreation.
4. **Security:** non-root, no secrets, restrictive CORS, limits from env.
5. **Runbook usability:** a non-author can deploy and diagnose without reading source.

## File map

Create:
- `compose.gpu.yaml` (optional, marked untested)
- `docs/DEPLOYMENT.md`
- `docker/smoke.sh`
- `apps/api/tests/test_deploy_config.py`

Modify:
- `compose.yaml`
- `docker/api.Dockerfile`
- `docker/web.Dockerfile` (only if needed)
- `docker/Caddyfile`
- `.env.example`
- `apps/api/src/avalab_api/config.py` (only if a needed setting is missing)
- `README.md`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`

## Task 1 — Compose and environment

**Files:** `compose.yaml`, `.env.example`, config

1. API service environment:
   - `AVALAB_ML_ENABLED`
   - `AVALAB_ML_MAX_CONCURRENCY`
   - `AVALAB_ML_MAX_EXCERPT_SECONDS`
   - `AVALAB_ML_DEVICE`
   - `AVALAB_ML_MODEL_CACHE_DIR=/models`
   - `AVALAB_CORS_ORIGINS` (JSON array, default `[]`)
   - `AVALAB_PUBLIC_ORIGIN` (single origin; appended to allowed CORS origins when set)
   - `HF_HUB_OFFLINE=1`
   - `TRANSFORMERS_OFFLINE=1`
2. Volumes:
   - `avalab-storage:/data`
   - `avalab-models:/models`
   - API cache dir owned by UID 10001; set the volume ownership in the Dockerfile or an entrypoint `chown` only if needed.
3. Web service:
   - `ports: ["${AVALAB_HTTP_PORT:-8080}:80"]`;
   - `depends_on: api: condition: service_healthy`.
4. Keep health checks and `restart: unless-stopped`.
5. Add `public_origin: str = ""` to `Settings`; when set, append it to the CORS allow-list in app setup. `.env.example` documents every variable with defaults and safe examples; no real domain.
6. Config test: `Settings` reads all new env names and rejects invalid values.
7. Run `uv run pytest apps/api/tests/test_deploy_config.py -q`.

## Task 2 — Offline model prefetch

**Files:** `docker/api.Dockerfile`, `docs/DEPLOYMENT.md`

1. Copy `apps/api/scripts` into the API image so `download_models.py` exists at runtime.
2. Create `/models` in the image and `chown` it to UID/GID 10001 so the mounted cache volume is writable by the non-root user on first use.
3. Runbook:
   ```bash
   docker compose build api
   docker compose run --rm --no-deps \
     -e HF_HUB_OFFLINE=0 -e TRANSFORMERS_OFFLINE=0 \
     api python scripts/download_models.py --all
   docker compose run --rm --no-deps api python scripts/download_models.py --check
   ```
4. The cache volume is `avalab-models`; verify it survives `docker compose down` without `-v`.
5. Offline test:
   - `docker compose up -d`;
   - confirm `/models` reports all five `available`;
   - disable container networking or use a network namespace without egress;
   - run one short denoise job and confirm it completes.
6. Document the expected total size (~2 GB budget; current pinned total is under 400 MB) and the per-task size.
7. Do not download weights in CI.

## Task 3 — Caddy and SSE

**Files:** `docker/Caddyfile`, `docs/DEPLOYMENT.md`

1. Route specific SSE before the generic API handler:
   ```caddy
   handle /api/v1/jobs/* {
       reverse_proxy api:8000 {
           flush_interval -1
       }
   }
   handle /api/* {
       reverse_proxy api:8000
   }
   ```
2. Keep gzip/zstd for the SPA; do not compress SSE.
3. `X-Accel-Buffering: no` stays in the API response.
4. University proxy runbook:
   - disable response buffering for `/api/v1/jobs/*/events`;
   - read timeout longer than the longest expected job (default 10 min);
   - forward `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`;
   - terminate TLS at the university proxy; app stays HTTP inside the network;
   - set `AVALAB_CORS_ORIGINS` only if the SPA and API are on different origins.
5. Add a buffering smoke: `curl -N` shows progress lines over time, not one terminal blob.

## Task 4 — Optional GPU override

**Files:** `compose.gpu.yaml`, docs

1. Add an override that requests an NVIDIA device and sets `AVALAB_ML_DEVICE=cuda`.
2. The base API image remains CPU; the override requires an owner-provided CUDA PyTorch image. State this explicitly.
3. Mark it **untested on the owner's hardware**; CPU remains the supported path.
4. Do not make GPU a dependency of any gate.

## Task 5 — Docker verification

**Files:** `docker/smoke.sh`, `docs/DEPLOYMENT.md`

1. `docker/smoke.sh`:
   - `docker compose build`;
   - `AVALAB_HTTP_PORT=18080 docker compose up -d`;
   - wait for health;
   - `GET /api/v1/health`;
   - `GET /api/v1/models` (five rows);
   - upload a generated WAV;
   - run one real codec (FLAC) and verify `bit_exact`;
   - run one short denoise job and verify SSE progress + done;
   - open the SPA with Playwright and assert `fa`/`en` load;
   - clean up with `docker compose down`.
2. The script must not require secrets or network after prefetch.
3. Run it fully and paste the output summary into `docs/DEPLOYMENT.md`.
4. Measure image sizes and container memory; record honest numbers.

## Task 6 — Documentation and acceptance

1. `docs/DEPLOYMENT.md`:
   - prerequisites (Docker, ffmpeg in image, ports);
   - quick start;
   - model prefetch/offline;
   - env reference;
   - university proxy runbook;
   - backup/cleanup of storage and model cache;
   - troubleshooting (port busy, model missing, SSE buffering, CORS, CPU ETA).
2. Update `README.md` with the quick start and a link to `docs/DEPLOYMENT.md`.
3. Record deployment decisions in `docs/DECISIONS.md`: volumes, Caddy SSE, offline env, GPU status.
4. Run:
   - `docker compose build`;
   - `AVALAB_HTTP_PORT=18080 docker compose up -d`;
   - `docker/smoke.sh`;
   - `pnpm check`;
   - `pnpm e2e`;
   - API pytest/ruff/mypy.
5. Update `docs/PROGRESS.md`; do not commit.
