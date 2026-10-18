"""DELETE and GET /api/v1/audio/{audio_id} — remove or stream a stored object.

Unknown and malformed ids are both 404 ``not_found``: the storage layer
validates the id pattern before any path is built, so a hostile id can never
address files outside the storage root.

Range semantics (verified empirically against installed starlette 1.9.0):

- valid single ranges (``bytes=start-end``, ``bytes=start-``, ``bytes=-suffix``)
  and multi-ranges are delegated to Starlette's ``FileResponse``; a
  multi-range request is answered with RFC 9110 ``multipart/byteranges``
  (not "first range only");
- well-formed unsatisfiable single ranges (start >= size, suffix 0) are
  rejected in the route with 416 ``range_not_satisfiable`` and
  ``Content-Range: bytes */<size>`` because FileResponse's own 416 is a bare
  text response emitted in the send phase, bypassing FastAPI exception
  handlers and thus the API error envelope;
- malformed or inverted ranges are rejected by FileResponse itself with a
  plain-text 400 (no JSON envelope); spacing oddities in the header also fall
  through to FileResponse, which classifies them itself.
"""

import re
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response
from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode
from avalab_api.storage import Storage

router = APIRouter()

_SINGLE_RANGE_PATTERN = re.compile(r"^\s*bytes=(\d*)-(\d*)\s*$", re.IGNORECASE)


def _reject_unsatisfiable_range(range_header: str, size_bytes: int) -> None:
    """Raise the 416 API envelope for unsatisfiable well-formed single ranges.

    Only ``bytes=<start>-`` / ``bytes=<start>-<end>`` with start >= size and
    ``bytes=-0`` are intercepted; anything else (multi-range, malformed, odd
    spacing) is left to FileResponse, which classifies those cases itself.
    """
    match = _SINGLE_RANGE_PATTERN.fullmatch(range_header)
    if match is None:
        return
    start_text, end_text = match.group(1), match.group(2)
    suffix_is_empty = start_text == "" and end_text == "0"
    start_beyond_file = start_text != "" and int(start_text) >= size_bytes
    if suffix_is_empty or start_beyond_file:
        raise StarletteHTTPException(
            status_code=416,
            detail="Requested range is not satisfiable",
            headers={"Content-Range": f"bytes */{size_bytes}"},
        )


@router.get("/audio/{audio_id}")
def get_audio(
    audio_id: str,
    settings: Annotated[Settings, Depends(get_settings)],
    range_header: Annotated[str | None, Header(alias="Range")] = None,
) -> FileResponse:
    """Stream the canonical WAV: 200 full, 206 for a valid Range request.

    Range edge semantics are documented at module level; multi-range requests
    are served as ``multipart/byteranges`` by FileResponse.
    """
    storage = Storage(settings.storage_dir)
    path = storage.canonical_path(audio_id)
    if not path.is_file():
        raise ApiError(ErrorCode.not_found, "Unknown audio id", 404)
    if range_header is not None:
        _reject_unsatisfiable_range(range_header, path.stat().st_size)
    return FileResponse(path, media_type="audio/wav")


@router.delete("/audio/{audio_id}", status_code=204)
def delete_audio(audio_id: str, settings: Annotated[Settings, Depends(get_settings)]) -> Response:
    """Delete the stored object; 204 on success, 404 when it does not exist."""
    storage = Storage(settings.storage_dir)
    if not storage.delete(audio_id):
        raise ApiError(ErrorCode.not_found, "Unknown audio id", 404)
    return Response(status_code=204)
