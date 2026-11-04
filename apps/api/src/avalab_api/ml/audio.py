"""Canonical-audio helpers shared by ML runners and the job manager."""

import math
import os
import tempfile
import time
from pathlib import Path

import numpy as np
from scipy.io import wavfile  # type: ignore[import-untyped]
from scipy.signal import resample_poly  # type: ignore[import-untyped]

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.storage import Storage


def read_canonical_mono(storage: Storage, audio_id: str) -> tuple[np.ndarray, int]:
    """Read a stored canonical WAV as contiguous mono float32."""
    path = storage.canonical_path(audio_id)
    try:
        sample_rate_hz, data = wavfile.read(path)
    except (OSError, ValueError) as exc:
        raise ApiError(ErrorCode.not_found, "Unknown audio id", 404) from exc
    samples = np.asarray(data)
    if samples.ndim == 2:
        samples = samples.mean(axis=1)
    elif samples.ndim != 1:
        raise ApiError(ErrorCode.ml_failed, "Unsupported audio shape", 422)
    if np.issubdtype(samples.dtype, np.integer):
        info = np.iinfo(samples.dtype)
        samples = samples.astype(np.float32) / max(abs(info.min), info.max)
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    if samples.size and not np.isfinite(samples).all():
        raise ApiError(ErrorCode.ml_failed, "Audio contains non-finite samples", 422)
    return samples, int(sample_rate_hz)


def duration_seconds(sample_count: int, sample_rate_hz: int) -> float:
    """Duration helper that rejects a zero rate."""
    if sample_rate_hz <= 0:
        return 0.0
    return sample_count / sample_rate_hz


def write_result_wav(
    storage: Storage, samples: np.ndarray, sample_rate_hz: int
) -> str:
    """Write mono float32 samples as a canonical result and return its id."""
    if sample_rate_hz <= 0:
        raise ApiError(ErrorCode.ml_failed, "Invalid result sample rate", 422)
    if not np.isfinite(samples).all():
        raise ApiError(ErrorCode.ml_failed, "Result contains non-finite samples", 422)
    fd, name = tempfile.mkstemp(prefix="avalab_ml_result_", suffix=".wav")
    os.close(fd)
    path = Path(name)
    audio_id = storage.new_audio_id()
    try:
        wavfile.write(path, sample_rate_hz, np.ascontiguousarray(samples, dtype=np.float32))
        storage.save_canonical(
            audio_id,
            path,
            {
                "audio_id": audio_id,
                "duration_s": duration_seconds(samples.size, sample_rate_hz),
                "sample_rate_hz": sample_rate_hz,
                "channels": 1,
                "original_format": "ml_result",
                "created_at_unix": int(time.time()),
            },
        )
    except BaseException:
        path.unlink(missing_ok=True)
        storage.delete(audio_id)
        raise
    finally:
        path.unlink(missing_ok=True)
    return audio_id


def resample_to(samples: np.ndarray, from_hz: int, to_hz: int) -> np.ndarray:
    """Rational resampling with polyphase filtering; identity when rates match."""
    if from_hz == to_hz or samples.size == 0:
        return np.ascontiguousarray(samples, dtype=np.float32)
    if from_hz <= 0 or to_hz <= 0:
        raise ApiError(ErrorCode.ml_failed, "Invalid sample rate", 422)
    divisor = math.gcd(from_hz, to_hz)
    resampled = resample_poly(samples, to_hz // divisor, from_hz // divisor)
    return np.ascontiguousarray(resampled, dtype=np.float32)
