"""Golden cases for the analysis/synthesis windows and the Kaiser window.

Periodic windows (denominator ``L``, SciPy ``sym=False``) are the variant used
by the STFT::

    hann[n]     = 0.5 - 0.5*cos(2*pi*n/L)
    hamming[n]  = 0.54 - 0.46*cos(2*pi*n/L)
    blackman[n] = 0.42 - 0.5*cos(2*pi*n/L) + 0.08*cos(4*pi*n/L)

The symmetric variant (denominator ``L-1``, SciPy default ``sym=True``) is
used by FIR filter design. The Kaiser window is symmetric::

    w[n] = I0(beta * sqrt(1 - (2*n/(L-1) - 1)^2)) / I0(beta)

Reference values come from ``scipy.signal.windows`` and ``scipy.special.i0``
(float64). The ``i0_probe`` cases pin the 30-term power series directly.

Tolerance: rtol = 1e-9, atol = 1e-12.
"""

from __future__ import annotations

import numpy as np
from scipy import special
from scipy.signal import windows as scipy_windows

from avalab_golden.fixtures import GoldenCase

WINDOW_RTOL = 1e-9
WINDOW_ATOL = 1e-12

PERIODIC_WINDOWS: tuple[tuple[str, int], ...] = (
    ("rect", 64),
    ("hann", 64),
    ("hamming", 64),
    ("blackman", 64),
    ("rect", 2),
    ("hann", 2),
    ("hamming", 2),
    ("blackman", 2),
)

KAISER_CASES: tuple[tuple[int, float], ...] = ((64, 8.6), (2, 8.6))

I0_PROBES: tuple[float, ...] = (0.0, 1.0, 8.6, 12.0)


def _periodic(name: str, length: int) -> np.ndarray:
    if name == "rect":
        return scipy_windows.boxcar(length, sym=False)
    function = {
        "hann": scipy_windows.hann,
        "hamming": scipy_windows.hamming,
        "blackman": scipy_windows.blackman,
    }[name]
    return function(length, sym=False)


def _window_case(kind: str, length: int) -> GoldenCase:
    values = _periodic(kind, length)
    return GoldenCase(
        name=f"periodic_{kind}_len{length}",
        samples=[],
        sample_rate_hz=None,
        params={"kind": kind, "length": length},
        expected={"w": values.tolist()},
        rtol=WINDOW_RTOL,
        atol=WINDOW_ATOL,
    )


def _kaiser_case(length: int, beta: float) -> GoldenCase:
    values = scipy_windows.kaiser(length, beta, sym=True)
    return GoldenCase(
        name=f"kaiser_len{length}_beta{beta}",
        samples=[],
        sample_rate_hz=None,
        params={"kind": "kaiser", "length": length, "beta": beta},
        expected={"w": values.tolist()},
        rtol=WINDOW_RTOL,
        atol=WINDOW_ATOL,
    )


def _i0_case(x: float) -> GoldenCase:
    return GoldenCase(
        name=f"i0_probe_x{x}",
        samples=[],
        sample_rate_hz=None,
        params={"x": x},
        expected={"value": float(special.i0(x))},
        rtol=WINDOW_RTOL,
        atol=WINDOW_ATOL,
    )


def cases() -> list[GoldenCase]:
    """Return the window fixture case set in stable order."""
    return [
        *(_window_case(kind, length) for kind, length in PERIODIC_WINDOWS),
        *(_kaiser_case(length, beta) for length, beta in KAISER_CASES),
        *(_i0_case(x) for x in I0_PROBES),
    ]
