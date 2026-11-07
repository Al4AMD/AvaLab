"""POST /api/v1/codec/encode: real encoders, alignment, bit-exactness, cleanup."""

# ruff: noqa: F401, F811

import json
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import pytest
from audio_fixtures import audio_fixture_dir, wav_2s_44k1_mono, wav_2s_44k1_stereo
from fastapi.testclient import TestClient
from scipy.io import wavfile  # type: ignore[import-untyped]

from avalab_api.codecs import available_codecs
from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode
from avalab_api.main import API_PREFIX, create_app
from avalab_api.routes.codec import _read_pair

CODEC_URL = f"{API_PREFIX}/codec/encode"


@pytest.fixture()
def storage_root(tmp_path: Path) -> Path:
    return tmp_path / "storage"


@pytest.fixture()
def temp_area(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    area = tmp_path / "tmp-area"
    area.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(area))
    return area


@contextmanager
def make_client(storage_root: Path) -> Iterator[TestClient]:
    settings = Settings(storage_dir=storage_root)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def ingest_wav(client: TestClient, source: Path) -> str:
    with source.open("rb") as handle:
        response = client.post(
            f"{API_PREFIX}/ingest",
            files={"file": (source.name, handle, "audio/wav")},
        )
    assert response.status_code == 200, response.text
    return response.json()["audio_id"]


def reference_pcm(storage_root: Path, audio_id: str) -> tuple[int, np.ndarray]:
    rate, samples = wavfile.read(storage_root / audio_id / "audio.wav")
    mono = samples.astype(np.float64)
    if mono.ndim == 2:
        mono = mono.mean(axis=1)
    pcm16 = np.clip(np.round(mono * 32768.0), -32768, 32767).astype(np.int16)
    return rate, pcm16.astype(np.float64) / 32768.0


def read_stored_wav(storage_root: Path, audio_id: str) -> tuple[int, np.ndarray]:
    rate, samples = wavfile.read(storage_root / audio_id / "audio.wav")
    return rate, samples


def reference_channels(storage_root: Path, audio_id: str) -> np.ndarray:
    _, samples = wavfile.read(storage_root / audio_id / "audio.wav")
    data = np.asarray(samples, dtype=np.float64)
    if data.ndim == 1:
        data = data.reshape(-1, 1)
    pcm = np.clip(np.round(data * 32768.0), -32768, 32767).astype(np.int16)
    return pcm.astype(np.float64) / 32768.0


def assert_temp_clean(temp_area: Path) -> None:
    leftovers = sorted(
        path.name for path in temp_area.iterdir() if path.name.startswith("avalab_")
    )
    assert leftovers == []


def assert_storage_empty(storage_root: Path) -> None:
    assert not storage_root.exists() or not any(storage_root.iterdir())


