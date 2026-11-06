"""Fundamental-frequency tracking with librosa.pyin (F14, no neural weights)."""

from collections.abc import Callable

import librosa
import numpy as np

from avalab_api.ml.jobs import MlResult


def _finite(value: float) -> float | None:
    number = float(value)
    return number if np.isfinite(number) else None


def run(
    samples: np.ndarray,
    sample_rate_hz: int,
    params: dict[str, object],
    progress: Callable[[float], None],
) -> MlResult:
    """Estimate F0 per frame; unvoiced frames keep probability but no Hz value."""
    del params
    progress(0.05)
    f0_hz, _voiced_flag, voiced_probability = librosa.pyin(
        np.asarray(samples, dtype=np.float32),
        fmin=65,
        fmax=1000,
        sr=sample_rate_hz,
        frame_length=2048,
    )
    progress(0.95)
    times_s = librosa.times_like(f0_hz, sr=sample_rate_hz)
    f0_values = [_finite(value) for value in f0_hz]
    probabilities = [
        float(value) if np.isfinite(value) else 0.0 for value in voiced_probability
    ]
    voiced = [value for value in f0_values if value is not None]
    stats: dict[str, object] = {
        "median_f0_hz": float(np.median(voiced)) if voiced else None,
        "voiced_fraction": len(voiced) / len(f0_values) if f0_values else 0.0,
    }
    progress(1.0)
    return MlResult(
        kind="analysis",
        analysis={
            "analysis_kind": "pitch",
            "times_s": [float(value) for value in times_s],
            "f0_hz": f0_values,
            "voiced_probability": probabilities,
        },
        stats=stats,
    )
