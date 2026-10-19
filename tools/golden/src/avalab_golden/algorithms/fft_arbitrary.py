"""Golden cases for arbitrary-length FFT via the Bluestein chirp-z transform.

Formula (forward, SciPy convention)::

    X[k] = sum_{n=0}^{N-1} x[n] * exp(-j*2*pi*k*n/N)

Inverse::

    x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * exp(+j*2*pi*k*n/N)

Reference values come from ``scipy.fft.fft`` and ``scipy.fft.ifft`` (float64).
Each case stores the forward spectrum as ``expected.re`` / ``expected.im`` and
``expected.ifft`` = ``scipy.fft.ifft(X).real``, so the TypeScript inverse is
pinned directly, not only through a round trip.

Sizes cover the cases that force the Bluestein path instead of radix-2:
N = 6 and N = 1000 (composite, non-power-of-two), N = 997 (prime) and
N = 4801 (prime, larger than the usual textbook demos). Samples are Gaussian
noise from ``np.random.default_rng(seed).standard_normal(N)`` with a per-case
seed; the values are stored literally in the fixture, so the TypeScript side
never reproduces the RNG and the JSON writer remains deterministic.

Tolerance: rtol = 1e-9, atol = 1e-12 (float64 Bluestein vs SciPy).
"""

from __future__ import annotations

import numpy as np
from scipy import fft as scipy_fft

from avalab_golden.fixtures import GoldenCase

FFT_ARBITRARY_RTOL = 1e-9
FFT_ARBITRARY_ATOL = 1e-12

CASES: tuple[tuple[str, int, int], ...] = (
    ("random_n6_seed42", 6, 42),
    ("random_n997_seed43", 997, 43),
    ("random_n1000_seed44", 1000, 44),
    ("random_n4801_seed45", 4801, 45),
)


def _random_case(name: str, size: int, seed: int) -> GoldenCase:
    rng = np.random.default_rng(seed)
    samples = rng.standard_normal(size)
    spectrum = scipy_fft.fft(samples)
    inverse = scipy_fft.ifft(spectrum).real
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=None,
        expected={
            "re": spectrum.real.tolist(),
            "im": spectrum.imag.tolist(),
            "ifft": inverse.tolist(),
        },
        rtol=FFT_ARBITRARY_RTOL,
        atol=FFT_ARBITRARY_ATOL,
    )


def cases() -> list[GoldenCase]:
    """Return the arbitrary-N FFT fixture case set in stable order."""
    return [_random_case(name, size, seed) for name, size, seed in CASES]
