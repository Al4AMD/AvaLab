"""Filesystem layout for stored audio objects.

Every ingested file lands in ``<storage_dir>/<audio_id>/`` as ``audio.wav``
(canonical float32 PCM) plus ``meta.json``. Ids are server-generated uuid4 hex;
caller-supplied ids are validated against a strict pattern before any path is
built, so a hostile id can never escape the storage root.
"""

import json
import os
import re
import shutil
import uuid
from pathlib import Path

from avalab_api.errors import ApiError, ErrorCode

AUDIO_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
CANONICAL_FILENAME = "audio.wav"
META_FILENAME = "meta.json"


class Storage:
    """Path builder and atomic writer bound to a storage root directory."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def new_audio_id(self) -> str:
        """Return a fresh server-generated id (uuid4 hex, 32 chars)."""
        return uuid.uuid4().hex

    def audio_dir(self, audio_id: str) -> Path:
        """Directory for ``audio_id``; rejects ids that fail the pattern."""
        if not AUDIO_ID_PATTERN.fullmatch(audio_id):
            raise ApiError(ErrorCode.not_found, "Unknown audio id", 404)
        return self.root / audio_id

    def canonical_path(self, audio_id: str) -> Path:
        """Path of the canonical float32 WAV for ``audio_id``."""
        return self.audio_dir(audio_id) / CANONICAL_FILENAME

    def meta_path(self, audio_id: str) -> Path:
        """Path of the metadata JSON for ``audio_id``."""
        return self.audio_dir(audio_id) / META_FILENAME

    def save_canonical(self, audio_id: str, source: Path | bytes, meta: dict[str, object]) -> None:
        """Place canonical audio at ``audio_id`` and write its metadata.

        ``source`` is either raw WAV bytes or a path to a completed WAV file
        (moved into place when the OS allows, copied otherwise).
        """
        directory = self.audio_dir(audio_id)
        directory.mkdir(parents=True, exist_ok=True)
        destination = self.canonical_path(audio_id)
        if isinstance(source, bytes):
            destination.write_bytes(source)
        else:
            shutil.move(str(source), destination)
        self.write_meta(audio_id, meta)

    def write_meta(self, audio_id: str, meta: dict[str, object]) -> None:
        """Write ``meta.json`` atomically (temp file + os.replace)."""
        meta_path = self.meta_path(audio_id)
        tmp_path = meta_path.parent / (META_FILENAME + ".tmp")
        tmp_path.write_text(
            json.dumps(meta, ensure_ascii=False, sort_keys=True), encoding="utf-8"
        )
        os.replace(tmp_path, meta_path)

    def delete(self, audio_id: str) -> bool:
        """Remove the ``audio_id`` directory tree; True when something was deleted."""
        directory = self.audio_dir(audio_id)
        if not directory.exists():
            return False
        shutil.rmtree(directory, ignore_errors=True)
        return True
