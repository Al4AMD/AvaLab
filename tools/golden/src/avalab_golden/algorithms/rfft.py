"""Golden cases for the real-input FFT and its Hermitian inverse.

Formula (forward, SciPy convention, half-spectrum)::

    X[k] = sum_{n=0}^{N-1} x[n] * exp(-j*2*pi*k*n/N),  k = 0..floor(N/2)

A real signal has the Hermitian-symmetric spectrum ``X[N-k] = conj(X[k])``,
so only ``floor(N/2)+1`` bins carry information. Reference values come from
``scipy.fft.rfft`` (float64). Each case stores the half-spectrum as
``expected.re`` / ``expected.im`` and ``expected.irfft`` = flat real
``scipy.fft.irfft(spectrum, n=N)``, so the TypeScript inverse is pinned
directly, not only through a round trip.

Sizes: N = 1024 (even, radix-2 path), N = 997 (odd, prime, Bluestein path)
and N = 1 (single bin). Random samples are Gaussian noise from
``np.random.default_rng(seed).standard_normal(N)`` with a per-case seed; the
values are stored literally in the fixture, so the TypeScript side never
reproduces the RNG and the JSON writer remains deterministic. The N = 1 case
uses the fixed sample 0.5.

Tolerance: rtol = 1e-9, atol = 1e-12 (float64 half-spectrum vs SciPy).
"""

from __future__ import annotations

import numpy as np
from scipy import fft as scipy_fft

from avalab_golden.fixtures import GoldenCase

RFFT_RTOL = 1e-9
RFFT_ATOL = 1e-12

RANDOM_CASES: tuple[tuple[str, int, int], ...] = (
    ("random_n1024_seed42", 1024, 42),
    ("random_n997_seed43", 997, 43),
)


def _case(name: str, samples: np.ndarray) -> GoldenCase:
    spectrum = scipy_fft.rfft(samples)
    inverse = scipy_fft.irfft(spectrum, n=samples.size)
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=None,
        expected={
            "re": spectrum.real.tolist(),
            "im": spectrum.imag.tolist(),
            "irfft": inverse.tolist(),
        },
        rtol=RFFT_RTOL,
        atol=RFFT_ATOL,
    )


def _random_case(name: str, size: int, seed: int) -> GoldenCase:
    rng = np.random.default_rng(seed)
    return _case(name, rng.standard_normal(size))


def cases() -> list[GoldenCase]:
    """Return the real-FFT fixture case set in stable order."""
    return [
        *(_random_case(name, size, seed) for name, size, seed in RANDOM_CASES),
        _case("single_sample_n1", np.array([0.5], dtype=np.float64)),
    ]
