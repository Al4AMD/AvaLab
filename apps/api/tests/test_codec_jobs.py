"""Async full-file codec jobs: queue cap, SSE, cancellation and TTL cleanup."""

import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.io import wavfile  # type: ignore[import-untyped]

from avalab_api.codec_jobs import CodecJobEvent, CodecJobManager
from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode
from avalab_api.main import API_PREFIX, create_app
from avalab_api.routes.codec import CodecEncodeRequest, CodecEncodeResponse, CodecParams
from avalab_api.storage import Storage

AUDIO_ID = "a" * 32
RESULT_ID = "b" * 32
JOBS_URL = f"{API_PREFIX}/codec/jobs"


def _storage(tmp_path: Path) -> Storage:
    return Storage(tmp_path / "storage")


def _seed(storage: Storage, audio_id: str = AUDIO_ID, seconds: float = 1.0) -> None:
    source = storage.root / "source.wav"
    storage.root.mkdir(parents=True, exist_ok=True)
    rate = 16_000
    wavfile.write(source, rate, np.zeros(int(seconds * rate), dtype=np.float32))
    storage.save_canonical(
        audio_id,
        source,
        {"duration_s": seconds, "sample_rate_hz": rate, "channels": 1},
    )


def _response() -> CodecEncodeResponse:
    return CodecEncodeResponse(
        result_audio_id=RESULT_ID,
        size_bytes=1000,
        bitrate_kbps=64.0,
        encode_ms=12.0,
        codec_delay_samples=0,
        reference_start_sample=0,
        aligned_sample_count=1600,
        duration_s=0.1,
        sample_rate_hz=16000,
        channels=1,
        bit_exact=False,
        lossless=False,
    )


class GateRunner:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.gate = threading.Event()
        self.running = 0
        self.max_running = 0
        self.lock = threading.Lock()

    def run(
        self,
        request: CodecEncodeRequest,
        progress: Callable[[float], None],
        cancel: Callable[[], bool],
    ) -> CodecEncodeResponse:
        with self.lock:
            self.running += 1
            self.max_running = max(self.max_running, self.running)
        try:
            progress(0.25)
            self.started.set()
            self.gate.wait(timeout=3)
            progress(1.0)
            return _response()
        finally:
            with self.lock:
                self.running -= 1


def _request() -> CodecEncodeRequest:
    return CodecEncodeRequest(audio_id=AUDIO_ID, codec="mp3", params=CodecParams())


def _wait_until(predicate: Callable[[], bool], timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition not met before timeout")


def test_runs_one_job_at_a_time_and_caps_the_queue(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    runner = GateRunner()
    manager = CodecJobManager(storage, max_workers=1, queue_limit=1)
    try:
        first = manager.submit(_request(), runner.run)
        assert runner.started.wait(timeout=2)
        second = manager.submit(_request(), runner.run)
        with pytest.raises(ApiError) as exc_info:
            manager.submit(_request(), runner.run)
        assert exc_info.value.code is ErrorCode.job_busy
        assert manager.exists(first) and manager.exists(second)
        runner.gate.set()
        events = list(manager.events(first))
        assert events[-1].event == "done"
        assert events[-1].result is not None
        assert runner.max_running == 1
    finally:
        runner.gate.set()
        manager.shutdown()


def test_cancel_marks_terminal_and_drops_the_result(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    started = threading.Event()
    deleted: list[str] = []

    def runner(
        request: CodecEncodeRequest,
        progress: Callable[[float], None],
        cancel: Callable[[], bool],
    ) -> CodecEncodeResponse:
        started.set()
        while not cancel():
            time.sleep(0.01)
        return _response()

    manager = CodecJobManager(storage, max_workers=1, queue_limit=1)
    def record_delete(audio_id: str) -> bool:
        deleted.append(audio_id)
        return True

    storage.delete = record_delete  # type: ignore[method-assign]
    try:
        job_id = manager.submit(
            _request(),
            runner,
        )
        assert started.wait(timeout=2)
        assert manager.cancel(job_id) is True
        events = list(manager.events(job_id))
        assert events[0].event in {"progress", "cancelled"}
        assert events[-1].event == "cancelled"
        assert events[-1].code == "job_cancelled"
        _wait_until(lambda: deleted == [RESULT_ID])
    finally:
        manager.shutdown()


def test_ttl_purge_deletes_persisted_results(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    manager = CodecJobManager(storage, max_workers=1, queue_limit=1, ttl_seconds=1)
    runner = GateRunner()
    runner.gate.set()
    deleted: list[str] = []

    def record_delete(audio_id: str) -> bool:
        deleted.append(audio_id)
        return True

    storage.delete = record_delete  # type: ignore[method-assign]
    try:
        job_id = manager.submit(_request(), runner.run)
        assert list(manager.events(job_id))[-1].event == "done"
        manager.purge_expired(now=time.time() + 3600)
        assert manager.exists(job_id) is False
        assert deleted == [RESULT_ID]
    finally:
        manager.shutdown()


@pytest.fixture(autouse=True)
def _clear_settings() -> Iterator[None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _app(storage: Storage) -> TestClient:
    settings = Settings(storage_dir=storage.root)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


def _collect_frames(response: Iterator[bytes]) -> list[CodecJobEvent]:
    text = b"".join(response).decode()
    import json

    events: list[CodecJobEvent] = []
    for line in text.splitlines():
        if line.startswith("data: "):
            events.append(CodecJobEvent.model_validate(json.loads(line[6:])))
    return events


def test_job_routes_stream_progress_and_reject_unknown_ids(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    monkeypatch.setattr(
        "avalab_api.routes.codec_jobs.encode_and_store",
        lambda settings, request, *, progress, cancel: (progress(1.0), _response())[1],
    )
    with _app(storage) as client:
        response = client.post(JOBS_URL, json=_request().model_dump())
        assert response.status_code == 202, response.text
        job_id = response.json()["job_id"]
        with client.stream("GET", f"{JOBS_URL}/{job_id}/events") as events:
            collected = _collect_frames(events.iter_bytes())
        assert collected[-1].event == "done"
        assert collected[-1].result is not None
        assert collected[-1].result["result_audio_id"] == RESULT_ID

        missing = client.get(f"{JOBS_URL}/{'9' * 32}/events")
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "job_not_found"
        cancel_missing = client.delete(f"{JOBS_URL}/{'9' * 32}")
        assert cancel_missing.status_code == 404


def test_job_submission_validates_audio_and_params(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    with _app(storage) as client:
        missing = client.post(
            JOBS_URL,
            json={"audio_id": "c" * 32, "codec": "mp3", "params": {}},
        )
        assert missing.status_code == 404
        bad_params = client.post(
            JOBS_URL,
            json={"audio_id": AUDIO_ID, "codec": "mp3", "params": {"quality": 9}},
        )
        assert bad_params.status_code == 422
