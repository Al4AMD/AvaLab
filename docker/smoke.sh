#!/usr/bin/env bash
# Docker acceptance smoke for the deployed web+API stack.
#
# Prerequisites: Docker/Compose, host Playwright browsers, and a prefetched
# model cache (see docs/DEPLOYMENT.md). The API runs offline; no credentials
# or external services are needed after the prefetch.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${AVALAB_HTTP_PORT:-18080}"
BASE="http://127.0.0.1:${PORT}"
SMOKE_TMP="$(mktemp -d)"
PLAY_SCRIPT="apps/web/.docker-smoke-playwright.mjs"
API_ID=""
STARTED=0
STATE_JSON="${SMOKE_TMP}/state.json"

cleanup() {
  set +e
  if [ -n "$API_ID" ]; then
    docker network connect avalab_default "$API_ID" >/dev/null 2>&1
  fi
  if [ "$STARTED" = 1 ]; then
    AVALAB_HTTP_PORT="$PORT" docker compose down >/dev/null 2>&1
  fi
  rm -f "$PLAY_SCRIPT"
  rm -rf "$SMOKE_TMP"
}
trap cleanup EXIT

wait_for_health() {
  local attempts=60
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "${BASE}/api/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "API did not become healthy at ${BASE}" >&2
  return 1
}

echo "== build =="
docker compose build

echo "== up (host port ${PORT}) =="
STARTED=1
AVALAB_HTTP_PORT="$PORT" docker compose up -d
wait_for_health

echo "== API: health, models, upload, FLAC, denoise SSE =="
python3 - "$BASE" "$STATE_JSON" <<'PY'
import json
import math
import struct
import sys
import time
import urllib.request
import wave
from io import BytesIO

base, state_path = sys.argv[1], sys.argv[2]


def request(path, *, data=None, headers=None, method=None):
    req = urllib.request.Request(
        base + path,
        data=data,
        headers=headers or {},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        body = response.read()
        return response.status, json.loads(body) if body else None


def get(path):
    return request(path, method="GET")


def post_json(path, payload):
    return request(
        path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )


def wav_bytes(seconds=10, sample_rate=16_000):
    frames = bytearray()
    for index in range(seconds * sample_rate):
        value = int(0.2 * 32767 * math.sin(2 * math.pi * 440 * index / sample_rate))
        frames += struct.pack("<h", value)
    buffer = BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(bytes(frames))
    return buffer.getvalue()


def upload(audio):
    boundary = "----avalab-smoke"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="smoke.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + audio + f"\r\n--{boundary}--\r\n".encode()
    return request(
        "/api/v1/ingest",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )


status, health = get("/api/v1/health")
assert status == 200 and health["status"] == "ok", health
assert health["ffmpeg"] is True, health

status, models = get("/api/v1/models")
assert status == 200 and len(models["models"]) == 5, models
states = {row["task"]: row["state"] for row in models["models"]}
assert all(state == "available" for state in states.values()), states
print("health=ok ffmpeg=true models=5 available")

status, ingested = upload(wav_bytes())
assert status == 200, ingested
audio_id = ingested["audio_id"]

status, encoded = post_json(
    "/api/v1/codec/encode",
    {"audio_id": audio_id, "codec": "flac", "params": {}},
)
assert status == 200 and encoded["lossless"] is True and encoded["bit_exact"] is True, encoded
print(f"flac bit_exact=true size_bytes={encoded['size_bytes']}")

status, job = post_json("/api/v1/ml/denoise", {"audio_id": audio_id})
assert status == 202, job
job_id = job["job_id"]

started = time.monotonic()
events = []
with urllib.request.urlopen(f"{base}/api/v1/jobs/{job_id}/events", timeout=120) as stream:
    for raw in stream:
        if not raw.startswith(b"data: "):
            continue
        event = json.loads(raw.removeprefix(b"data: "))
        events.append((time.monotonic() - started, event))
assert events and events[-1][1]["event"] == "done", events
assert any(event["event"] == "progress" for _, event in events), events
first_at, last_at = events[0][0], events[-1][0]
print(f"sse events={len(events)} first_event_s={first_at:.3f} last_event_s={last_at:.3f}")
assert last_at - first_at >= 0.05, f"SSE arrived as one blob: {first_at:.3f}..{last_at:.3f}"

with open(state_path, "w", encoding="utf-8") as handle:
    json.dump({"audio_id": audio_id, "job_id": job_id}, handle)
PY

echo "== browser: Persian RTL and English LTR =="
cat > "$PLAY_SCRIPT" <<'JS'
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.AVALAB_SMOKE_BASE;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => document.documentElement.lang === "fa" && document.documentElement.dir === "rtl",
);
await page.getByRole("heading", { name: "آوالب", exact: true }).first().waitFor();
await page.getByRole("button", { name: "تغییر زبان" }).click();
await page.waitForFunction(
  () => document.documentElement.lang === "en" && document.documentElement.dir === "ltr",
);
await page.getByRole("heading", { name: "AvaLab", exact: true }).first().waitFor();
assert.deepEqual(errors, []);
console.log("spa fa=rtl en=ltr console_errors=0");
await browser.close();
JS
AVALAB_SMOKE_BASE="$BASE" pnpm --filter @avalab/web exec node .docker-smoke-playwright.mjs

