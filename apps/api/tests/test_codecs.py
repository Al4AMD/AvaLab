"""Codec specs, capability probing, parameter validation and ffmpeg arguments."""

import subprocess
from pathlib import Path

import pytest

from avalab_api.codecs import (
    CODEC_SPECS,
    available_codecs,
    available_encoders,
    encode_audio,
    resolve_codec,
    validate_params,
)
from avalab_api.errors import ApiError, ErrorCode

SAMPLE_ENCODERS = """Encoders:
 V..... = Video
 A....D aac                  AAC (Advanced Audio Coding)
 A....D flac                 FLAC (Free Lossless Audio Codec)
 A....D libmp3lame           libmp3lame MP3 (MPEG audio layer 3)
 A....D libopus              libopus Opus
 A....D pcm_s16le            PCM signed 16-bit little-endian
 A....D vorbis               Vorbis
"""


def completed(stdout: bytes) -> subprocess.CompletedProcess[bytes]:
    return subprocess.CompletedProcess(
        args=["ffmpeg", "-hide_banner", "-encoders"],
        returncode=0,
        stdout=stdout,
        stderr=b"",
    )


def error_code(exc: pytest.ExceptionInfo[ApiError]) -> ErrorCode:
    return exc.value.code


def test_available_encoders_parses_ffmpeg_output(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "avalab_api.codecs.subprocess.run", lambda *args, **kwargs: completed(SAMPLE_ENCODERS.encode())
    )
    available_encoders.cache_clear()

    assert available_encoders() == frozenset(
        {"aac", "flac", "libmp3lame", "libopus", "pcm_s16le", "vorbis"}
    )


def test_available_encoders_returns_empty_on_missing_ffmpeg(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def missing(*args: object, **kwargs: object) -> None:
        raise FileNotFoundError("ffmpeg")

    monkeypatch.setattr("avalab_api.codecs.subprocess.run", missing)
    available_encoders.cache_clear()

    assert available_encoders() == frozenset()


def test_available_encoders_returns_empty_on_empty_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "avalab_api.codecs.subprocess.run", lambda *args, **kwargs: completed(b"")
    )
    available_encoders.cache_clear()

    assert available_encoders() == frozenset()


def test_resolve_codec_prefers_first_available_spec(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "avalab_api.codecs.available_encoders",
        lambda: frozenset({"libmp3lame", "vorbis"}),
    )

    mp3 = resolve_codec("mp3")
    assert mp3.encoder == "libmp3lame"
    assert mp3.extension == ".mp3"

    vorbis = resolve_codec("vorbis")
    assert vorbis.encoder == "vorbis"
    assert vorbis.extra_args == ("-strict", "-2")


def test_resolve_codec_raises_when_encoder_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("avalab_api.codecs.available_encoders", lambda: frozenset())

    with pytest.raises(ApiError) as exc:
        resolve_codec("flac")

    assert (error_code(exc), exc.value.status_code) == (ErrorCode.codec_unavailable, 422)


def test_available_codecs_has_stable_order(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "avalab_api.codecs.available_encoders",
        lambda: frozenset({"pcm_s16le", "flac", "libmp3lame", "aac", "vorbis"}),
    )

    assert available_codecs() == ["wav", "flac", "mp3", "aac", "vorbis"]


def test_codec_specs_cover_every_public_name() -> None:
    assert set(CODEC_SPECS) == {"wav", "flac", "mp3", "aac", "opus", "vorbis"}


@pytest.mark.parametrize(
    ("codec", "params", "expected"),
    [
        ("wav", {}, {}),
        ("flac", {}, {"compression_level": 5}),
        ("flac", {"compression_level": 12}, {"compression_level": 12}),
        ("mp3", {}, {"bitrate_kbps": 128}),
        ("mp3", {"bitrate_kbps": 8}, {"bitrate_kbps": 8}),
        ("mp3", {"bitrate_kbps": 512}, {"bitrate_kbps": 512}),
        ("aac", {}, {"bitrate_kbps": 128}),
        ("opus", {}, {"bitrate_kbps": 64}),
        ("vorbis", {}, {"quality": 5}),
        ("vorbis", {"quality": 0}, {"quality": 0}),
        ("vorbis", {"quality": 10}, {"quality": 10}),
    ],
)
def test_validate_params_accepts_allowed_values(
    codec: str, params: dict[str, int], expected: dict[str, int]
) -> None:
    assert validate_params(codec, params) == expected  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("codec", "params"),
    [
        ("wav", {"compression_level": 5}),
        ("flac", {"compression_level": -1}),
        ("flac", {"compression_level": 13}),
        ("flac", {"bitrate_kbps": 128}),
        ("mp3", {"bitrate_kbps": 7}),
        ("mp3", {"bitrate_kbps": 513}),
        ("mp3", {"quality": 5}),
        ("aac", {"compression_level": 5}),
        ("opus", {"bitrate_kbps": 513}),
        ("vorbis", {"quality": 11}),
        ("vorbis", {"bitrate_kbps": 128}),
    ],
)
def test_validate_params_rejects_wrong_or_out_of_range_fields(
    codec: str, params: dict[str, int]
) -> None:
    with pytest.raises(ApiError) as exc:
        validate_params(codec, params)  # type: ignore[arg-type]

    assert (error_code(exc), exc.value.status_code) == (ErrorCode.invalid_request, 422)


def test_encode_audio_uses_fixed_arguments(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        calls.append(args)
        return subprocess.CompletedProcess(args=args, returncode=0)

    monkeypatch.setattr("avalab_api.codecs.available_encoders", lambda: frozenset({"libmp3lame"}))
    monkeypatch.setattr("avalab_api.codecs.subprocess.run", fake_run)

    encode_audio(Path("input.wav"), Path("output.mp3"), "mp3", {"bitrate_kbps": 192})

    assert len(calls) == 1
    args = calls[0]
    assert args[:2] == ["ffmpeg", "-nostdin"]
    assert "-i" in args and "input.wav" in args
    assert args[args.index("-c:a") + 1] == "libmp3lame"
    assert args[args.index("-b:a") + 1] == "192k"
    assert args[args.index("-f") + 1] == "mp3"
    assert args[-1] == "output.mp3"
    assert not any(arg in {"shell", "sh", "-c"} for arg in args)


def test_encode_audio_forces_s16_for_lossless_codecs(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        calls.append(args)
        return subprocess.CompletedProcess(args=args, returncode=0)

    monkeypatch.setattr("avalab_api.codecs.available_encoders", lambda: frozenset({"flac"}))
    monkeypatch.setattr("avalab_api.codecs.subprocess.run", fake_run)

    encode_audio(Path("input.wav"), Path("output.flac"), "flac", {"compression_level": 8})

    args = calls[0]
    assert args[args.index("-sample_fmt") + 1] == "s16"
    assert args[args.index("-compression_level") + 1] == "8"
    assert args[args.index("-f") + 1] == "flac"


def test_encode_audio_maps_subprocess_failure_to_encode_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def failing(args: list[str], **kwargs: object) -> None:
        raise subprocess.CalledProcessError(1, args)

    monkeypatch.setattr("avalab_api.codecs.available_encoders", lambda: frozenset({"flac"}))
    monkeypatch.setattr("avalab_api.codecs.subprocess.run", failing)

    with pytest.raises(ApiError) as exc:
        encode_audio(Path("input.wav"), Path("output.flac"), "flac", {})

    assert (error_code(exc), exc.value.status_code) == (ErrorCode.encode_failed, 422)
