"""Bounded in-process ML job manager with progress events and result storage."""

import contextlib
import logging
import queue
import threading
import time
from collections.abc import Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Literal, cast

import numpy as np
from pydantic import BaseModel, Field

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.audio import duration_seconds, read_canonical_mono, write_result_wav
from avalab_api.ml.models import MlTask, ModelRunner
from avalab_api.storage import Storage

LOGGER = logging.getLogger(__name__)

JobEventName = Literal["progress", "done", "error", "cancelled"]
TerminalState = Literal["done", "error", "cancelled"]


class MlJobRequest(BaseModel):
    """Reference to stored audio plus task-specific parameters."""

    audio_id: str
    params: dict[str, object] = Field(default_factory=dict)


class JobEvent(BaseModel):
    """One SSE payload; ``result`` is present only on ``done``."""

    event: JobEventName
    progress: float | None = None
    result: dict[str, object] | None = None
    code: str | None = None


@dataclass
class StemResult:
    """One separated stem before the manager stores it."""

    name: str
    samples: np.ndarray
    sample_rate_hz: int


@dataclass
class MlResult:
    """Runner output; samples never leave the manager as JSON."""

    kind: Literal["audio", "stems", "transcript"]
    samples: np.ndarray | None = None
    sample_rate_hz: int | None = None
    stems: list[StemResult] | None = None
    text: str | None = None
    segments: list[dict[str, object]] | None = None
    language: str | None = None
    stats: dict[str, object] = field(default_factory=dict)


class _Cancelled(Exception):
    """Raised by the progress callback once a job is cancelled."""


@dataclass
class _Job:
    job_id: str
    task: MlTask
    request: MlJobRequest
    runner: ModelRunner
    created_at: float = field(default_factory=time.time)
    state: str = "queued"
    last_progress: float = 0.0
    terminal_event: JobEvent | None = None
    finished_at: float | None = None
    cancelled: bool = False
    persisted_audio_ids: list[str] = field(default_factory=list)
    events: queue.Queue[JobEvent] = field(default_factory=queue.Queue)
    lock: threading.Lock = field(default_factory=threading.Lock)
    future: Future[None] | None = None

    def snapshot(self) -> JobEvent:
        with self.lock:
            if self.terminal_event is not None:
                return self.terminal_event
            return JobEvent(event="progress", progress=self.last_progress)

    def publish_progress(self, progress: float) -> None:
        with self.lock:
            if self.cancelled or self.terminal_event is not None:
                raise _Cancelled
            self.last_progress = min(1.0, max(0.0, progress))
            self.events.put(JobEvent(event="progress", progress=self.last_progress))

    def finish(self, event: TerminalState, result: dict[str, object] | None, code: str | None) -> None:
        with self.lock:
            if self.terminal_event is not None:
                return
            self.state = event
            self.finished_at = time.time()
            self.terminal_event = JobEvent(event=event, result=result, code=code)
            self.events.put(self.terminal_event)

    def cancel(self) -> bool:
        with self.lock:
            if self.terminal_event is not None:
                return False
            self.cancelled = True
            if self.future is not None:
                self.future.cancel()
            self.state = "cancelled"
            self.finished_at = time.time()
            self.terminal_event = JobEvent(event="cancelled", code="job_cancelled")
            self.events.put(self.terminal_event)
            return True

    @property
    def is_terminal(self) -> bool:
        return self.terminal_event is not None


