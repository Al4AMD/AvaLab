"""POST /ml/{task}, job events SSE and cancellation."""

import json
from collections.abc import Iterator
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.jobs import JobManager, MlJobRequest
from avalab_api.ml.models import MlTask, ModelRunner
from avalab_api.storage import Storage

router = APIRouter()


class MlJobResponse(BaseModel):
    """Accepted job reference."""

    job_id: str


class CancelResponse(BaseModel):
    """Cancellation result; false means the job had already finished."""

    cancelled: bool


def _jobs(request: Request) -> JobManager:
    return cast(JobManager, request.app.state.ml_jobs)


@router.post("/ml/{task}", status_code=202)
def start_job(
    task: MlTask,
    body: MlJobRequest,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> MlJobResponse:
    """Validate the excerpt/model and queue the task."""
    if not settings.ml_enabled:
        raise ApiError(ErrorCode.model_unavailable, "ML tools are disabled", 503)
    _check_excerpt(settings, body.audio_id)
    factory = getattr(request.app.state, "ml_runner_factory", None)
    runner = (
        cast(ModelRunner, factory(task))
        if factory is not None
        else cast(ModelRunner, request.app.state.model_registry.require(task))
    )
    job_id = _jobs(request).submit(task, body, runner)
    return MlJobResponse(job_id=job_id)


@router.get("/jobs/{job_id}/events")
def job_events(job_id: str, request: Request) -> StreamingResponse:
    """Stream one snapshot, progress updates, then a terminal event."""
    jobs = _jobs(request)
    if not jobs.exists(job_id):
        raise ApiError(ErrorCode.job_not_found, "Unknown job id", 404)

    def frames() -> Iterator[str]:
        for event in jobs.events(job_id):
            yield f"data: {json.dumps(event.model_dump(), separators=(',', ':'))}\n\n"

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/jobs/{job_id}")
def cancel_job(job_id: str, request: Request) -> CancelResponse:
    """Cancel a queued or running job; unknown ids are 404."""
    jobs = _jobs(request)
    if not jobs.exists(job_id):
        raise ApiError(ErrorCode.job_not_found, "Unknown job id", 404)
    return CancelResponse(cancelled=jobs.cancel(job_id))


def _check_excerpt(settings: Settings, audio_id: str) -> None:
    """Read trusted metadata only; the worker streams the PCM afterwards."""
    storage = Storage(settings.storage_dir)
    meta_path = storage.meta_path(audio_id)
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ApiError(ErrorCode.not_found, "Unknown audio id", 404) from None
    duration = meta.get("duration_s") if isinstance(meta, dict) else None
    if not isinstance(duration, (int, float)):
        raise ApiError(ErrorCode.not_found, "Audio metadata is incomplete", 404)
    if duration > settings.ml_max_excerpt_seconds:
        raise ApiError(
            ErrorCode.invalid_request,
            f"Excerpt exceeds {settings.ml_max_excerpt_seconds} s",
            422,
        )