def test_flac_round_trip_is_bit_exact(
    storage_root: Path, temp_area: Path, wav_2s_44k1_mono: Path
) -> None:
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_mono)
        response = client.post(
            CODEC_URL, json={"audio_id": audio_id, "codec": "flac", "params": {}}
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["lossless"] is True
        assert body["channels"] == 1
        assert body["bit_exact"] is True
        assert body["size_bytes"] > 0
        assert body["bitrate_kbps"] > 0
        assert isinstance(body["codec_delay_samples"], int)
        assert body["aligned_sample_count"] > 0
        assert body["duration_s"] == pytest.approx(
            body["aligned_sample_count"] / body["sample_rate_hz"], abs=1e-9
        )

        rate, expected = reference_pcm(storage_root, audio_id)
        stored_rate, stored = read_stored_wav(storage_root, body["result_audio_id"])
        assert stored_rate == rate
        start = body["reference_start_sample"]
        count = body["aligned_sample_count"]
        assert count == len(expected)
        assert np.array_equal(stored.astype(np.float64), expected[start : start + count])

    assert_temp_clean(temp_area)


def test_mp3_is_lossy_and_smaller(
    storage_root: Path, temp_area: Path, wav_2s_44k1_mono: Path
) -> None:
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_mono)
        original_size = (storage_root / audio_id / "audio.wav").stat().st_size
        response = client.post(
            CODEC_URL,
            json={
                "audio_id": audio_id,
                "codec": "mp3",
                "params": {"bitrate_kbps": 128},
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["lossless"] is False
        assert body["channels"] == 1
        assert body["bit_exact"] is False
        assert body["size_bytes"] < original_size
        assert body["bitrate_kbps"] > 0
        assert body["aligned_sample_count"] > 0
        assert isinstance(body["codec_delay_samples"], int)

        _, expected = reference_pcm(storage_root, audio_id)
        _, stored = read_stored_wav(storage_root, body["result_audio_id"])
        start = body["reference_start_sample"]
        count = body["aligned_sample_count"]
        assert count == len(expected)
        assert not np.array_equal(stored.astype(np.float64), expected[start : start + count])
        assert np.all(np.isfinite(stored))

    assert_temp_clean(temp_area)


@pytest.mark.parametrize("codec", ["wav", "flac", "mp3", "aac", "opus", "vorbis"])
def test_every_available_codec_round_trips(
    storage_root: Path,
    temp_area: Path,
    wav_2s_44k1_mono: Path,
    codec: str,
) -> None:
    if codec not in available_codecs():
        pytest.skip(f"{codec} encoder is not available in this ffmpeg build")
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_mono)
        response = client.post(
            CODEC_URL, json={"audio_id": audio_id, "codec": codec, "params": {}}
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["aligned_sample_count"] > 0
        assert isinstance(body["codec_delay_samples"], int)
        assert body["channels"] == 1
        if codec in {"wav", "flac"}:
            assert body["lossless"] is True
            assert body["bit_exact"] is True
        else:
            assert body["lossless"] is False
            assert body["bit_exact"] is False

    assert_temp_clean(temp_area)


def test_missing_audio_id_returns_not_found(storage_root: Path, temp_area: Path) -> None:
    with make_client(storage_root) as client:
        response = client.post(
            CODEC_URL,
            json={"audio_id": "deadbeef" * 4, "codec": "flac", "params": {}},
        )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert_storage_empty(storage_root)
    assert_temp_clean(temp_area)


def test_invalid_codec_returns_invalid_request(
    storage_root: Path, temp_area: Path, wav_2s_44k1_mono: Path
) -> None:
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_mono)
        response = client.post(
            CODEC_URL, json={"audio_id": audio_id, "codec": "nope", "params": {}}
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert sorted(path.name for path in storage_root.iterdir()) == [audio_id]
    assert_temp_clean(temp_area)


def test_unavailable_codec_returns_codec_unavailable(
    storage_root: Path,
    temp_area: Path,
    wav_2s_44k1_mono: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unavailable(_codec: str) -> None:
        raise ApiError(ErrorCode.codec_unavailable, "not available", 422)

    monkeypatch.setattr("avalab_api.routes.codec.resolve_codec", unavailable)
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_mono)
        response = client.post(
            CODEC_URL, json={"audio_id": audio_id, "codec": "flac", "params": {}}
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "codec_unavailable"
    assert sorted(path.name for path in storage_root.iterdir()) == [audio_id]
    assert_temp_clean(temp_area)


def test_encode_failure_cleans_up(
    storage_root: Path,
    temp_area: Path,
    wav_2s_44k1_mono: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(*_args: object, **_kwargs: object) -> None:
        raise ApiError(ErrorCode.encode_failed, "simulated", 422)

    monkeypatch.setattr("avalab_api.routes.codec.encode_audio", fail)
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_mono)
        response = client.post(
            CODEC_URL, json={"audio_id": audio_id, "codec": "flac", "params": {}}
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "encode_failed"
    assert (storage_root / audio_id / "audio.wav").is_file()
    assert sorted(path.name for path in storage_root.iterdir()) == [audio_id]
    assert_temp_clean(temp_area)


def test_wrong_params_return_invalid_request(
    storage_root: Path, temp_area: Path, wav_2s_44k1_mono: Path
) -> None:
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_mono)
        response = client.post(
            CODEC_URL,
            json={
                "audio_id": audio_id,
                "codec": "mp3",
                "params": {"bitrate_kbps": 999},
            },
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert sorted(path.name for path in storage_root.iterdir()) == [audio_id]
    assert_temp_clean(temp_area)


def test_stereo_flac_round_trip_keeps_both_channels_bit_exact(
    storage_root: Path, temp_area: Path, wav_2s_44k1_stereo: Path
) -> None:
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_stereo)
        response = client.post(
            CODEC_URL, json={"audio_id": audio_id, "codec": "flac", "params": {}}
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["channels"] == 2
        assert body["lossless"] is True
        assert body["bit_exact"] is True

        expected = reference_channels(storage_root, audio_id)
        _, stored = read_stored_wav(storage_root, body["result_audio_id"])
        assert stored.ndim == 2 and stored.shape[1] == 2
        start = body["reference_start_sample"]
        count = body["aligned_sample_count"]
        assert count == len(expected)
        assert np.array_equal(stored.astype(np.float64), expected[start : start + count])

    assert_temp_clean(temp_area)


def test_stereo_mp3_keeps_two_channels_and_stays_lossy(
    storage_root: Path, temp_area: Path, wav_2s_44k1_stereo: Path
) -> None:
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_stereo)
        response = client.post(
            CODEC_URL,
            json={
                "audio_id": audio_id,
                "codec": "mp3",
                "params": {"bitrate_kbps": 128},
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["channels"] == 2
        assert body["lossless"] is False
        assert body["bit_exact"] is False

        _, stored = read_stored_wav(storage_root, body["result_audio_id"])
        assert stored.ndim == 2 and stored.shape[1] == 2
        assert np.all(np.isfinite(stored))

    assert_temp_clean(temp_area)


def test_missing_or_invalid_channel_metadata_returns_not_found(
    storage_root: Path, temp_area: Path, wav_2s_44k1_mono: Path
) -> None:
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_mono)
        meta_path = storage_root / audio_id / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta.pop("channels")
        meta_path.write_text(json.dumps(meta), encoding="utf-8")
        response = client.post(
            CODEC_URL, json={"audio_id": audio_id, "codec": "flac", "params": {}}
        )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert_temp_clean(temp_area)


def test_decoded_channel_mismatch_returns_encode_failed(
    storage_root: Path,
    temp_area: Path,
    wav_2s_44k1_stereo: Path,
    wav_2s_44k1_mono: Path,
) -> None:
    with make_client(storage_root) as client:
        audio_id = ingest_wav(client, wav_2s_44k1_stereo)
        with pytest.raises(ApiError) as exc:
            _read_pair(
                storage_root / audio_id / "audio.wav",
                wav_2s_44k1_mono,
                44100,
                2,
            )
        assert (exc.value.code, exc.value.status_code) == (
            ErrorCode.encode_failed,
            422,
        )

    assert_temp_clean(temp_area)