echo "== image sizes and container memory =="
docker image inspect "$(docker compose images -q api)" --format 'api image bytes={{.Size}}'
docker image inspect "$(docker compose images -q web)" --format 'web image bytes={{.Size}}'
docker stats --no-stream --format 'container={{.Name}} mem={{.MemUsage}}' $(AVALAB_HTTP_PORT="$PORT" docker compose ps -q)

echo "== offline model load (network disconnected) =="
API_ID="$(docker compose ps -q api)"
docker network disconnect avalab_default "$API_ID"
docker restart "$API_ID" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$API_ID" python -c \
    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2)" \
    >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec -i "$API_ID" python - <<'PY'
import json
import math
import struct
import time
import urllib.request
import wave
from io import BytesIO

base = "http://127.0.0.1:8000/api/v1"


def request(path, *, data=None, headers=None, method=None):
    req = urllib.request.Request(base + path, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=120) as response:
        body = response.read()
        return response.status, json.loads(body) if body else None


status, models = request("/models", method="GET")
assert status == 200 and len(models["models"]) == 5, models
assert all(row["state"] == "available" for row in models["models"]), models

frames = bytearray()
rate = 16_000
for index in range(2 * rate):
    frames += struct.pack("<h", int(0.2 * 32767 * math.sin(2 * math.pi * 440 * index / rate)))
buffer = BytesIO()
with wave.open(buffer, "wb") as handle:
    handle.setnchannels(1)
    handle.setsampwidth(2)
    handle.setframerate(rate)
    handle.writeframes(bytes(frames))
boundary = "----avalab-offline"
body = (
    f"--{boundary}\r\n"
    'Content-Disposition: form-data; name="file"; filename="offline.wav"\r\n'
    "Content-Type: audio/wav\r\n\r\n"
).encode() + buffer.getvalue() + f"\r\n--{boundary}--\r\n".encode()
status, ingested = request(
    "/ingest",
    data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    method="POST",
)
assert status == 200, ingested
status, job = request(
    "/ml/denoise",
    data=json.dumps({"audio_id": ingested["audio_id"]}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
assert status == 202, job
with urllib.request.urlopen(f"{base}/jobs/{job['job_id']}/events", timeout=120) as stream:
    events = [
        json.loads(raw.removeprefix(b"data: "))
        for raw in stream
        if raw.startswith(b"data: ")
    ]
assert events and events[-1]["event"] == "done", events
print(f"offline=true models=5 denoise={events[-1]['event']}")
PY

echo "== reconnect, restart, and verify volume persistence =="
docker network connect avalab_default "$API_ID"
AVALAB_HTTP_PORT="$PORT" docker compose down >/dev/null
AVALAB_HTTP_PORT="$PORT" docker compose up -d >/dev/null
wait_for_health
AUDIO_ID="$(python3 -c "import json; print(json.load(open('${STATE_JSON}'))['audio_id'])")"
python3 - "$BASE" "$AUDIO_ID" <<'PY'
import json
import sys
import urllib.request

base, audio_id = sys.argv[1], sys.argv[2]
with urllib.request.urlopen(base + "/api/v1/models", timeout=30) as response:
    models = json.load(response)
assert len(models["models"]) == 5, models
assert all(row["state"] == "available" for row in models["models"]), models
with urllib.request.urlopen(base + f"/api/v1/audio/{audio_id}", timeout=30) as response:
    assert response.status == 200
    assert response.read(4) == b"RIFF"
print("persistence: models=5 storage_audio=ok")
PY

echo "== smoke passed =="
