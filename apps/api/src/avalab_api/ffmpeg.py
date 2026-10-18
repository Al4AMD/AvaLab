"""ffmpeg / ffprobe subprocess wrappers.

Uploads are untrusted (AGENTS.md section 7): both tools are always spawned with
fixed argument arrays, no shell interpolation, a bounded timeout, and captured
output. Probe or transcode failures surface as ApiError(decode_failed) so the
route layer never inspects subprocess internals.
"""

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from avalab_api.errors import ApiError, ErrorCode

PROBE_TIMEOUT_SECONDS = 30.0
TRANSCODE_TIMEOUT_SECONDS = 120.0


@dataclass(frozen=True)
class ProbeResult:
    """Audio metadata required to enforce limits and plan the transcode.

    ``probe`` only returns when all required fields are present; a stream
    without them cannot be validated against the configured caps.
    """

    duration_s: float
    sample_rate_hz: int
    channels: int
    codec_name: str | None
    format_name: str | None


def probe(path: Path) -> ProbeResult:
    """Inspect ``path`` with ffprobe; raise ApiError(decode_failed) on any failure."""
    completed = _run_ffprobe(path)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ApiError(ErrorCode.decode_failed, "Could not read ffprobe output", 422) from exc
    if not isinstance(payload, dict):
        raise ApiError(ErrorCode.decode_failed, "Unexpected ffprobe output", 422)

    stream = _first_audio_stream(payload)
    if stream is None:
        raise ApiError(ErrorCode.decode_failed, "No audio stream found in the file", 422)

    format_section = payload.get("format")
    format_dict = format_section if isinstance(format_section, dict) else {}

    duration_s = _parse_float(format_dict.get("duration"))
    if duration_s is None:
        duration_s = _parse_float(stream.get("duration"))
    sample_rate_hz = _parse_int(stream.get("sample_rate"))
    channels = _parse_int(stream.get("channels"))

    if (
        duration_s is None
        or sample_rate_hz is None
        or sample_rate_hz <= 0
        or channels is None
        or channels <= 0
    ):
        raise ApiError(ErrorCode.decode_failed, "Audio stream is missing required metadata", 422)

    codec_name = stream.get("codec_name")
    format_name = format_dict.get("format_name")
    return ProbeResult(
        duration_s=duration_s,
        sample_rate_hz=sample_rate_hz,
        channels=channels,
        codec_name=codec_name if isinstance(codec_name, str) else None,
        format_name=format_name if isinstance(format_name, str) else None,
    )


def transcode_to_canonical_wav(
    src: Path, dst: Path, sample_rate_hz: int, channels: int
) -> None:
    """Decode the first audio stream of ``src`` into canonical float32 WAV at ``dst``.

    Source metadata tags and chapters are stripped (``-map_metadata -1`` /
    ``-map_chapters -1``): the canonical file must not carry tags copied from
    an untrusted upload.
    """
    try:
        subprocess.run(
            [
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
                "-c:a",
                "pcm_f32le",
                "-ar",
                str(sample_rate_hz),
                "-ac",
                str(channels),
                "-f",
                "wav",
                str(dst),
            ],
            check=True,
            capture_output=True,
            timeout=TRANSCODE_TIMEOUT_SECONDS,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        raise ApiError(ErrorCode.decode_failed, "Audio conversion failed", 422) from exc


def _run_ffprobe(path: Path) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            check=True,
            capture_output=True,
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        raise ApiError(ErrorCode.decode_failed, "The file could not be decoded", 422) from exc


def _first_audio_stream(payload: dict[str, object]) -> dict[str, object] | None:
    streams = payload.get("streams")
    if not isinstance(streams, list):
        return None
    for stream in streams:
        if isinstance(stream, dict) and stream.get("codec_type") == "audio":
            return stream
    return None


def _parse_float(value: object) -> float | None:
    if not isinstance(value, (str, int, float)):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _parse_int(value: object) -> int | None:
    if not isinstance(value, (str, int, float)):
        return None
    try:
        return int(float(value))
    except (ValueError, OverflowError):
        return None
