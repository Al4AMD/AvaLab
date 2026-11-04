"""Bounded job manager: progress, persistence, cancellation and TTL."""

import threading
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile  # type: ignore[import-untyped]

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.audio import read_canonical_mono
from avalab_api.ml.jobs import JobEvent, JobManager, MlJobRequest, MlResult, StemResult
from avalab_api.storage import Storage

AUDIO_ID = "a" * 32


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


class GateRunner:
    def __init__(self, result: MlResult | None = None) -> None:
        self.result = result or MlResult(
            kind="audio",
            samples=np.ones(1600, dtype=np.float32) * 0.25,
            sample_rate_hz=16_000,
        )
        self.started = threading.Event()
        self.gate = threading.Event()
        self.running = 0
        self.max_running = 0
        self.lock = threading.Lock()

    def run(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        params: dict[str, object],
        progress: Callable[[float], None],
    ) -> MlResult:
        with self.lock:
            self.running += 1
            self.max_running = max(self.max_running, self.running)
        try:
            progress(0.25)
            self.started.set()
            self.gate.wait(timeout=3)
            progress(1.0)
            return self.result
        finally:
            with self.lock:
                self.running -= 1


class TranscriptRunner:
    def run(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        params: dict[str, object],
        progress: Callable[[float], None],
    ) -> MlResult:
        progress(0.5)
        return MlResult(
            kind="transcript",
            text="hello",
            segments=[{"start_s": 0.0, "end_s": 1.0, "text": "hello"}],
            language="en",
            stats={"words": 1},
        )


def _collect(manager: JobManager, job_id: str) -> list[JobEvent]:
    return list(manager.events(job_id))


def test_one_job_runs_at_a_time_and_queue_cap(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    runner = GateRunner()
    manager = JobManager(storage, max_workers=1, queue_limit=1)
    try:
        first = manager.submit("denoise", MlJobRequest(audio_id=AUDIO_ID), runner)
        assert runner.started.wait(timeout=2)
        second = manager.submit("denoise", MlJobRequest(audio_id=AUDIO_ID), runner)
        with pytest.raises(ApiError) as exc_info:
            manager.submit("denoise", MlJobRequest(audio_id=AUDIO_ID), runner)
        assert exc_info.value.code is ErrorCode.ml_busy
        assert manager.exists(first) and manager.exists(second)
        runner.gate.set()
        assert _collect(manager, first)[-1].event == "done"
        assert _collect(manager, second)[-1].event == "done"
        assert runner.max_running == 1
    finally:
        runner.gate.set()
        manager.shutdown()


def test_progress_and_audio_persistence(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    manager = JobManager(storage, max_workers=1, queue_limit=2)
    runner = GateRunner()
    try:
        job_id = manager.submit("denoise", MlJobRequest(audio_id=AUDIO_ID), runner)
        iterator = manager.events(job_id)
        assert next(iterator).event == "progress"
        assert runner.started.wait(timeout=2)
        runner.gate.set()
        events = [next(iterator), *iterator]
        done = events[-1]
        assert done.event == "done"
        assert done.result is not None
        result_id = str(done.result["result_audio_id"])
        stored, rate = read_canonical_mono(storage, result_id)
        assert rate == 16_000
        assert stored.size == 1600
        progress_values = [
            event.progress
            for event in events
            if event.event == "progress" and event.progress is not None
        ]
        assert progress_values == sorted(progress_values)
    finally:
        runner.gate.set()
        manager.shutdown()


def test_stems_are_persisted_in_order(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    result = MlResult(
        kind="stems",
        stems=[
            StemResult("drums", np.ones(800, dtype=np.float32), 16_000),
            StemResult("vocals", np.zeros(800, dtype=np.float32), 16_000),
        ],
    )
    manager = JobManager(storage)
    try:
        job_id = manager.submit("separation", MlJobRequest(audio_id=AUDIO_ID), GateRunner(result))
        done = _collect(manager, job_id)[-1]
        assert done.event == "done" and done.result is not None
        stems = done.result["stems"]
        assert isinstance(stems, list)
        assert [stem["name"] for stem in stems] == ["drums", "vocals"]
        assert all("result_audio_id" in stem and "samples" not in stem for stem in stems)
    finally:
        manager.shutdown()


def test_transcript_result_is_returned_without_audio(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    manager = JobManager(storage)
    try:
        job_id = manager.submit("asr", MlJobRequest(audio_id=AUDIO_ID), TranscriptRunner())
        done = _collect(manager, job_id)[-1]
        assert done.event == "done" and done.result is not None
        assert done.result["kind"] == "transcript"
        assert done.result["text"] == "hello"
        assert done.result["language"] == "en"
    finally:
        manager.shutdown()


def test_cancel_between_progress_events_has_no_result(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    runner = GateRunner()
    manager = JobManager(storage)
    try:
        job_id = manager.submit("denoise", MlJobRequest(audio_id=AUDIO_ID), runner)
        assert runner.started.wait(timeout=2)
        assert manager.cancel(job_id) is True
        runner.gate.set()
        events = _collect(manager, job_id)
        assert events[-1].event == "cancelled"
        assert all(event.event != "done" for event in events)
        assert manager.cancel(job_id) is False
    finally:
        runner.gate.set()
        manager.shutdown()


def test_ttl_purges_job_and_stored_audio(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _seed(storage)
    manager = JobManager(storage, ttl_seconds=0)
    try:
        job_id = manager.submit("denoise", MlJobRequest(audio_id=AUDIO_ID), GateRunner())
        done = _collect(manager, job_id)[-1]
        assert done.result is not None
        result_id = str(done.result["result_audio_id"])
        assert storage.canonical_path(result_id).is_file()
        manager.purge_expired(now=time.time() + 1)
        assert not manager.exists(job_id)
        assert not storage.canonical_path(result_id).exists()
    finally:
        manager.shutdown()
