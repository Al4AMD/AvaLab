"""POST /codec/jobs, SSE progress and cancellation for full-file codecs."""

import json
from collections.abc import Iterator
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from avalab_api.codec_jobs import CodecJobManager
from avalab_api.codecs import resolve_codec, validate_params
from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode, ErrorResponse
from avalab_api.routes.codec import (
    CancelCheck,
    CodecEncodeRequest,
    CodecEncodeResponse,
    ProgressCallback,
    encode_and_store,
    read_source_info,
)
from avalab_api.storage import Storage

router = APIRouter()


class CodecJobResponse(BaseModel):
    """Accepted codec job reference."""

    job_id: str


class CodecCancelResponse(BaseModel):
    """Cancellation result; false means the job had already finished."""

    cancelled: bool


def _jobs(request: Request) -> CodecJobManager:
    return cast(CodecJobManager, request.app.state.codec_jobs)


@router.post(
    "/codec/jobs",
    status_code=202,
    responses={
        404: {"model": ErrorResponse, "description": "Unknown audio id (not_found)"},
        422: {
            "model": ErrorResponse,
            "description": "Invalid codec/params or unavailable encoder",
        },
        429: {"model": ErrorResponse, "description": "Codec queue is full (job_busy)"},
    },
)
def start_codec_job(
    body: CodecEncodeRequest,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> CodecJobResponse:
    """Validate the stored source and params, then queue a full-file job."""
    storage = Storage(settings.storage_dir)
    read_source_info(storage, storage.canonical_path(body.audio_id), body.audio_id)
    resolve_codec(body.codec)
    validate_params(body.codec, body.params.model_dump(exclude_none=True))

    def runner(
        job_request: CodecEncodeRequest,
        progress: ProgressCallback,
        cancel: CancelCheck,
    ) -> CodecEncodeResponse:
        return encode_and_store(settings, job_request, progress=progress, cancel=cancel)

    job_id = _jobs(request).submit(body, runner)
    return CodecJobResponse(job_id=job_id)


@router.get(
    "/codec/jobs/{job_id}/events",
    responses={404: {"model": ErrorResponse, "description": "Unknown job id"}},
)
def codec_job_events(job_id: str, request: Request) -> StreamingResponse:
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


@router.delete(
    "/codec/jobs/{job_id}",
    responses={404: {"model": ErrorResponse, "description": "Unknown job id"}},
)
def cancel_codec_job(job_id: str, request: Request) -> CodecCancelResponse:
    """Cancel a queued or running codec job; unknown ids are 404."""
    jobs = _jobs(request)
    if not jobs.exists(job_id):
        raise ApiError(ErrorCode.job_not_found, "Unknown job id", 404)
    return CodecCancelResponse(cancelled=jobs.cancel(job_id))
