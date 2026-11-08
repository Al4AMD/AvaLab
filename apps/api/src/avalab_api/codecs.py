"""Real-codec specs, ffmpeg capability probing, parameter validation and encoding.

Codec availability is read from ``ffmpeg -encoders`` instead of assumed: a
minimal deployment image may ship only some encoders (for example, native
experimental Vorbis instead of ``libvorbis``). Every encode call uses a fixed
argument array, a bounded timeout, captured output, and no shell.
"""

import re
import subprocess
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from avalab_api.errors import ApiError, ErrorCode

CodecName = Literal["wav", "flac", "mp3", "aac", "opus", "vorbis"]

ENCODE_TIMEOUT_SECONDS = 120.0
PROBE_TIMEOUT_SECONDS = 30.0

_ENCODER_LINE = re.compile(r"^\s*[A-Z.]{6}\s+(\S+)")


@dataclass(frozen=True)
class CodecSpec:
    """One encoder choice for a public codec name."""

    name: CodecName
    encoder: str
    lossless: bool
    extension: str
    format: str
    extra_args: tuple[str, ...]
    default_bitrate_kbps: int | None
    default_quality: int | None
    default_compression_level: int | None


CODEC_SPECS: dict[CodecName, tuple[CodecSpec, ...]] = {
    "wav": (CodecSpec("wav", "pcm_s16le", True, ".wav", "wav", (), None, None, None),),
    "flac": (CodecSpec("flac", "flac", True, ".flac", "flac", (), None, None, 5),),
    "mp3": (CodecSpec("mp3", "libmp3lame", False, ".mp3", "mp3", (), 128, None, None),),
    "aac": (CodecSpec("aac", "aac", False, ".aac", "adts", (), 128, None, None),),
    "opus": (CodecSpec("opus", "libopus", False, ".opus", "ogg", (), 64, None, None),),
    "vorbis": (
        CodecSpec("vorbis", "libvorbis", False, ".ogg", "ogg", (), None, 5, None),
        CodecSpec(
            # Native experimental Vorbis rejects mono; duplicate to stereo, decoded path downmixes.
            "vorbis",
            "vorbis",
            False,
            ".ogg",
            "ogg",
            ("-ac", "2", "-strict", "-2"),
            None,
            5,
            None,
        ),
    ),
}

_BITRATE_CODECS: frozenset[CodecName] = frozenset({"mp3", "aac", "opus"})
_QUALITY_CODECS: frozenset[CodecName] = frozenset({"vorbis"})


@lru_cache(maxsize=1)
def available_encoders() -> frozenset[str]:
    """Encoder names reported by ``ffmpeg -encoders``; empty when ffmpeg fails."""
    try:
        completed = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            check=True,
            capture_output=True,
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return frozenset()
    if completed.returncode != 0:
        return frozenset()
    stdout = completed.stdout
    text = stdout.decode("utf-8", errors="replace") if isinstance(stdout, bytes) else stdout
    return frozenset(
        match.group(1)
        for line in text.splitlines()
        if (match := _ENCODER_LINE.match(line)) and match.group(1) != "="
    )


def resolve_codec(codec: CodecName) -> CodecSpec:
    """Return the first available encoder spec for ``codec`` or raise 422."""
    specs = CODEC_SPECS.get(codec)
    if specs is None:
        raise ApiError(ErrorCode.invalid_request, "Unknown codec", 422)
    encoders = available_encoders()
    for spec in specs:
        if spec.encoder in encoders:
            return spec
    raise ApiError(ErrorCode.codec_unavailable, f"Codec {codec} is not available", 422)


def available_codecs() -> list[CodecName]:
    """Available public codec names in the stable ``CODEC_SPECS`` order."""
    encoders = available_encoders()
    return [
        codec
        for codec, specs in CODEC_SPECS.items()
        if any(spec.encoder in encoders for spec in specs)
    ]


