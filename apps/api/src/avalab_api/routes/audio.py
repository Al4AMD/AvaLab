"""DELETE /api/v1/audio/{audio_id} — remove a stored object.

Unknown and malformed ids are both 404 ``not_found``: the storage layer
validates the id pattern before any path is built, so a hostile id can never
address files outside the storage root. Streaming (GET with Range) lands in
this module in Task 8.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response

from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode
from avalab_api.storage import Storage

router = APIRouter()


@router.delete("/audio/{audio_id}", status_code=204)
def delete_audio(audio_id: str, settings: Annotated[Settings, Depends(get_settings)]) -> Response:
    """Delete the stored object; 204 on success, 404 when it does not exist."""
    storage = Storage(settings.storage_dir)
    if not storage.delete(audio_id):
        raise ApiError(ErrorCode.not_found, "Unknown audio id", 404)
    return Response(status_code=204)
