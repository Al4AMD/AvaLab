"""POST /api/v1/codec/encode — real ffmpeg codecs with delay alignment.

The stored source is already a validated canonical WAV. This route still
re-checks the id and metadata, encodes a mono excerpt with a fixed ffmpeg
argument array, decodes the result back to canonical float32 WAV, aligns it to
the 16-bit PCM reference by cross-correlation, and stores only the aligned
result under a fresh id. Every temp file and every partially-created result
directory is removed on failure.
"""

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Annotated

import numpy as np
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from scipy.io import wavfile  # type: ignore[import-untyped]

from avalab_api.alignment import Alignment, estimate_alignment
from avalab_api.codecs import CodecName, encode_audio, resolve_codec, validate_params
from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode, ErrorResponse
from avalab_api.ffmpeg import transcode_to_canonical_wav
from avalab_api.storage import Storage

router = APIRouter()

ENCODED_TEMP_PREFIX = "avalab_codec_encoded_"
DECODED_TEMP_PREFIX = "avalab_codec_decoded_"
TRIMMED_TEMP_PREFIX = "avalab_codec_trimmed_"


class CodecParams(BaseModel):
    """Optional codec-specific quality controls; validated per codec."""

    bitrate_kbps: int | None = None
    quality: int | None = None
    compression_level: int | None = None


class CodecEncodeRequest(BaseModel):
    """Reference to a stored canonical excerpt and the requested codec."""

    audio_id: str
    codec: CodecName
    params: CodecParams = Field(default_factory=CodecParams)


class CodecEncodeResponse(BaseModel):
    """Encoded size, aligned reference window and quality metadata."""

    result_audio_id: str
    size_bytes: int
    bitrate_kbps: float
    encode_ms: float
    codec_delay_samples: int
    reference_start_sample: int
    aligned_sample_count: int
    duration_s: float
    sample_rate_hz: int
    channels: int
    bit_exact: bool
    lossless: bool


@router.post(
    "/codec/encode",
    responses={
        400: {
            "model": ErrorResponse,
            "description": "Malformed request body (invalid_request)",
        },
        404: {
            "model": ErrorResponse,
            "description": "Unknown audio id or corrupt metadata (not_found)",
        },
        422: {
            "model": ErrorResponse,
            "description": (
                "Invalid codec/params, unavailable encoder or encode failure "
                "(invalid_request, codec_unavailable, encode_failed)"
            ),
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal storage failure (internal_error)",
        },
    },
)
def encode_codec(
    request: CodecEncodeRequest,
    settings: Annotated[Settings, Depends(get_settings)],
) -> CodecEncodeResponse:
    """Encode, decode, align and store one excerpt with the requested codec."""
    storage = Storage(settings.storage_dir)
    source_path = storage.canonical_path(request.audio_id)
    source_rate, source_channels = _read_source_info(
        storage, source_path, request.audio_id
    )

    spec = resolve_codec(request.codec)
    params = validate_params(
        request.codec, request.params.model_dump(exclude_none=True)
    )

    encoded_path = _temp_path(ENCODED_TEMP_PREFIX, spec.extension)
    decoded_path = _temp_path(DECODED_TEMP_PREFIX, ".wav")
    trimmed_path = _temp_path(TRIMMED_TEMP_PREFIX, ".wav")
    result_audio_id: str | None = None

    try:
        started = time.perf_counter()
        encode_audio(
            source_path,
            encoded_path,
            request.codec,
            params,
            channels=source_channels,
        )
        encode_ms = (time.perf_counter() - started) * 1000.0

        try:
            transcode_to_canonical_wav(
                encoded_path, decoded_path, source_rate, channels=source_channels
            )
        except ApiError as exc:
            raise ApiError(
                ErrorCode.encode_failed, "Decoded audio could not be read", 422
            ) from exc

        reference_channels, reference_mono, decoded_channels = _read_pair(
            source_path, decoded_path, source_rate, source_channels
        )
        alignment = _align(reference_mono, _mono(decoded_channels), source_rate)
        reference_aligned = reference_channels[
            alignment.reference_start_sample : alignment.reference_start_sample
            + alignment.aligned_sample_count
        ]
        test_aligned = decoded_channels[
            alignment.test_start_sample : alignment.test_start_sample
            + alignment.aligned_sample_count
        ]
        bit_exact = bool(spec.lossless and np.array_equal(reference_aligned, test_aligned))

        result = test_aligned[:, 0] if source_channels == 1 else test_aligned
        wavfile.write(trimmed_path, source_rate, result.astype(np.float32))

        source_duration_s = reference_channels.shape[0] / source_rate
        size_bytes = encoded_path.stat().st_size
        result_audio_id = storage.new_audio_id()
        storage.save_canonical(
            result_audio_id,
            trimmed_path,
            {
                "audio_id": result_audio_id,
                "duration_s": alignment.aligned_sample_count / source_rate,
                "sample_rate_hz": source_rate,
                "channels": source_channels,
                "original_format": request.codec,
                "created_at_unix": int(time.time()),
            },
        )
        return CodecEncodeResponse(
            result_audio_id=result_audio_id,
            size_bytes=size_bytes,
            bitrate_kbps=size_bytes * 8.0 / (source_duration_s * 1000.0),
            encode_ms=encode_ms,
            codec_delay_samples=alignment.lag_samples,
            reference_start_sample=alignment.reference_start_sample,
            aligned_sample_count=alignment.aligned_sample_count,
            duration_s=alignment.aligned_sample_count / source_rate,
            sample_rate_hz=source_rate,
            channels=source_channels,
            bit_exact=bit_exact,
            lossless=spec.lossless,
        )
    except BaseException:
        if result_audio_id is not None:
            storage.delete(result_audio_id)
        raise
    finally:
        for path in (encoded_path, decoded_path, trimmed_path):
            path.unlink(missing_ok=True)


