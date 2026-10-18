"""POST /api/v1/ingest contract tests: validation order, limits, canonical output, hygiene.

Every rejected request must leave the storage directory and the temp directory
free of leftovers; the helpers below assert that on each failure path.

Ruff note: fixtures are imported from audio_fixtures for registration and are
then re-bound as test parameters, so F401/F811 are expected in this module.
"""

# ruff: noqa: F401, F811

import json
import re
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from audio_fixtures import (
    audio_fixture_dir,
    fake_wav_with_text_content,
    wav_2s_44k1_mono,
    wav_2s_44k1_quad,
    wav_2s_192k_mono,
    wav_301s_8k_mono,
)
from fastapi.testclient import TestClient
from httpx import Response

from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ffmpeg import probe
from avalab_api.main import API_PREFIX, create_app
from avalab_api.storage import Storage

RESPONSE_KEYS = {"audio_id", "duration_s", "sample_rate_hz", "channels", "size_bytes"}
META_KEYS = {
    "audio_id",
    "duration_s",
    "sample_rate_hz",
    "channels",
    "original_format",
    "created_at_unix",
}


@pytest.fixture()
def storage_root(tmp_path: Path) -> Path:
    """Storage directory inside pytest's tmp tree, never the repo tree."""
    return tmp_path / "storage"


@pytest.fixture()
def temp_area(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect tempfile's default directory so temp leftovers are observable."""
    area = tmp_path / "tmp-area"
    area.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(area))
    return area


@contextmanager
def make_client(storage_root: Path, **settings_overrides: object) -> Iterator[TestClient]:
    """TestClient whose ingest route reads settings pinned to ``storage_root``."""
    settings = Settings(storage_dir=storage_root, **settings_overrides)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def post_file(client: TestClient, source: Path, filename: str | None = None) -> Response:
    """Upload ``source`` as the multipart ``file`` field of the ingest route."""
    with source.open("rb") as handle:
        return client.post(
            f"{API_PREFIX}/ingest",
            files={"file": (filename or source.name, handle, "application/octet-stream")},
        )


def assert_storage_empty(storage_root: Path) -> None:
    assert not storage_root.exists() or not any(storage_root.iterdir())


def assert_no_temp_leftovers(temp_area: Path) -> None:
    leftovers = sorted(path.name for path in temp_area.iterdir() if path.name.startswith("avalab_"))
    assert leftovers == []


def test_ingest_valid_file_returns_exact_fields_and_canonical_wav(
    storage_root: Path, temp_area: Path, wav_2s_44k1_mono: Path
) -> None:
    with make_client(storage_root) as client:
        response = post_file(client, wav_2s_44k1_mono)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == RESPONSE_KEYS
    audio_id = body["audio_id"]
    assert isinstance(audio_id, str) and re.fullmatch(r"[0-9a-f]{32}", audio_id)
    assert body["sample_rate_hz"] == 44100
    assert body["channels"] == 1
    assert body["duration_s"] == pytest.approx(2.0, abs=0.01)

    canonical_path = storage_root / audio_id / "audio.wav"
    assert canonical_path.is_file()
    assert body["size_bytes"] == canonical_path.stat().st_size
    canonical_probe = probe(canonical_path)
    assert canonical_probe.codec_name == "pcm_f32le"
    assert canonical_probe.sample_rate_hz == 44100
    assert canonical_probe.channels == 1

    meta_path = storage_root / audio_id / "meta.json"
    assert meta_path.is_file()
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert set(meta) == META_KEYS
    assert meta["audio_id"] == audio_id
    assert meta["sample_rate_hz"] == 44100
    assert meta["channels"] == 1
    assert meta["original_format"] == "wav"
    assert isinstance(meta["created_at_unix"], int)
    assert wav_2s_44k1_mono.name not in json.dumps(meta)
    assert_no_temp_leftovers(temp_area)


def test_ingest_resamples_sample_rate_above_cap(
    storage_root: Path, temp_area: Path, wav_2s_192k_mono: Path
) -> None:
    with make_client(storage_root) as client:
        response = post_file(client, wav_2s_192k_mono)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sample_rate_hz"] == 96000
    assert body["channels"] == 1
    canonical_probe = probe(storage_root / body["audio_id"] / "audio.wav")
    assert canonical_probe.codec_name == "pcm_f32le"
    assert canonical_probe.sample_rate_hz == 96000
    assert_no_temp_leftovers(temp_area)


def test_ingest_downmixes_channels_above_cap(
    storage_root: Path, temp_area: Path, wav_2s_44k1_quad: Path
) -> None:
    with make_client(storage_root) as client:
        response = post_file(client, wav_2s_44k1_quad)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["channels"] == 2
    assert body["sample_rate_hz"] == 44100
    canonical_probe = probe(storage_root / body["audio_id"] / "audio.wav")
    assert canonical_probe.codec_name == "pcm_f32le"
    assert canonical_probe.channels == 2
    assert_no_temp_leftovers(temp_area)


def test_ingest_rejects_undecodable_file_with_decode_failed(
    storage_root: Path, temp_area: Path, fake_wav_with_text_content: Path
) -> None:
    with make_client(storage_root) as client:
        response = post_file(client, fake_wav_with_text_content)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "decode_failed"
    assert_storage_empty(storage_root)
    assert_no_temp_leftovers(temp_area)


def test_ingest_rejects_oversize_upload_with_file_too_large(
    storage_root: Path, temp_area: Path, wav_2s_44k1_mono: Path
) -> None:
    with make_client(storage_root, max_upload_bytes=1024) as client:
        response = post_file(client, wav_2s_44k1_mono)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"
    assert_storage_empty(storage_root)
    assert_no_temp_leftovers(temp_area)


def test_ingest_rejects_overlong_duration_with_duration_too_long(
    storage_root: Path, temp_area: Path, wav_301s_8k_mono: Path
) -> None:
    with make_client(storage_root) as client:
        response = post_file(client, wav_301s_8k_mono)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "duration_too_long"
    assert_storage_empty(storage_root)
    assert_no_temp_leftovers(temp_area)


def test_storage_rejects_invalid_audio_id(tmp_path: Path) -> None:
    storage = Storage(tmp_path / "storage")
    with pytest.raises(ApiError) as excinfo:
        storage.audio_dir("../escape")
    assert excinfo.value.code is ErrorCode.not_found
    with pytest.raises(ApiError):
        storage.delete("not-a-uuid")
