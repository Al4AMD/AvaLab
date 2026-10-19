"""DELETE and GET /api/v1/audio/{audio_id} — remove or stream a stored object.

Unknown and malformed ids are both 404 ``not_found``: the storage layer
validates the id pattern before any path is built, so a hostile id can never
address files outside the storage root.

Range semantics (all error bodies use the API envelope):

- the route validates every Range header before ``FileResponse`` sees it,
  because FileResponse classifies malformed/unsatisfiable ranges with a
  plain-text 400/416 emitted in the send phase, bypassing FastAPI exception
  handlers (verified empirically against installed starlette 1.9.0);
- accepted grammar: a single ``bytes=(\\d*)-(\\d*)`` spec with at least one
  non-empty group, or a comma-joined list of such specs (no whitespace inside
  the spec list); any other header is rejected with 400 envelope
  ``invalid_request``, as is a list longer than ``FileResponse.max_ranges``;
- any spec with a digit run longer than 18 characters is rejected with 400
  envelope ``invalid_request`` before the first ``int()`` call, so every
  parsed value is <= 10**18 and CPython's 4300-digit ``int()`` limit is
  unreachable from both this route and Starlette's parser;
- a grammar-valid header whose parts include an inverted range (both numbers
  present, end < start), a start beyond the file, or a zero-valued suffix is
  rejected as a whole with 416 envelope ``range_not_satisfiable`` and
  ``Content-Range: bytes */<size>``; suffix values are compared numerically,
  so every zero-padding (``-0``, ``-00``, ``-000``) is equally unsatisfiable;
- valid single ranges and valid multi-ranges pass through to Starlette's
  ``FileResponse``: single range → 206, multi-range → RFC 9110
  ``multipart/byteranges`` (not "first range only").
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

_RANGE_PREFIX = "bytes="
_RANGE_SPEC_PATTERN = re.compile(r"(\d*)-(\d*)\Z")
_MAX_RANGE_DIGITS = 18


def _validate_range_header(range_header: str, size_bytes: int) -> None:
    """Reject malformed, inverted and unsatisfiable Range headers with envelopes.

    Grammar-invalid headers and specs with a digit run longer than
    ``_MAX_RANGE_DIGITS`` raise 400 ``invalid_request``. Capping digit length
    keeps every later ``int()`` — and the ones inside Starlette's range parser
    — far below CPython's 4300-digit conversion limit, so no ValueError can
    escape as a 500 or degrade to a plain-text response. Grammar-valid headers
    with any non-servable part (end < start checked before start >= size, so
    inverted ranges classify independently of the file size) raise 416
    ``range_not_satisfiable`` with the ``Content-Range`` header; servable
    headers return without raising and are delegated to FileResponse.
    """
    header = range_header.strip()
    if header[: len(_RANGE_PREFIX)].lower() != _RANGE_PREFIX:
        raise ApiError(ErrorCode.invalid_request, "Malformed Range header", 400)
    specs: list[tuple[str, str]] = []
    for part in header[len(_RANGE_PREFIX) :].split(","):
        match = _RANGE_SPEC_PATTERN.fullmatch(part)
        if match is None or (match.group(1) == "" and match.group(2) == ""):
            raise ApiError(ErrorCode.invalid_request, "Malformed Range header", 400)
        if len(match.group(1)) > _MAX_RANGE_DIGITS or len(match.group(2)) > _MAX_RANGE_DIGITS:
            raise ApiError(ErrorCode.invalid_request, "Range value too long", 400)
        specs.append((match.group(1), match.group(2)))
    if len(specs) > FileResponse.max_ranges:
        raise ApiError(ErrorCode.invalid_request, "Too many ranges requested", 400)
    for start_text, end_text in specs:
        end_before_start = start_text != "" and end_text != "" and int(end_text) < int(start_text)
        start_beyond_file = start_text != "" and int(start_text) >= size_bytes
        suffix_unsatisfiable = start_text == "" and (int(end_text) == 0 or size_bytes == 0)
        if end_before_start or start_beyond_file or suffix_unsatisfiable:
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
    try:
        size_bytes = path.stat().st_size
    except OSError:
        # Any stat failure (missing file, tampered tree) is a 404 envelope,
        # never an uncaught 500.
        raise ApiError(ErrorCode.not_found, "Unknown audio id", 404) from None
    if range_header is not None:
        _validate_range_header(range_header, size_bytes)
    return FileResponse(path, media_type="audio/wav")


@router.delete("/audio/{audio_id}", status_code=204)
def delete_audio(audio_id: str, settings: Annotated[Settings, Depends(get_settings)]) -> Response:
    """Delete the stored object; 204 on success, 404 when it does not exist."""
    storage = Storage(settings.storage_dir)
    if not storage.delete(audio_id):
        raise ApiError(ErrorCode.not_found, "Unknown audio id", 404)
    return Response(status_code=204)
