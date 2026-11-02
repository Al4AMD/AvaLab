"""Codec-delay estimation by normalized cross-correlation.

A positive lag means the test signal arrives *after* the reference. The two
signals are compared over their first ``search_seconds`` (capped by both
lengths), with means removed. The score is

    score(lag) = |corr(lag)| / sqrt(E_ref * E_test)

where ``corr`` is ``scipy.signal.correlate(test, reference)``. The largest
score inside ``±max_lag_samples`` wins; ties prefer the smaller absolute lag
and then the negative lag. The returned start offsets trim both signals to the
same samples, so a caller can compare them sample by sample.
"""

from dataclasses import dataclass

import numpy as np
from scipy import signal  # type: ignore[import-untyped]


@dataclass(frozen=True)
class Alignment:
    """Delay and trim offsets shared by the reference and decoded signals."""

    lag_samples: int
    reference_start_sample: int
    test_start_sample: int
    aligned_sample_count: int


def estimate_alignment(
    reference: np.ndarray,
    test: np.ndarray,
    *,
    sample_rate_hz: int,
    max_lag_samples: int = 8192,
    search_seconds: float = 10.0,
) -> Alignment:
    """Estimate the delay of ``test`` relative to ``reference``.

    Both arrays must be finite, non-empty and one-dimensional. Silent windows
    return lag 0 (there is no delay information in zero energy).
    """
    reference_array = np.asarray(reference)
    test_array = np.asarray(test)
    _validate_signal(reference_array, "reference")
    _validate_signal(test_array, "test")
    if not np.isfinite(sample_rate_hz) or sample_rate_hz <= 0:
        raise ValueError("sample_rate_hz must be a positive finite number")
    if max_lag_samples < 0:
        raise ValueError("max_lag_samples must be non-negative")
    if not np.isfinite(search_seconds) or search_seconds <= 0:
        raise ValueError("search_seconds must be a positive finite number")

    window_length = min(
        reference_array.size,
        test_array.size,
        round(search_seconds * sample_rate_hz),
    )
    if window_length <= 0:
        raise ValueError("search window is empty")

    reference_window = reference_array[:window_length].astype(np.float64, copy=True)
    test_window = test_array[:window_length].astype(np.float64, copy=True)
    reference_window -= reference_window.mean()
    test_window -= test_window.mean()

    reference_energy = float(np.dot(reference_window, reference_window))
    test_energy = float(np.dot(test_window, test_window))
    if reference_energy < 1e-12 or test_energy < 1e-12:
        return _alignment_from_lag(0, reference_array.size, test_array.size)

    correlation = signal.correlate(
        test_window, reference_window, mode="full", method="fft"
    )
    lags = signal.correlation_lags(test_window.size, reference_window.size, mode="full")
    denominator = float(np.sqrt(reference_energy * test_energy))

    best_lag = 0
    best_score = -1.0
    for index in np.flatnonzero(np.abs(lags) <= max_lag_samples):
        lag = int(lags[index])
        score = abs(float(correlation[index])) / denominator
        key = (abs(lag), lag >= 0)
        best_key = (abs(best_lag), best_lag >= 0)
        if score > best_score or (score == best_score and key < best_key):
            best_lag = lag
            best_score = score

    return _alignment_from_lag(best_lag, reference_array.size, test_array.size)


def align_pair(
    reference: np.ndarray, test: np.ndarray, alignment: Alignment
) -> tuple[np.ndarray, np.ndarray]:
    """Return the two aligned, equal-length slices without mutating the inputs."""
    reference_start = alignment.reference_start_sample
    test_start = alignment.test_start_sample
    count = alignment.aligned_sample_count
    return (
        reference[reference_start : reference_start + count].copy(),
        test[test_start : test_start + count].copy(),
    )


def _alignment_from_lag(
    lag: int, reference_length: int, test_length: int
) -> Alignment:
    reference_start = max(0, -lag)
    test_start = max(0, lag)
    aligned_count = min(
        reference_length - reference_start,
        test_length - test_start,
    )
    if aligned_count <= 0:
        raise ValueError("signals do not overlap")
    return Alignment(
        lag_samples=lag,
        reference_start_sample=reference_start,
        test_start_sample=test_start,
        aligned_sample_count=aligned_count,
    )


def _validate_signal(array: np.ndarray, name: str) -> None:
    if array.ndim != 1:
        raise ValueError(f"{name} must be one-dimensional")
    if array.size == 0:
        raise ValueError(f"{name} must not be empty")
    if not np.all(np.isfinite(array)):
        raise ValueError(f"{name} must contain only finite values")