class JobManager:
    """Run at most ``max_workers`` jobs concurrently; reject beyond the queue cap."""

    def __init__(
        self,
        storage: Storage,
        max_workers: int = 1,
        queue_limit: int = 8,
        ttl_seconds: int = 3600,
    ) -> None:
        self.storage = storage
        self.max_workers = max(1, max_workers)
        self.queue_limit = max(0, queue_limit)
        self.ttl_seconds = max(0, ttl_seconds)
        self._executor = ThreadPoolExecutor(max_workers=self.max_workers)
        self._jobs: dict[str, _Job] = {}
        self._lock = threading.Lock()
        self._sweeper: threading.Thread | None = None
        self._stop = threading.Event()
        self._closed = False

    def submit(self, task: MlTask, request: MlJobRequest, runner: ModelRunner) -> str:
        """Queue a job; raises ``ml_busy`` when all worker+queue slots are used."""
        with self._lock:
            if self._closed:
                raise ApiError(ErrorCode.ml_busy, "Job manager is shutting down", 429)
            active = sum(not job.is_terminal for job in self._jobs.values())
            if active >= self.max_workers + self.queue_limit:
                raise ApiError(ErrorCode.ml_busy, "ML queue is full", 429)
            job = _Job(
                job_id=self.storage.new_audio_id(),
                task=task,
                request=request,
                runner=runner,
            )
            self._jobs[job.job_id] = job
            job.future = self._executor.submit(self._run, job)
        self._ensure_sweeper()
        return job.job_id

    def events(self, job_id: str) -> Iterator[JobEvent]:
        """Yield a snapshot, then live progress and one terminal event."""
        job = self._get(job_id)
        snapshot = job.snapshot()
        yield snapshot
        if snapshot.event in {"done", "error", "cancelled"}:
            return
        while True:
            try:
                event = job.events.get(timeout=0.05)
            except queue.Empty:
                if job.terminal_event is not None:
                    yield job.terminal_event
                    return
                continue
            yield event
            if event.event in {"done", "error", "cancelled"}:
                return

    def cancel(self, job_id: str) -> bool:
        """Cancel a queued/running job; returns False when already terminal."""
        return self._get(job_id).cancel()

    def exists(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._jobs

    def purge_expired(self, now: float | None = None) -> None:
        """Delete terminal jobs and their stored result WAVs after the TTL."""
        cutoff = (now if now is not None else time.time()) - self.ttl_seconds
        with self._lock:
            expired = [
                job_id
                for job_id, job in self._jobs.items()
                if job.is_terminal and (job.finished_at or job.created_at) <= cutoff
            ]
            jobs = [self._jobs.pop(job_id) for job_id in expired]
        for job in jobs:
            for audio_id in job.persisted_audio_ids:
                self.storage.delete(audio_id)

    def shutdown(self) -> None:
        """Stop the sweeper and reject new work; running threads are not killed."""
        self._closed = True
        self._stop.set()
        with self._lock:
            jobs = list(self._jobs.values())
        for job in jobs:
            job.cancel()
        self._executor.shutdown(wait=False, cancel_futures=True)

    def _get(self, job_id: str) -> _Job:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise ApiError(ErrorCode.job_not_found, "Unknown job id", 404)
        return job

    def _run(self, job: _Job) -> None:
        with job.lock:
            if job.cancelled:
                return
            job.state = "running"
        try:
            samples, sample_rate_hz = read_canonical_mono(self.storage, job.request.audio_id)
            result = cast(
                MlResult,
                job.runner.run(
                    samples,
                    sample_rate_hz,
                    job.request.params,
                    job.publish_progress,
                ),
            )
            if job.cancelled:
                return
            payload = self._persist(job, result)
            job.finish("done", payload, None)
        except _Cancelled:
            return
        except ApiError as exc:
            job.finish("error", None, exc.code.value)
        except Exception:
            LOGGER.exception("ML job %s failed", job.task)
            job.finish("error", None, ErrorCode.ml_failed.value)

    def _persist(self, job: _Job, result: MlResult) -> dict[str, object]:
        if result.kind == "audio":
            if result.samples is None or result.sample_rate_hz is None:
                raise ApiError(ErrorCode.ml_failed, "Runner returned no audio", 500)
            audio_id = write_result_wav(self.storage, result.samples, result.sample_rate_hz)
            job.persisted_audio_ids.append(audio_id)
            return {
                "kind": "audio",
                "result_audio_id": audio_id,
                "sample_rate_hz": result.sample_rate_hz,
                "duration_s": duration_seconds(result.samples.size, result.sample_rate_hz),
                "stats": result.stats,
            }
        if result.kind == "stems":
            if not result.stems:
                raise ApiError(ErrorCode.ml_failed, "Runner returned no stems", 500)
            stems: list[dict[str, object]] = []
            for stem in result.stems:
                audio_id = write_result_wav(self.storage, stem.samples, stem.sample_rate_hz)
                job.persisted_audio_ids.append(audio_id)
                stems.append(
                    {
                        "name": stem.name,
                        "result_audio_id": audio_id,
                        "sample_rate_hz": stem.sample_rate_hz,
                        "duration_s": duration_seconds(stem.samples.size, stem.sample_rate_hz),
                    }
                )
            return {"kind": "stems", "stems": stems, "stats": result.stats}
        return {
            "kind": "transcript",
            "text": result.text,
            "segments": result.segments or [],
            "language": result.language,
            "stats": result.stats,
        }

    def _ensure_sweeper(self) -> None:
        if self._sweeper is not None or self.ttl_seconds <= 0:
            return
        self._sweeper = threading.Thread(target=self._sweep_loop, daemon=True)
        self._sweeper.start()

    def _sweep_loop(self) -> None:
        interval = max(1.0, min(60.0, self.ttl_seconds / 2))
        while not self._stop.wait(interval):
            with contextlib.suppress(Exception):
                self.purge_expired()
