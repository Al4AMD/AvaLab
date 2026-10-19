"""Golden cases for Fourier-series partial sums (F12).

The series are the NumPy transcription of ``fourierSeries.ts``:

    square    x(t) = sum_{k odd}  4a/(pi*k)               * sin(2*pi*k*f*t)
    sawtooth  x(t) = sum_{k >= 1} 2a/(pi*k) * (-1)^(k+1)  * sin(2*pi*k*f*t)
    triangle  x(t) = sum_{k odd}  8a/(pi^2*k^2)
                                  * (-1)^((k-1)/2)        * sin(2*pi*k*f*t)

Every case uses the pinned grid T = 0.02 s, fs = 1000 Hz (N = 20 samples,
exactly one period of a 50 Hz wave), amplitude 1.0. The square cases pin the
partial sums at 1, 3, 5 and 51 harmonics (the last one shows the Gibbs
ringing); the sawtooth uses 10 harmonics and the triangle 9.

Tolerance: rtol = 1e-9, atol = 1e-12 (the fixture default).
"""

from __future__ import annotations

import numpy as np

from avalab_golden.fixtures import GoldenCase

DURATION_SECONDS = 0.02
SAMPLE_RATE_HZ = 1000
SAMPLE_COUNT = 20
FREQUENCY_HZ = 50.0
AMPLITUDE = 1.0
FOURIER_RTOL = 1e-9


def _time_seconds() -> np.ndarray:
    return np.arange(SAMPLE_COUNT, dtype=np.float64) / SAMPLE_RATE_HZ


def _partial_sum(kind: str, harmonics: int) -> np.ndarray:
    time = _time_seconds()
    values = np.zeros(SAMPLE_COUNT, dtype=np.float64)
    if kind == "square":
        for k in range(1, harmonics + 1, 2):
            values += (4.0 * AMPLITUDE / (np.pi * k)) * np.sin(
                2.0 * np.pi * k * FREQUENCY_HZ * time
            )
    elif kind == "sawtooth":
        for k in range(1, harmonics + 1):
            sign = 1.0 if k % 2 == 1 else -1.0
            values += (2.0 * AMPLITUDE / (np.pi * k)) * sign * np.sin(
                2.0 * np.pi * k * FREQUENCY_HZ * time
            )
    elif kind == "triangle":
        for k in range(1, harmonics + 1, 2):
            sign = 1.0 if ((k - 1) // 2) % 2 == 0 else -1.0
            values += (8.0 * AMPLITUDE / (np.pi * np.pi * k * k)) * sign * np.sin(
                2.0 * np.pi * k * FREQUENCY_HZ * time
            )
    else:
        raise ValueError(f"unknown Fourier-series kind {kind!r}")
    return values


def _case(kind: str, harmonics: int) -> GoldenCase:
    return GoldenCase(
        name=f"{kind}_50hz_h{harmonics}_amplitude1",
        samples=[],
        sample_rate_hz=SAMPLE_RATE_HZ,
        params={
            "kind": kind,
            "durationSeconds": DURATION_SECONDS,
            "sampleRateHz": SAMPLE_RATE_HZ,
            "frequencyHz": FREQUENCY_HZ,
            "harmonics": harmonics,
            "amplitude": AMPLITUDE,
        },
        expected={"samples": _partial_sum(kind, harmonics).tolist()},
        rtol=FOURIER_RTOL,
    )


def cases() -> list[GoldenCase]:
    """Return the Fourier-series fixture case set in stable order."""
    return [
        _case("square", 1),
        _case("square", 3),
        _case("square", 5),
        _case("square", 51),
        _case("sawtooth", 10),
        _case("triangle", 9),
    ]
