"""TTL sweeper and DELETE /api/v1/audio/{audio_id} contract tests.

Every test pins storage_dir into pytest's tmp tree, so the sweeper can never
touch the repository tree. Malformed bookkeeping (missing meta.json, invalid
JSON, missing/non-numeric created_at_unix) counts as expired: the privacy
promise is deletion after the TTL, so unreadable objects fail closed.
"""

import asyncio
import json
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from avalab_api.config import Settings, get_settings
from avalab_api.main import API_PREFIX, create_app
from avalab_api.storage import Storage
from avalab_api.ttl import SWEEPER_TASK_NAME, sweep_expired, sweep_loop


@pytest.fixture()
def storage_root(tmp_path: Path) -> Path:
    """Storage directory inside pytest's tmp tree, never the repo tree."""
    return tmp_path / "storage"


def store_object(
    storage_root: Path,
    *,
    audio_id: str | None = None,
    created_at_unix: float | None = None,
    meta_text: str | None = None,
    write_meta: bool = True,
) -> str:
    """Create one stored object directory; returns its id.

    ``created_at_unix=None`` omits the key from meta.json; ``meta_text`` writes
    raw text instead of JSON; ``write_meta=False`` leaves meta.json absent.
    """
    storage = Storage(storage_root)
    resolved_id = audio_id or storage.new_audio_id()
    directory = storage_root / resolved_id
    directory.mkdir(parents=True)
    (directory / "audio.wav").write_bytes(b"RIFF....WAVE")
    if write_meta:
        if meta_text is not None:
            (directory / "meta.json").write_text(meta_text, encoding="utf-8")
        else:
            meta: dict[str, object] = {
                "audio_id": resolved_id,
                "duration_s": 1.0,
                "sample_rate_hz": 44100,
                "channels": 1,
                "original_format": "wav",
            }
            if created_at_unix is not None:
                meta["created_at_unix"] = created_at_unix
            (directory / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return resolved_id


@contextmanager
def make_client(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, **settings_overrides: object
) -> Iterator[TestClient]:
    """TestClient whose app and routes read settings pinned to ``storage_root``.

    ``monkeypatch`` is required so ``create_app`` and the lifespan sweeper both
    see the pinned settings.
    """
    settings = Settings(storage_dir=storage_root, **settings_overrides)
    monkeypatch.setattr("avalab_api.main.get_settings", lambda: settings)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def test_sweep_expired_deletes_only_expired_objects(storage_root: Path) -> None:
    now = time.time()
    ttl_seconds = 3600
    stale_id = store_object(storage_root, created_at_unix=now - 61 * 60)
    fresh_id = store_object(storage_root, created_at_unix=now)
    boundary_id = store_object(storage_root, created_at_unix=now - ttl_seconds)
    not_an_id_dir = storage_root / "not-a-uuid"
    not_an_id_dir.mkdir()
    (not_an_id_dir / "meta.json").write_text('{"created_at_unix": 0}', encoding="utf-8")
    loose_file = storage_root / "loose.txt"
    loose_file.write_text("keep me", encoding="utf-8")

    deleted = sweep_expired(Storage(storage_root), ttl_seconds, now=now)

    assert deleted == [stale_id]
    assert not (storage_root / stale_id).exists()
    assert (storage_root / fresh_id / "meta.json").is_file()
    assert (storage_root / boundary_id / "meta.json").is_file()
    assert (not_an_id_dir / "meta.json").is_file()
    assert loose_file.is_file()


def test_sweep_expired_deletes_malformed_metadata(storage_root: Path) -> None:
    now = time.time()
    no_meta_id = store_object(storage_root, write_meta=False)
    bad_json_id = store_object(storage_root, meta_text="{not json")
    missing_created_id = store_object(storage_root)
    non_numeric_id = store_object(
        storage_root, meta_text=json.dumps({"created_at_unix": "yesterday"})
    )

    deleted = sweep_expired(Storage(storage_root), ttl_seconds=3600, now=now)

    assert set(deleted) == {no_meta_id, bad_json_id, missing_created_id, non_numeric_id}
    for audio_id in deleted:
        assert not (storage_root / audio_id).exists()


def test_sweep_expired_deletes_non_finite_created_at(storage_root: Path) -> None:
    now = time.time()
    nan_id = store_object(storage_root, meta_text='{"created_at_unix": NaN}')
    inf_id = store_object(storage_root, meta_text='{"created_at_unix": Infinity}')

    deleted = sweep_expired(Storage(storage_root), ttl_seconds=3600, now=now)

    assert set(deleted) == {nan_id, inf_id}
    for audio_id in deleted:
        assert not (storage_root / audio_id).exists()


def test_sweep_expired_deletes_huge_integer_created_at(storage_root: Path) -> None:
    now = time.time()
    huge_int_id = store_object(
        storage_root, meta_text=json.dumps({"created_at_unix": 10**400})
    )

    deleted = sweep_expired(Storage(storage_root), ttl_seconds=3600, now=now)

    assert deleted == [huge_int_id]
    assert not (storage_root / huge_int_id).exists()


def test_sweep_expired_tolerates_missing_storage_root(tmp_path: Path) -> None:
    assert sweep_expired(Storage(tmp_path / "absent"), ttl_seconds=3600) == []


def test_delete_audio_returns_204_then_404(storage_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    audio_id = store_object(storage_root, created_at_unix=time.time())

    with make_client(storage_root, monkeypatch) as client:
        first = client.delete(f"{API_PREFIX}/audio/{audio_id}")
        assert first.status_code == 204
        assert first.content == b""
        assert not (storage_root / audio_id).exists()

        second = client.delete(f"{API_PREFIX}/audio/{audio_id}")
        assert second.status_code == 404
        assert second.json()["error"]["code"] == "not_found"


def test_delete_audio_rejects_invalid_id_with_404(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        response = client.delete(f"{API_PREFIX}/audio/not-a-uuid")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


async def _find_sweeper_task() -> asyncio.Task[None] | None:
    """Return the running sweeper task; must run inside the app's event loop.

    Declared ``async`` on purpose: anyio's ``portal.call`` awaits a returned
    awaitable, and an ``asyncio.Task`` is awaitable — returning the task from a
    plain function would make the portal await the sweeper forever.
    """
    current = asyncio.current_task()
    for task in asyncio.all_tasks():
        if task is not current and task.get_name() == SWEEPER_TASK_NAME:
            return task
    return None


def test_lifespan_starts_and_cancels_sweeper_task(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = Settings(storage_dir=storage_root)
    monkeypatch.setattr("avalab_api.main.get_settings", lambda: settings)
    app = create_app()

    with TestClient(app) as client:
        assert client.portal is not None
        sweeper = client.portal.call(_find_sweeper_task)
        assert sweeper is not None
        assert not sweeper.done()

    assert sweeper.done()


def test_sweep_loop_sweeps_periodically_and_stops_on_cancel(storage_root: Path) -> None:
    async def scenario() -> None:
        stale_id = store_object(storage_root, created_at_unix=time.time() - 61 * 60)
        task = asyncio.create_task(
            sweep_loop(Storage(storage_root), ttl_seconds=3600, interval_seconds=0.01),
            name=SWEEPER_TASK_NAME,
        )
        await asyncio.sleep(0.05)
        assert not (storage_root / stale_id).exists()

        task.cancel()
        await task  # must not raise: the loop eats its own cancellation
        assert task.done()
        lingering = [t for t in asyncio.all_tasks() if t.get_name() == SWEEPER_TASK_NAME]
        assert lingering == []

    asyncio.run(scenario())
