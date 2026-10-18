"""GET /api/v1/audio/{audio_id} contract tests: full body and HTTP Range edges.

Range semantics pinned here, verified empirically against installed
starlette 1.9.0:

- valid single ranges -> 206 with exact ``Content-Range`` and the body slice;
- well-formed unsatisfiable single ranges (start >= size, suffix 0) -> 416
  ``range_not_satisfiable`` envelope plus ``Content-Range: bytes */<size>``;
  the route raises these itself because FileResponse's own 416 is a bare
  text response emitted in the send phase, bypassing the API error envelope;
- malformed or inverted ranges -> plain-text 400 straight from FileResponse
  (pinned below so a dependency upgrade forces re-verification);
- multi-range -> RFC 9110 ``multipart/byteranges`` (starlette native).

Every test ingests into a storage root inside pytest's tmp tree.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from audio_fixtures import generate_with_ffmpeg
from fastapi.testclient import TestClient
from httpx import Response

from avalab_api.config import Settings, get_settings
from avalab_api.main import API_PREFIX, create_app
from avalab_api.storage import Storage

INVERTED_RANGE_BODY = "Range header: start must be less than end"
MALFORMED_RANGE_BODY = "Range header: range must be requested"


@pytest.fixture(scope="module")
def wav_1s_44k1_mono(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """One 1 s 44.1 kHz mono 16-bit PCM WAV, generated once per module."""
    return generate_with_ffmpeg(
        tmp_path_factory.mktemp("range_fixtures") / "sine_1s_44100_mono.wav",
        "sine=frequency=440:sample_rate=44100:duration=1",
        ["-ac", "1", "-c:a", "pcm_s16le"],
    )


@pytest.fixture()
def storage_root(tmp_path: Path) -> Path:
    """Storage directory inside pytest's tmp tree, never the repo tree."""
    return tmp_path / "storage"


