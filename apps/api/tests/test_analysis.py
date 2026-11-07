"""F14 pitch/beat analysis: DSP output, job persistence and route isolation."""

import io
import json
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from scipy.io import wavfile  # type: ignore[import-untyped]

from avalab_api.analysis import beat, pitch
from avalab_api.config import get_settings
from avalab_api.main import create_app
from avalab_api.ml.jobs import JobManager, MlJobRequest, MlResult
from avalab_api.storage import Storage

AUDIO_ID = "e" * 32


def _sine(frequency_hz: float, seconds: float, rate: int = 16_000) -> np.ndarray:
    times = np.arange(int(seconds * rate), dtype=np.float64) / rate
    return (0.5 * np.sin(2 * np.pi * frequency_hz * times)).astype(np.float32)


def _clicks(seconds: float = 8.0, rate: int = 16_000, bpm: float = 120.0) -> np.ndarray:
    samples = np.zeros(int(seconds * rate), dtype=np.float64)
    click_times = np.arange(0.0, seconds, 60.0 / bpm)
    click_length = int(0.04 * rate)
    click_time = np.arange(click_length, dtype=np.float64) / rate
    click = np.sin(2 * np.pi * 1000 * click_time) * np.exp(-click_time / 0.01)
    for start in click_times:
        index = int(start * rate)
        samples[index : index + click_length] += click[: len(samples) - index]
    return (0.8 * samples / np.max(np.abs(samples))).astype(np.float32)


def _note_progress() -> Callable[[float], None]:
    def progress(value: float) -> None:
        assert 0.0 <= value <= 1.0

    return progress


def test_pitch_tracks_a_220_hz_sine() -> None:
    result = pitch.run(_sine(220, 2.0), 16_000, {}, _note_progress())

    assert result.kind == "analysis"
    assert result.analysis is not None
    assert result.analysis["analysis_kind"] == "pitch"
    f0_values = result.analysis["f0_hz"]
    probabilities = result.analysis["voiced_probability"]
    assert isinstance(f0_values, list) and isinstance(probabilities, list)
    assert len(f0_values) == len(probabilities)
    voiced = [value for value in f0_values if value is not None]
    assert voiced
    assert result.stats["median_f0_hz"] == pytest.approx(220, abs=2)
    voiced_fraction = result.stats["voiced_fraction"]
    assert isinstance(voiced_fraction, float)
    assert 0.0 <= voiced_fraction <= 1.0


def test_beat_finds_120_bpm_and_sorted_times() -> None:
    result = beat.run(_clicks(), 16_000, {}, _note_progress())

    assert result.analysis is not None
    assert result.analysis["analysis_kind"] == "beat"
    tempo_bpm = result.analysis["tempo_bpm"]
    assert isinstance(tempo_bpm, float)
    assert tempo_bpm == pytest.approx(120, abs=2)
    times = result.analysis["beat_times_s"]
    assert isinstance(times, list) and len(times) >= 4
    assert times == sorted(times)


class AnalysisRunner:
    def run(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        params: dict[str, object],
        progress: Callable[[float], None],
    ) -> MlResult:
        del samples, sample_rate_hz, params
        progress(0.5)
        return MlResult(
            kind="analysis",
            analysis={"analysis_kind": "beat", "tempo_bpm": 120.0, "beat_times_s": [0.0, 0.5]},
            stats={"source": "test"},
        )


def test_analysis_job_persists_no_audio(tmp_path: Path) -> None:
    storage = Storage(tmp_path / "storage")
    storage.root.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    wavfile.write(buffer, 16_000, _sine(220, 1.0))
    storage.save_canonical(
        AUDIO_ID,
        buffer.getvalue(),
        {"duration_s": 1.0, "sample_rate_hz": 16_000, "channels": 1},
    )
    manager = JobManager(storage)
    try:
        job_id = manager.submit("beat", MlJobRequest(audio_id=AUDIO_ID), AnalysisRunner())
        done = list(manager.events(job_id))[-1]
        assert done.event == "done" and done.result is not None
        assert done.result["kind"] == "analysis"
        assert done.result["stats"] == {"source": "test"}
        assert "result_audio_id" not in done.result
        assert not any((storage.root / AUDIO_ID).glob("result-*.wav"))
    finally:
        manager.shutdown()


def _seed(storage_dir: Path, seconds: float = 1.0) -> None:
    storage = Storage(storage_dir)
    storage.root.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    wavfile.write(buffer, 16_000, _sine(220, seconds))
    storage.save_canonical(
        AUDIO_ID,
        buffer.getvalue(),
        {"duration_s": seconds, "sample_rate_hz": 16_000, "channels": 1},
    )


def _app(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> FastAPI:
    monkeypatch.setenv("AVALAB_STORAGE_DIR", str(tmp_path / "storage"))
    get_settings.cache_clear()
    return create_app()


def _events(text: str) -> list[dict[str, object]]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in text.splitlines()
        if line.startswith("data: ")
    ]


def test_analysis_route_bypasses_model_registry(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    app = _app(monkeypatch, tmp_path)
    try:
        with TestClient(app) as client:
            _seed(tmp_path / "storage")
            response = client.post("/api/v1/ml/pitch", json={"audio_id": AUDIO_ID})
            assert response.status_code == 202
            job_id = response.json()["job_id"]
            events = _events(client.get(f"/api/v1/jobs/{job_id}/events").text)
            done = events[-1]
            assert done["event"] == "done"
            result = done["result"]
            assert isinstance(result, dict) and result["kind"] == "analysis"
            analysis = result["analysis"]
            assert isinstance(analysis, dict)
            assert analysis["analysis_kind"] == "pitch"
            assert "result_audio_id" not in result
    finally:
        get_settings.cache_clear()


def test_models_still_lists_only_five_model_tasks(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    app = _app(monkeypatch, tmp_path)
    try:
        with TestClient(app) as client:
            response = client.get("/api/v1/models")
            assert response.status_code == 200
            tasks = [row["task"] for row in response.json()["models"]]
            assert len(tasks) == 5
            assert "pitch" not in tasks and "beat" not in tasks
    finally:
        get_settings.cache_clear()


def test_analysis_keeps_the_30_second_excerpt_cap(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    app = _app(monkeypatch, tmp_path)
    try:
        with TestClient(app) as client:
            _seed(tmp_path / "storage", seconds=31.0)
            response = client.post("/api/v1/ml/beat", json={"audio_id": AUDIO_ID})
            assert response.status_code == 422
            assert response.json()["error"]["code"] == "invalid_request"
    finally:
        get_settings.cache_clear()
