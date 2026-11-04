"""ML job routes: 202/SSE/cancel/404/429 and the excerpt cap."""

import io
import json
import threading
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from scipy.io import wavfile  # type: ignore[import-untyped]

from avalab_api.config import get_settings
from avalab_api.main import create_app
from avalab_api.ml.jobs import JobManager, MlResult
from avalab_api.storage import Storage

AUDIO_ID = "b" * 32
AUDIO_ID_2 = "c" * 32


def _seed(settings_storage: Path, audio_id: str = AUDIO_ID, seconds: float = 1.0) -> None:
    storage = Storage(settings_storage)
    storage.root.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    wavfile.write(buffer, 16_000, np.zeros(int(16_000 * seconds), dtype=np.float32))
    storage.save_canonical(
        audio_id,
        buffer.getvalue(),
        {"duration_s": seconds, "sample_rate_hz": 16_000, "channels": 1},
    )


class RouteRunner:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.gate = threading.Event()

    def run(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        params: dict[str, object],
        progress: Callable[[float], None],
    ) -> MlResult:
        progress(0.25)
        self.started.set()
        self.gate.wait(timeout=3)
        progress(1.0)
        return MlResult(
            kind="audio",
            samples=np.zeros(1600, dtype=np.float32),
            sample_rate_hz=16_000,
        )


def _app(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, runner: RouteRunner | None = None
) -> FastAPI:
    monkeypatch.setenv("AVALAB_STORAGE_DIR", str(tmp_path / "storage"))
    get_settings.cache_clear()
    app = create_app()
    if runner is not None:
        app.state.ml_runner_factory = lambda task: runner
    return app


def _events(text: str) -> list[dict[str, object]]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in text.splitlines()
        if line.startswith("data: ")
    ]


def test_start_job_streams_progress_then_done(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    runner = RouteRunner()
    app = _app(monkeypatch, tmp_path, runner)
    try:
        with TestClient(app) as client:
            _seed(tmp_path / "storage")
            response = client.post("/api/v1/ml/denoise", json={"audio_id": AUDIO_ID})
            assert response.status_code == 202
            job_id = response.json()["job_id"]
            assert runner.started.wait(timeout=2)
            runner.gate.set()
            sse = client.get(f"/api/v1/jobs/{job_id}/events")
            assert sse.status_code == 200
            events = _events(sse.text)
            assert events[0]["event"] in {"progress", "done"}
            assert events[-1]["event"] == "done"
            assert "result_audio_id" in events[-1]["result"]  # type: ignore[operator]
    finally:
        runner.gate.set()
        get_settings.cache_clear()


def test_cancel_job_and_unknown_ids(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    runner = RouteRunner()
    app = _app(monkeypatch, tmp_path, runner)
    try:
        with TestClient(app) as client:
            _seed(tmp_path / "storage")
            response = client.post("/api/v1/ml/asr", json={"audio_id": AUDIO_ID})
            job_id = response.json()["job_id"]
            assert runner.started.wait(timeout=2)
            cancelled = client.delete(f"/api/v1/jobs/{job_id}")
            assert cancelled.status_code == 200
            assert cancelled.json() == {"cancelled": True}
            unknown = client.get("/api/v1/jobs/unknown/events")
            assert unknown.status_code == 404
            assert unknown.json()["error"]["code"] == "job_not_found"
            assert client.delete("/api/v1/jobs/unknown").status_code == 404
    finally:
        runner.gate.set()
        get_settings.cache_clear()


def test_excerpt_cap_and_missing_audio(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    app = _app(monkeypatch, tmp_path)
    try:
        with TestClient(app) as client:
            _seed(tmp_path / "storage", seconds=31.0)
            response = client.post("/api/v1/ml/denoise", json={"audio_id": AUDIO_ID})
            assert response.status_code == 422
            assert response.json()["error"]["code"] == "invalid_request"
            missing = client.post("/api/v1/ml/denoise", json={"audio_id": "d" * 32})
            assert missing.status_code == 404
            assert missing.json()["error"]["code"] == "not_found"
    finally:
        get_settings.cache_clear()


def test_queue_full_returns_429(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    runner = RouteRunner()
    app = _app(monkeypatch, tmp_path, runner)
    try:
        with TestClient(app) as client:
            _seed(tmp_path / "storage")
            _seed(tmp_path / "storage", audio_id=AUDIO_ID_2)
            app.state.ml_jobs.shutdown()
            app.state.ml_jobs = JobManager(
                Storage(tmp_path / "storage"), max_workers=1, queue_limit=1
            )
            first = client.post("/api/v1/ml/denoise", json={"audio_id": AUDIO_ID})
            assert first.status_code == 202
            second = client.post("/api/v1/ml/denoise", json={"audio_id": AUDIO_ID_2})
            assert second.status_code == 202
            third = client.post("/api/v1/ml/denoise", json={"audio_id": AUDIO_ID})
            assert third.status_code == 429
            assert third.json()["error"]["code"] == "ml_busy"
    finally:
        runner.gate.set()
        get_settings.cache_clear()