def _temp_path(prefix: str, suffix: str) -> Path:
    fd, name = tempfile.mkstemp(prefix=prefix, suffix=suffix)
    os.close(fd)
    return Path(name)


def _read_source_info(
    storage: Storage, source_path: Path, audio_id: str
) -> tuple[int, int]:
    """Read and validate the stored sample rate and channel count."""
    try:
        if not source_path.is_file():
            raise OSError("missing canonical audio")
        payload = json.loads(storage.meta_path(audio_id).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ApiError(ErrorCode.not_found, "Unknown audio id", 404) from exc
    if not isinstance(payload, dict):
        raise ApiError(ErrorCode.not_found, "Unknown audio id", 404)
    rate = payload.get("sample_rate_hz")
    channels = payload.get("channels")
    if (
        isinstance(rate, bool)
        or not isinstance(rate, int)
        or rate <= 0
        or isinstance(channels, bool)
        or not isinstance(channels, int)
        or channels not in (1, 2)
    ):
        raise ApiError(ErrorCode.not_found, "Unknown audio id", 404)
    return rate, channels


def _read_pair(
    source_path: Path, decoded_path: Path, source_rate: int, source_channels: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Read both WAVs as per-channel float64; reference lanes are Int16-quantized.

    Returns ``(reference_channels, reference_mono, decoded_channels)`` where the
    channel arrays are ``(N, C)`` and ``reference_mono`` is the quantized downmix
    used for alignment, matching the mono behavior.
    """
    try:
        reference_rate, reference_raw = wavfile.read(source_path)
        decoded_rate, decoded_raw = wavfile.read(decoded_path)
    except (OSError, ValueError) as exc:
        raise ApiError(ErrorCode.encode_failed, "Audio could not be read", 422) from exc
    if (
        reference_rate != source_rate
        or decoded_rate != source_rate
        or reference_raw.size == 0
        or decoded_raw.size == 0
    ):
        raise ApiError(ErrorCode.encode_failed, "Audio could not be read", 422)

    reference_channels = _quantize(_channels(reference_raw, source_channels))
    reference_mono = _quantize(_mono(reference_raw))
    return reference_channels, reference_mono, _channels(decoded_raw, source_channels)


def _channels(samples: np.ndarray, expected: int) -> np.ndarray:
    data = np.asarray(samples, dtype=np.float64)
    if data.ndim == 1 and expected == 1:
        return data.reshape(-1, 1)
    if data.ndim == 2 and data.shape[1] == expected:
        return data
    raise ApiError(ErrorCode.encode_failed, "Unexpected audio shape", 422)


def _quantize(samples: np.ndarray) -> np.ndarray:
    pcm = np.clip(np.round(samples * 32768.0), -32768, 32767).astype(np.int16)
    return pcm.astype(np.float64) / 32768.0


def _mono(samples: np.ndarray) -> np.ndarray:
    data = np.asarray(samples, dtype=np.float64)
    if data.ndim == 1:
        return data
    if data.ndim == 2:
        return data.mean(axis=1)
    raise ApiError(ErrorCode.encode_failed, "Unexpected audio shape", 422)


def _align(reference: np.ndarray, decoded: np.ndarray, sample_rate: int) -> Alignment:
    try:
        return estimate_alignment(reference, decoded, sample_rate_hz=sample_rate)
    except ValueError as exc:
        raise ApiError(
            ErrorCode.encode_failed, "Decoded audio does not overlap the source", 422
        ) from exc
