"""Tempo and beat-time tracking with librosa.beat (F14, no neural weights)."""

from collections.abc import Callable

import librosa
import numpy as np

from avalab_api.ml.jobs import MlResult


def run(
    samples: np.ndarray,
    sample_rate_hz: int,
    params: dict[str, object],
    progress: Callable[[float], None],
) -> MlResult:
    """Detect a global tempo and sorted beat times on the mono excerpt."""
    del params
    progress(0.05)
    tempo_bpm, beat_frames = librosa.beat.beat_track(
        y=np.asarray(samples, dtype=np.float32),
        sr=sample_rate_hz,
        hop_length=256,
    )
    progress(0.95)
    tempos = np.asarray(tempo_bpm, dtype=np.float64).reshape(-1)
    beat_times_s = librosa.frames_to_time(beat_frames, sr=sample_rate_hz)
    progress(1.0)
    return MlResult(
        kind="analysis",
        analysis={
            "analysis_kind": "beat",
            "tempo_bpm": float(tempos[0]) if tempos.size > 0 else 0.0,
            "beat_times_s": [float(value) for value in beat_times_s],
        },
        stats={},
    )
