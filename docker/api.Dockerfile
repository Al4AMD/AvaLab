# AvaLab API image: FastAPI + uv-managed venv + ffmpeg, running as non-root.
# ffmpeg comes from Debian apt and is invoked as a separate process (subprocess
# with argument arrays), never linked or bundled; see docs/THIRD_PARTY.md.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /uvx /bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# Dependency layer: manifests only, so source edits do not invalidate it.
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY apps/api/src ./src

# Install the project itself, then create the non-root user and the /data
# storage volume mount point with matching ownership.
RUN uv sync --frozen --no-dev \
    && groupadd --gid 10001 avalab \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin avalab \
    && mkdir -p /data \
    && chown -R avalab:avalab /app /data

ENV PATH="/app/.venv/bin:$PATH" \
    AVALAB_STORAGE_DIR=/data

USER avalab

EXPOSE 8000

# Direct venv entrypoint, not `uv run`: a bare `uv run` re-resolves with the
# dev dependency group included, defeating `--no-dev`.
CMD ["uvicorn", "avalab_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
