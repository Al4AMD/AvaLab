"""Golden cases for F03 uniform quantization.

The NumPy reference pins the same definition as
``packages/dsp/src/metrics/quantize.ts``:

    levels = 2**bits
    delta  = 2 / (levels - 1)
    y[n]   = clip(delta * round_half_up(x[n] / delta), -1, 1)

``Math.round`` is exact half-up toward +infinity. The reference implements
that exactly as ``f = floor(v); f + 1 where v - f >= 0.5 else f``. It does NOT
use ``np.floor(v + 0.5)``: adding 0.5 can round a value within 1 ulp below a
half-integer up to the tie and disagree with ``Math.round``. NumPy's
``np.round`` uses banker's rounding and is also NOT the pinned tie rule. The
clip is applied after rounding.

Dither is deliberately absent: the TPDF noise comes from the TypeScript
mulberry32 PRNG and is not reproducible in NumPy (documented in the module
header of quantize.ts). Dither determinism is tested in
``packages/dsp/test/metrics/quantize.test.ts``.

All cases use rtol = 1e-12 with the fixture default atol = 1e-12 (differences
of exactly-representable binary values, so the tolerance has margin).
"""

from __future__ import annotations

import numpy as np

from avalab_golden.fixtures import GoldenCase

QUANTIZE_RTOL = 1e-12


def _quantize_uniform(samples: np.ndarray, bits: int) -> np.ndarray:
    delta = 2.0 / (float(2**bits) - 1.0)
    quotient = samples / delta
    floored = np.floor(quotient)
    # Exact half-up (ties toward +infinity), matching ECMAScript Math.round.
    # floor(q + 0.5) is not equivalent for q within 1 ulp below a half-integer.
    codes = np.where(quotient - floored >= 0.5, floored + 1.0, floored)
    return np.clip(delta * codes, -1.0, 1.0)


def _case(
    name: str,
    samples: np.ndarray,
    bits: int,
    sample_rate_hz: int | None = None,
) -> GoldenCase:
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=sample_rate_hz,
        params={"operation": "quantizeUniform", "bits": bits},
        expected={"samples": _quantize_uniform(samples, bits).tolist()},
        rtol=QUANTIZE_RTOL,
    )


def _sine() -> np.ndarray:
    sample_rate_hz = 8000
    duration_seconds = 0.05
    sample_count = int(sample_rate_hz * duration_seconds)
    n = np.arange(sample_count, dtype=np.float64)
    return 0.9 * np.sin(2.0 * np.pi * 440.0 * n / sample_rate_hz)


def cases() -> list[GoldenCase]:
    """Return the quantize fixture case set in stable order."""
    ramp = np.linspace(-1.0, 1.0, 9)
    clipping = np.array(
        [-2.5, -1.5, -1.0, -0.999, 0.0, 0.999, 1.0, 1.5, 2.5],
        dtype=np.float64,
    )

    return [
        _case("quantize_ramp9_bits3", ramp, 3),
        _case("quantize_sine_440hz_bits8", _sine(), 8, sample_rate_hz=8000),
        _case("quantize_clipping_bits4", clipping, 4),
    ]