def validate_params(codec: CodecName, params: Mapping[str, int]) -> dict[str, int]:
    """Validate codec-specific options and apply defaults.

    A field that does not belong to the codec is rejected rather than ignored,
    so a client typo cannot silently fall back to a different quality.
    """
    if codec == "wav":
        if params:
            raise ApiError(ErrorCode.invalid_request, "WAV accepts no codec params", 422)
        return {}
    if codec == "flac":
        _reject_other_fields(params, {"compression_level"})
        return {
            "compression_level": _int_param(params, "compression_level", 5, 0, 12)
        }
    if codec in _BITRATE_CODECS:
        _reject_other_fields(params, {"bitrate_kbps"})
        default = 64 if codec == "opus" else 128
        return {"bitrate_kbps": _int_param(params, "bitrate_kbps", default, 8, 512)}
    if codec in _QUALITY_CODECS:
        _reject_other_fields(params, {"quality"})
        return {"quality": _int_param(params, "quality", 5, 0, 10)}
    raise ApiError(ErrorCode.invalid_request, "Unknown codec", 422)


def encode_audio(
    src: Path,
    dst: Path,
    codec: CodecName,
    params: dict[str, int],
    *,
    channels: int,
    cancel: Callable[[], bool] | None = None,
) -> None:
    """Encode ``src`` into ``dst`` with the resolved ffmpeg encoder.

    The route passes the stored source channel count (1 or 2) so stereo audio
    keeps both channels; analysis still downmixes to mono. Lossless codecs use
    s16 so the 16-bit PCM reference is reproduced exactly.
    """
    if channels not in (1, 2):
        raise ApiError(ErrorCode.invalid_request, "channels must be 1 or 2", 422)
    spec = resolve_codec(codec)
    resolved = validate_params(codec, params)

    args = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-v",
        "error",
        "-y",
        "-i",
        str(src),
        "-map",
        "0:a:0",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-ac",
        str(channels),
        "-c:a",
        spec.encoder,
    ]
    if spec.lossless:
        args.extend(["-sample_fmt", "s16"])
    if spec.default_compression_level is not None:
        args.extend(["-compression_level", str(resolved["compression_level"])])
    if spec.default_bitrate_kbps is not None:
        args.extend(["-b:a", f"{resolved['bitrate_kbps']}k"])
    if spec.default_quality is not None:
        args.extend(["-q:a", str(resolved["quality"])])
    args.extend(spec.extra_args)
    args.extend(["-f", spec.format, str(dst)])

    try:
        if cancel is None:
            subprocess.run(
                args,
                check=True,
                capture_output=True,
                timeout=ENCODE_TIMEOUT_SECONDS,
            )
        else:
            _run_cancellable(args, cancel)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        raise ApiError(ErrorCode.encode_failed, "Audio encoding failed", 422) from exc


def _run_cancellable(args: list[str], cancel: Callable[[], bool]) -> None:
    """Run ffmpeg and terminate it when cancelled or over the encode budget."""
    process = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + ENCODE_TIMEOUT_SECONDS
    try:
        while True:
            try:
                return_code = process.wait(timeout=0.1)
            except subprocess.TimeoutExpired:
                if cancel() or time.monotonic() >= deadline:
                    process.kill()
                    process.wait(timeout=5)
                    raise subprocess.CalledProcessError(-9, args)
                continue
            if return_code != 0:
                raise subprocess.CalledProcessError(return_code, args)
            return
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def _reject_other_fields(params: Mapping[str, int], allowed: set[str]) -> None:
    unknown = set(params) - allowed
    if unknown:
        raise ApiError(ErrorCode.invalid_request, "Codec parameter is not supported", 422)


def _int_param(
    params: Mapping[str, int], name: str, default: int, low: int, high: int
) -> int:
    value = params.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ApiError(
            ErrorCode.invalid_request,
            f"{name} must be an integer in [{low}, {high}]",
            422,
        )
    return value
