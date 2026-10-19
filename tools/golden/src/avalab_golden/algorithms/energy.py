"""Golden cases for discrete-time signal energy.

Formula (real-valued samples, float64 reference)::

    E = sum_{n=0}^{N-1} x[n]**2

Reference values are computed with NumPy as ``np.sum(np.square(x))``.
Complexity: O(N). Edge cases covered: full-cycle sine (E = N/2 in exact
arithmetic), silence (E = 0), single-sample impulse (E = 1), and a
constant signal (E = N * 0.5**2).
"""

from __future__ import annotations

import numpy as np

from avalab_golden.fixtures import GoldenCase

SINE_FREQUENCY_HZ = 440.0
SINE_SAMPLE_RATE_HZ = 48000
SINE_DURATION_S = 1.0
SILENCE_LENGTH = 1000
CONSTANT_LENGTH = 64
CONSTANT_VALUE = 0.5


def _energy_of(samples: np.ndarray) -> float:
    return float(np.sum(np.square(samples)))


def _sine_440hz_1s_48000() -> GoldenCase:
    sample_count = int(SINE_SAMPLE_RATE_HZ * SINE_DURATION_S)
    sample_index = np.arange(sample_count, dtype=np.float64)
    samples = np.sin(2.0 * np.pi * SINE_FREQUENCY_HZ * sample_index / SINE_SAMPLE_RATE_HZ)
    return GoldenCase(
        name="sine_440hz_1s_48000",
        samples=samples.tolist(),
        sample_rate_hz=SINE_SAMPLE_RATE_HZ,
        expected={"energy": _energy_of(samples)},
    )


def _silence_1000() -> GoldenCase:
    samples = np.zeros(SILENCE_LENGTH, dtype=np.float64)
    return GoldenCase(
        name="silence_1000",
        samples=samples.tolist(),
        sample_rate_hz=None,
        expected={"energy": _energy_of(samples)},
    )


def _impulse_1_sample() -> GoldenCase:
    samples = np.array([1.0], dtype=np.float64)
    return GoldenCase(
        name="impulse_1_sample",
        samples=samples.tolist(),
        sample_rate_hz=None,
        expected={"energy": _energy_of(samples)},
    )


def _constant_half_64() -> GoldenCase:
    samples = np.full(CONSTANT_LENGTH, CONSTANT_VALUE, dtype=np.float64)
    return GoldenCase(
        name="constant_half_64",
        samples=samples.tolist(),
        sample_rate_hz=None,
        expected={"energy": _energy_of(samples)},
    )


def cases() -> list[GoldenCase]:
    """Return the energy fixture case set in stable order."""
    return [_sine_440hz_1s_48000(), _silence_1000(), _impulse_1_sample(), _constant_half_64()]