@contextmanager
def make_client(storage_root: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """TestClient whose app and routes read settings pinned to ``storage_root``.

    ``monkeypatch`` is required because ``create_app`` and its lifespan
    sweeper read settings at build/startup time, not per request.
    """
    settings = Settings(storage_dir=storage_root)
    monkeypatch.setattr("avalab_api.main.get_settings", lambda: settings)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def ingest(client: TestClient, wav_path: Path) -> str:
    """Upload ``wav_path`` through the real ingest route; return the audio id."""
    with wav_path.open("rb") as handle:
        response = client.post(
            f"{API_PREFIX}/ingest",
            files={"file": (wav_path.name, handle, "application/octet-stream")},
        )
    assert response.status_code == 200, response.text
    audio_id = response.json()["audio_id"]
    assert isinstance(audio_id, str)
    return audio_id


def canonical_bytes(storage_root: Path, audio_id: str) -> bytes:
    """The stored canonical WAV bytes: ground truth for every body assertion."""
    return Storage(storage_root).canonical_path(audio_id).read_bytes()


def get(client: TestClient, audio_id: str, range_header: str | None = None) -> Response:
    """GET the served audio, optionally with a Range header."""
    headers = {"Range": range_header} if range_header is not None else {}
    return client.get(f"{API_PREFIX}/audio/{audio_id}", headers=headers)


def test_get_full_serves_whole_wav(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        full = canonical_bytes(storage_root, audio_id)
        response = get(client, audio_id)

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["accept-ranges"] == "bytes"
    assert int(response.headers["content-length"]) == len(full)
    assert response.content == full
    assert full[:4] == b"RIFF" and full[8:12] == b"WAVE"


def test_single_range_start_end(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        full = canonical_bytes(storage_root, audio_id)
        response = get(client, audio_id, "bytes=0-99")

    assert response.status_code == 206
    assert response.headers["content-range"] == f"bytes 0-99/{len(full)}"
    assert response.headers["content-type"] == "audio/wav"
    assert len(response.content) == 100
    assert response.content == full[:100]


def test_single_range_open_ended(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        full = canonical_bytes(storage_root, audio_id)
        response = get(client, audio_id, "bytes=100-")

    assert response.status_code == 206
    assert response.headers["content-range"] == f"bytes 100-{len(full) - 1}/{len(full)}"
    assert len(response.content) == len(full) - 100
    assert response.content == full[100:]


def test_single_range_zero_start_open_ended(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        full = canonical_bytes(storage_root, audio_id)
        response = get(client, audio_id, "bytes=0-")

    assert response.status_code == 206
    assert response.headers["content-range"] == f"bytes 0-{len(full) - 1}/{len(full)}"
    assert response.content == full


def test_single_range_suffix(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        full = canonical_bytes(storage_root, audio_id)
        response = get(client, audio_id, "bytes=-100")

    assert response.status_code == 206
    assert response.headers["content-range"] == f"bytes {len(full) - 100}-{len(full) - 1}/{len(full)}"
    assert len(response.content) == 100
    assert response.content == full[-100:]


@pytest.mark.parametrize("range_header", ["bytes=99999999-", "bytes={size}-", "bytes=-0"])
def test_unsatisfiable_ranges_are_416_envelope(
    storage_root: Path,
    monkeypatch: pytest.MonkeyPatch,
    wav_1s_44k1_mono: Path,
    range_header: str,
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        size_bytes = len(canonical_bytes(storage_root, audio_id))
        response = get(client, audio_id, range_header.replace("{size}", str(size_bytes)))

    assert response.status_code == 416
    assert response.headers["content-range"] == f"bytes */{size_bytes}"
    assert response.json()["error"]["code"] == "range_not_satisfiable"


def test_inverted_range_is_400_from_fileresponse(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    """starlette classifies ``start > end`` as malformed: plain-text 400, pinned as is."""
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        response = get(client, audio_id, "bytes=50-10")

    assert response.status_code == 400
    assert response.headers["content-type"].startswith("text/plain")
    assert response.text == INVERTED_RANGE_BODY


def test_malformed_range_is_400_from_fileresponse(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    """Non-numeric range: starlette ignores the spec, then rejects: plain-text 400."""
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        response = get(client, audio_id, "bytes=abc")

    assert response.status_code == 400
    assert response.headers["content-type"].startswith("text/plain")
    assert response.text == MALFORMED_RANGE_BODY


def test_multi_range_serves_multipart_byteranges(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        full = canonical_bytes(storage_root, audio_id)
        response = get(client, audio_id, "bytes=0-9,20-29")

    assert response.status_code == 206
    content_type = response.headers["content-type"]
    assert content_type.startswith("multipart/byteranges; boundary=")
    boundary = content_type.split("boundary=", 1)[1]
    body = response.content
    size_bytes = len(full)
    for start, end in ((0, 9), (20, 29)):
        part_header = (
            f"--{boundary}\r\n"
            f"Content-Type: audio/wav\r\n"
            f"Content-Range: bytes {start}-{end}/{size_bytes}\r\n\r\n"
        ).encode()
        assert part_header + full[start : end + 1] in body
    assert body.endswith(f"--{boundary}--".encode())
    assert int(response.headers["content-length"]) == len(body)


def test_concatenated_prefix_ranges_reconstruct_first_200_bytes(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        full = canonical_bytes(storage_root, audio_id)
        first = get(client, audio_id, "bytes=0-99")
        second = get(client, audio_id, "bytes=100-199")

    assert first.status_code == 206 and second.status_code == 206
    assert first.content + second.content == full[:200]


def test_unknown_and_invalid_ids_are_404(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        unknown = get(client, "0" * 32)
        invalid = get(client, "not-a-uuid")

    for response in (unknown, invalid):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


def test_get_after_delete_is_404(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        before = get(client, audio_id)
        deleted = client.delete(f"{API_PREFIX}/audio/{audio_id}")
        after = get(client, audio_id)

    assert before.status_code == 200
    assert deleted.status_code == 204
    assert after.status_code == 404
    assert after.json()["error"]["code"] == "not_found"
