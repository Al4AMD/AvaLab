"""POST /api/v1/ingest — validate an upload with ffprobe, normalize to canonical WAV.

Validation order (fail fast, limits before heavy work):
1. written-bytes cap while streaming the upload  -> 413 file_too_large
2. ffprobe (real decode probe, never extension/MIME) -> 422 decode_failed
3. duration above the configured cap            -> 422 duration_too_long
4. transcode to float32 PCM WAV at
   min(source_sample_rate, max_sample_rate_hz) and min(source_channels, max_channels)

Any failure after a temp file exists removes the partial audio directory and
the temp files, so a rejected request leaves no trace on disk. The uploaded
filename is never persisted (privacy).
"""

import os
import tempfile
import time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel

from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ffmpeg import probe, transcode_to_canonical_wav
from avalab_api.storage import Storage

router = APIRouter()

UPLOAD_CHUNK_BYTES = 1024 * 1024
UPLOAD_TEMP_PREFIX = "avalab_upload_"
TRANSCODE_TEMP_PREFIX = "avalab_transcode_"


class IngestResponse(BaseModel):
    """Canonical audio handle returned by a successful ingest."""

    audio_id: str
    duration_s: float
    sample_rate_hz: int
    channels: int
    size_bytes: int


@router.post("/ingest")
def ingest(
    file: Annotated[UploadFile, File()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> IngestResponse:
    """Accept one uploaded audio file and store its normalized canonical form."""
    storage = Storage(settings.storage_dir)
    audio_id = storage.new_audio_id()
    upload_path: Path | None = None
    transcode_path: Path | None = None

    try:
        upload_path = _stream_upload_to_temp(file, settings.max_upload_bytes)
        probed = probe(upload_path)
        if probed.duration_s > settings.max_duration_seconds:
            raise ApiError(
                ErrorCode.duration_too_long,
                "Audio exceeds the maximum duration of "
                f"{settings.max_duration_seconds} seconds",
                422,
            )
        sample_rate_hz = min(probed.sample_rate_hz, settings.max_sample_rate_hz)
        channels = min(probed.channels, settings.max_channels)

        fd, transcode_name = tempfile.mkstemp(prefix=TRANSCODE_TEMP_PREFIX, suffix=".wav")
        os.close(fd)
        transcode_path = Path(transcode_name)
        transcode_to_canonical_wav(upload_path, transcode_path, sample_rate_hz, channels)

        storage.save_canonical(
            audio_id,
            transcode_path,
            {
                "audio_id": audio_id,
                "duration_s": probed.duration_s,
                "sample_rate_hz": sample_rate_hz,
                "channels": channels,
                "original_format": probed.format_name or "unknown",
                "created_at_unix": int(time.time()),
            },
        )
        transcode_path = None  # moved into storage by save_canonical
        size_bytes = storage.canonical_path(audio_id).stat().st_size
        return IngestResponse(
            audio_id=audio_id,
            duration_s=probed.duration_s,
            sample_rate_hz=sample_rate_hz,
            channels=channels,
            size_bytes=size_bytes,
        )
    except BaseException:
        storage.delete(audio_id)
        raise
    finally:
        if upload_path is not None:
            upload_path.unlink(missing_ok=True)
        if transcode_path is not None:
            transcode_path.unlink(missing_ok=True)


def _stream_upload_to_temp(file: UploadFile, max_upload_bytes: int) -> Path:
    """Copy the upload to a temp file, aborting as soon as the cap is exceeded."""
    fd, temp_name = tempfile.mkstemp(prefix=UPLOAD_TEMP_PREFIX, suffix=".bin")
    path = Path(temp_name)
    written_bytes = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = file.file.read(UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                written_bytes += len(chunk)
                if written_bytes > max_upload_bytes:
                    raise ApiError(
                        ErrorCode.file_too_large,
                        f"Upload exceeds the maximum size of {max_upload_bytes} bytes",
                        413,
                    )
                out.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path
