"""Bounded in-process codec job queue with SSE events, cancel and TTL cleanup."""

import contextlib
import logging
import queue
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.routes.codec import CodecEncodeRequest, CodecEncodeResponse, CodecJobCancelled
from avalab_api.storage import Storage

LOGGER = logging.getLogger(__name__)

CodecEventName = Literal["progress", "done", "error", "cancelled"]
TerminalState = Literal["done", "error", "cancelled"]
CodecRunner = Callable[
    [CodecEncodeRequest, Callable[[float], None], Callable[[], bool]],
    CodecEncodeResponse,
]


class CodecJobEvent(BaseModel):
    """One SSE payload; ``result`` is present only on ``done``."""

    event: CodecEventName
    progress: float | None = None
    result: dict[str, object] | None = None
    code: str | None = None


@dataclass
class _Job:
    job_id: str
    request: CodecEncodeRequest
    runner: CodecRunner
    created_at: float = field(default_factory=time.time)
    state: str = "queued"
    last_progress: float = 0.0
    terminal_event: CodecJobEvent | None = None
    finished_at: float | None = None
    cancelled: bool = False
    persisted_audio_ids: list[str] = field(default_factory=list)
    events: queue.Queue[CodecJobEvent] = field(default_factory=queue.Queue)
    lock: threading.Lock = field(default_factory=threading.Lock)
    cancel_event: threading.Event = field(default_factory=threading.Event)
    future: Future[None] | None = None

    def snapshot(self) -> CodecJobEvent:
        with self.lock:
            if self.terminal_event is not None:
                return self.terminal_event
            return CodecJobEvent(event="progress", progress=self.last_progress)

    def publish_progress(self, progress: float) -> None:
        with self.lock:
            if self.cancelled or self.terminal_event is not None:
                return
            self.last_progress = min(1.0, max(0.0, progress))
            self.events.put(CodecJobEvent(event="progress", progress=self.last_progress))

    def finish(
        self, event: TerminalState, result: dict[str, object] | None, code: str | None
    ) -> None:
        with self.lock:
            if self.terminal_event is not None:
                return
            self.state = event
            self.finished_at = time.time()
            self.terminal_event = CodecJobEvent(event=event, result=result, code=code)
            self.events.put(self.terminal_event)

    def cancel(self) -> bool:
        with self.lock:
            if self.terminal_event is not None:
                return False
            self.cancelled = True
            self.cancel_event.set()
            if self.future is not None:
                self.future.cancel()
            self.state = "cancelled"
            self.finished_at = time.time()
            self.terminal_event = CodecJobEvent(event="cancelled", code="job_cancelled")
            self.events.put(self.terminal_event)
            return True

    @property
    def is_terminal(self) -> bool:
        return self.terminal_event is not None


class CodecJobManager:
    """Run at most ``max_workers`` codec jobs concurrently; reject beyond the queue cap."""

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
        self._stop = threading.Event()
        self._sweeper: threading.Thread | None = None
        self._closed = False

    def submit(self, request: CodecEncodeRequest, runner: CodecRunner) -> str:
        with self._lock:
            if self._closed:
                raise ApiError(ErrorCode.job_busy, "Job manager is shutting down", 429)
            active = sum(not job.is_terminal for job in self._jobs.values())
            if active >= self.max_workers + self.queue_limit:
                raise ApiError(ErrorCode.job_busy, "Codec queue is full", 429)
            job = _Job(
                job_id=self.storage.new_audio_id(),
                request=request,
                runner=runner,
            )
            self._jobs[job.job_id] = job
            job.future = self._executor.submit(self._run, job)
            self._ensure_sweeper()
        return job.job_id

    def events(self, job_id: str) -> Iterator[CodecJobEvent]:
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
        return self._get(job_id).cancel()

    def exists(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._jobs

    def purge_expired(self, now: float | None = None) -> None:
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
            result = job.runner(
                job.request,
                job.publish_progress,
                job.cancel_event.is_set,
            )
            if job.cancelled:
                self.storage.delete(result.result_audio_id)
                return
            job.persisted_audio_ids.append(result.result_audio_id)
            job.finish("done", result.model_dump(), None)
        except CodecJobCancelled:
            return
        except ApiError as exc:
            job.finish("error", None, exc.code.value)
        except Exception:
            LOGGER.exception("Codec job failed")
            job.finish("error", None, ErrorCode.encode_failed.value)

    def _ensure_sweeper(self) -> None:
        if self._sweeper is not None or self.ttl_seconds <= 0:
            return
        self._sweeper = threading.Thread(target=self._sweep, daemon=True)
        self._sweeper.start()

    def _sweep(self) -> None:
        while not self._stop.wait(60):
            with contextlib.suppress(Exception):
                self.purge_expired()
