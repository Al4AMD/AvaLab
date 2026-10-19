"""Golden cases for the naive discrete Fourier transform and its inverse.

Formula (forward, SciPy convention)::

    X[k] = sum_{n=0}^{N-1} x[n] * exp(-j*2*pi*k*n/N)

Inverse::

    x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * exp(+j*2*pi*k*n/N)

Reference values come from ``scipy.fft.fft`` and ``scipy.fft.ifft`` (float64).
Each case stores the forward spectrum as ``expected.re`` / ``expected.im`` and
``expected.ifft`` = ``scipy.fft.ifft(X).real``, so the TypeScript inverse is
pinned directly, not only through a round trip.

Complexity of the TypeScript implementation: O(N^2). Edge cases covered:
impulse, DC, a full-cycle sine (44 cycles at N = 4800, so no spectral
leakage), an odd-length asymmetric real signal with a complex spectrum, and
N = 1.
"""

from __future__ import annotations

import numpy as np
from scipy import fft as scipy_fft

from avalab_golden.fixtures import GoldenCase

DFT_RTOL = 1e-12
DFT_ATOL = 1e-12
SINE_FREQUENCY_HZ = 440.0
SINE_SAMPLE_RATE_HZ = 48000
SINE_CYCLES = 44
SINE_SAMPLE_COUNT = 4800
ODD_SAMPLE_COUNT = 7
ODD_SINE_BIN = 3
ODD_IMPULSE_INDEX = 2
ODD_IMPULSE_HEIGHT = 0.5


def _spectrum_case(name: str, samples: np.ndarray, sample_rate_hz: int | None) -> GoldenCase:
    spectrum = scipy_fft.fft(samples)
    inverse = scipy_fft.ifft(spectrum).real
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=sample_rate_hz,
        expected={
            "re": spectrum.real.tolist(),
            "im": spectrum.imag.tolist(),
            "ifft": inverse.tolist(),
        },
        rtol=DFT_RTOL,
        atol=DFT_ATOL,
    )


def _impulse_8() -> GoldenCase:
    samples = np.zeros(8, dtype=np.float64)
    samples[0] = 1.0
    return _spectrum_case("impulse_8", samples, None)


def _dc_8() -> GoldenCase:
    samples = np.ones(8, dtype=np.float64)
    return _spectrum_case("dc_8", samples, None)


def _sine_440hz_44_cycles_48000() -> GoldenCase:
    sample_index = np.arange(SINE_SAMPLE_COUNT, dtype=np.float64)
    samples = np.sin(2.0 * np.pi * SINE_FREQUENCY_HZ * sample_index / SINE_SAMPLE_RATE_HZ)
    return _spectrum_case(
        "sine_440hz_44_cycles_48000",
        samples,
        SINE_SAMPLE_RATE_HZ,
    )


def _odd_n7_asymmetric() -> GoldenCase:
    sample_index = np.arange(ODD_SAMPLE_COUNT, dtype=np.float64)
    samples = np.sin(2.0 * np.pi * ODD_SINE_BIN * sample_index / ODD_SAMPLE_COUNT)
    samples[ODD_IMPULSE_INDEX] += ODD_IMPULSE_HEIGHT
    return _spectrum_case("odd_n7_asymmetric", samples, None)


def _single_sample() -> GoldenCase:
    return _spectrum_case("single_sample", np.array([0.5], dtype=np.float64), None)


def cases() -> list[GoldenCase]:
    """Return the DFT fixture case set in stable order."""
    return [
        _impulse_8(),
        _dc_8(),
        _sine_440hz_44_cycles_48000(),
        _odd_n7_asymmetric(),
        _single_sample(),
    ]
