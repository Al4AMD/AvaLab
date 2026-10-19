"""GET /api/v1/audio/{audio_id} contract tests: full body and HTTP Range edges.

Range semantics pinned here (route-side validation; see routes/audio.py):

- valid single ranges -> 206 with exact ``Content-Range`` and the body slice;
- valid multi-range -> RFC 9110 ``multipart/byteranges`` (starlette native);
- grammar-valid but non-servable ranges (start >= size, suffix 0, inverted
  ``end < start``) -> 416 ``range_not_satisfiable`` envelope plus
  ``Content-Range: bytes */<size>``; the route raises these itself because
  FileResponse's own 416 is a bare text response emitted in the send phase,
  bypassing the API error envelope;
- every other header shape -> 400 ``invalid_request`` envelope, so no
  plain-text error path remains for this endpoint.

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


def store_raw_canonical(storage_root: Path, payload: bytes) -> str:
    """Place raw bytes at a valid id's canonical path, bypassing ingest."""
    audio_id = "b" * 32
    path = Storage(storage_root).canonical_path(audio_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return audio_id


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


@pytest.mark.parametrize(
    "range_header",
    [
        "bytes=99999999-",
        "bytes={size}-",
        "bytes=-0",
        "bytes=-00",
        "bytes=-000",
        "bytes=-" + "0" * 18,
        "bytes=0-9,99999999-",
        "bytes=0-9,50-10",
        "bytes=0-9,-00",
    ],
)
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


def test_inverted_range_is_416_envelope(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    """``end < start`` on a file larger than ``start``: 416 envelope, not starlette's 400."""
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        size_bytes = len(canonical_bytes(storage_root, audio_id))
        response = get(client, audio_id, "bytes=50-10")

    assert response.status_code == 416
    assert response.headers["content-range"] == f"bytes */{size_bytes}"
    assert response.json()["error"]["code"] == "range_not_satisfiable"


def test_inverted_range_is_416_on_file_smaller_than_start(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``bytes=50-10`` must classify as inverted even when 50 >= file size (10 B)."""
    with make_client(storage_root, monkeypatch) as client:
        audio_id = store_raw_canonical(storage_root, b"0123456789")
        response = get(client, audio_id, "bytes=50-10")

    assert response.status_code == 416
    assert response.headers["content-range"] == "bytes */10"
    assert response.json()["error"]["code"] == "range_not_satisfiable"


@pytest.mark.parametrize(
    "range_header",
    [
        "bytes=abc",
        "bytes=",
        "bytes=-",
        "bytes=1-2-3",
        "bytes=0-9,abc",
        "bytes=0-9,",
        "bytes=,0-9",
        "bytes=0-9,,20-29",
        "bytes=0-9, 20-29",
        "items=0-9",
        "bytes=0 - 9",
    ],
)
def test_malformed_ranges_are_400_envelope(
    storage_root: Path,
    monkeypatch: pytest.MonkeyPatch,
    wav_1s_44k1_mono: Path,
    range_header: str,
) -> None:
    """Anything outside the strict grammar ends in the 400 envelope, never plain text."""
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        response = get(client, audio_id, range_header)

    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["error"]["code"] == "invalid_request"
    assert response.json()["error"]["message"]


@pytest.mark.parametrize(
    "range_header",
    [
        "bytes=-" + "9" * 4301,
        "bytes=" + "9" * 4301 + "-",
        "bytes=0-" + "9" * 4301,
        "bytes=0-9," + "9" * 19 + "-",
    ],
)
def test_overlong_digit_runs_are_400_envelope(
    storage_root: Path,
    monkeypatch: pytest.MonkeyPatch,
    wav_1s_44k1_mono: Path,
    range_header: str,
) -> None:
    """A >18-digit value would hit CPython's 4300-digit int() limit: in the route
    as an uncaught ValueError, in Starlette as a ValueError-skip that collapses
    to a plain-text 400. The digit cap must turn every shape into a 400 envelope."""
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        response = get(client, audio_id, range_header)

    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["error"]["code"] == "invalid_request"
    assert response.json()["error"]["message"]


def test_eighteen_digit_open_range_is_416_envelope(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    """The cap boundary: 18 digits parses fine and is unsatisfiable -> 416, not 400."""
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        size_bytes = len(canonical_bytes(storage_root, audio_id))
        response = get(client, audio_id, "bytes=" + "9" * 18 + "-")

    assert response.status_code == 416
    assert response.headers["content-range"] == f"bytes */{size_bytes}"
    assert response.json()["error"]["code"] == "range_not_satisfiable"


def test_stat_oserror_is_404_envelope(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A plain file where the id's directory belongs makes stat raise
    NotADirectoryError; the route must answer the 404 envelope, not a 500."""
    with make_client(storage_root, monkeypatch) as client:
        storage_root.mkdir(parents=True, exist_ok=True)
        (storage_root / ("c" * 32)).write_bytes(b"not a directory")
        response = get(client, "c" * 32)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_more_than_max_ranges_is_400_envelope(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch, wav_1s_44k1_mono: Path
) -> None:
    """Grammar-valid but excessive multi-ranges would go plain-text in starlette."""
    with make_client(storage_root, monkeypatch) as client:
        audio_id = ingest(client, wav_1s_44k1_mono)
        response = get(client, audio_id, "bytes=" + ",".join(["0-0"] * 101))

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_suffix_range_on_empty_file_is_416_envelope(
    storage_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A zero-byte canonical file must still answer suffix ranges with the envelope."""
    with make_client(storage_root, monkeypatch) as client:
        audio_id = store_raw_canonical(storage_root, b"")
        response = get(client, audio_id, "bytes=-5")

    assert response.status_code == 416
    assert response.headers["content-range"] == "bytes */0"
    assert response.json()["error"]["code"] == "range_not_satisfiable"


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
