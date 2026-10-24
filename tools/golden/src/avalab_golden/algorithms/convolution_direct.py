"""Golden cases for direct linear convolution (F10).

The reference is NumPy's ``np.convolve(x, h, mode="full")``, which implements
the same linear convolution sum as
``packages/dsp/src/systems/convolution.ts``:

    y[n] = sum_{k=0}^{M-1} h[k] * x[n-k],  n = 0 .. N+M-2,

with x and h implicitly zero outside their supports. The four cases pin the
contract of the brief:

    impulse * arbitrary kernel      identity/shift behavior of a delta
    N=32 ramp * M=5 decaying exp    a typical signal/kernel pair
    N=3 * M=3 known values          small hand-checkable case
    N=100 * M=1                     scalar scaling (kernel length 1)

Both operands are exact binary values or NumPy float64 evaluations, and the
TypeScript implementation accumulates in the same Float64 precision in the
same natural order, so rtol = 1e-12 is the pinned tolerance (fixture default
atol = 1e-12). The kernel travels in ``params["h"]`` because the fixture
schema has a single ``input.samples`` array.
"""

from __future__ import annotations

import numpy as np

from avalab_golden.fixtures import GoldenCase

CONVOLUTION_RTOL = 1e-12


def _case(name: str, samples: np.ndarray, kernel: np.ndarray) -> GoldenCase:
    expected = np.convolve(samples, kernel, mode="full")
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=None,
        params={"h": kernel.tolist()},
        expected={"samples": expected.tolist()},
        rtol=CONVOLUTION_RTOL,
    )


def cases() -> list[GoldenCase]:
    """Return the direct-convolution fixture case set in stable order."""
    impulse = np.zeros(5, dtype=np.float64)
    impulse[2] = 1.0
    kernel = np.array([1.0, -2.0, 0.5, 3.0], dtype=np.float64)

    ramp = np.arange(32, dtype=np.float64)
    decaying_exponential = np.exp(-np.arange(5, dtype=np.float64))

    known_signal = np.array([1.0, 2.0, 3.0], dtype=np.float64)
    known_kernel = np.array([4.0, 5.0, 6.0], dtype=np.float64)

    hundred = np.linspace(-1.0, 1.0, 100, dtype=np.float64)
    scalar_kernel = np.array([0.5], dtype=np.float64)

    return [
        _case("impulse_conv_arbitrary_kernel", impulse, kernel),
        _case("ramp32_conv_decaying_exponential5", ramp, decaying_exponential),
        _case("known_3x3", known_signal, known_kernel),
        _case("hundred_conv_scalar", hundred, scalar_kernel),
    ]
