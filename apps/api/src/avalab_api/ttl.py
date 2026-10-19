"""TTL sweeper for stored audio objects (privacy promise, AGENTS.md section 7).

Every stored object carries ``meta.json`` with ``created_at_unix``. Objects
older than the TTL must disappear even when their bookkeeping is broken: a
missing meta.json, unreadable or invalid JSON, and a missing/non-numeric or
non-finite ``created_at_unix`` all count as expired (fail closed: the promise
is deletion after the TTL, so an unreadable object is deleted, not kept
forever).

``sweep_expired`` is a pure synchronous function with an injectable ``now``,
so it is unit-testable without a clock or event loop. ``sweep_loop`` is the
async wrapper used by the app lifespan; its only extra job is to never die: an
error in one iteration (for example an unreadable storage root) must not stop
all future sweeps until the next restart.
"""

import asyncio
import json
import logging
import math
import time
from pathlib import Path

from avalab_api.storage import AUDIO_ID_PATTERN, META_FILENAME, Storage

LOGGER = logging.getLogger(__name__)

SWEEPER_TASK_NAME = "avalab-ttl-sweeper"


def sweep_expired(storage: Storage, ttl_seconds: float, now: float | None = None) -> list[str]:
    """Delete stored objects older than ``ttl_seconds``; return the deleted ids.

    Only direct subdirectories whose name is a valid audio id are considered,
    so loose files and foreign directories are never touched. An object is
    expired when its meta.json is missing, unreadable, invalid JSON, or lacks a
    finite numeric ``created_at_unix``, or when
    ``now - created_at_unix > ttl_seconds`` (strictly greater, so an object
    exactly at the boundary survives one more sweep). Ids are returned only
    when their directory is actually gone.
    """
    if now is None:
        now = time.time()
    if not storage.root.is_dir():
        return []
    deleted: list[str] = []
    for entry in sorted(storage.root.iterdir()):
        if (
            entry.is_dir()
            and AUDIO_ID_PATTERN.fullmatch(entry.name)
            and _is_expired(entry, ttl_seconds, now)
            and storage.delete(entry.name)
        ):
            deleted.append(entry.name)
    return deleted


def _is_expired(directory: Path, ttl_seconds: float, now: float) -> bool:
    """True when bookkeeping is unusable (fail closed) or the age exceeds the TTL."""
    try:
        meta = json.loads((directory / META_FILENAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return True
    if not isinstance(meta, dict):
        return True
    created_at_unix = meta.get("created_at_unix")
    if isinstance(created_at_unix, bool) or not isinstance(created_at_unix, (int, float)):
        return True
    # Only floats can be non-finite. Checking by type first keeps
    # ``math.isfinite`` away from absurdly large ints, where it would raise
    # OverflowError and leave the object un-swept (fail open).
    if isinstance(created_at_unix, float) and not math.isfinite(created_at_unix):
        return True
    return now - created_at_unix > ttl_seconds


async def sweep_loop(storage: Storage, ttl_seconds: float, interval_seconds: float) -> None:
    """Sweep every ``interval_seconds``; return cleanly when cancelled.

    A failing iteration is swallowed after a warning with no paths or audio
    details (AGENTS.md section 7): a transient filesystem error must not take
    the sweeper down until the next restart.
    """
    while True:
        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            return
        try:
            sweep_expired(storage, ttl_seconds)
        except Exception:  # noqa: BLE001 — one bad sweep must never stop the loop
            LOGGER.warning("ttl sweep iteration failed")
