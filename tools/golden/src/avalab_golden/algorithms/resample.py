"""Golden cases for rational resampling (F03).

Three short 0.9-amplitude sine inputs (0.05 s, controller ruling R9 keeps the
JSON small) pin the filtered path:

    48000 -> 24000 Hz, 5 kHz sine
    44100 -> 48000 Hz, 1 kHz sine
    48000 ->  8000 Hz, 1 kHz sine

Construction (deliberately the same design as
``packages/dsp/src/resample/resample.ts``):

    g      = gcd(input_rate_hz, output_rate_hz)
    L      = output_rate_hz // g          # upsampling factor
    M      = input_rate_hz // g           # downsampling factor
    maxr   = max(L, M)
    half   = 16 * maxr                    # halfLengthSamples = 16 input samples
    fc     = 1 / maxr                     # fraction of the upsampled Nyquist
    taps   = scipy.signal.firwin(2*half + 1, fc, window=("kaiser", 8.6))

``firwin`` is SciPy's window-method implementation of the same windowed-sinc
definition: ``h[k] = fc*sinc(fc*(k-half)) * kaiser[k]`` followed by
``h /= sum(h)`` (``scale=True``, the pinned unity-DC normalization). Passing
the taps explicitly to ``scipy.signal.resample_poly(x, L, M, window=taps)``
prevents SciPy from replacing them with its default ``half_len = 10*maxr``
prototype; SciPy then applies its polyphase ``upfirdn`` filter with zero
boundary extension and the zero-phase pre-pad/pre-remove alignment, and
multiplies the taps by ``L`` internally (the same scale factor as the TS
implementation).

Output length is ``round(N * output_rate_hz / input_rate_hz)``; all three
cases divide exactly. Tolerance rtol = 1e-7 (atol stays at the fixture default
1e-12): the TypeScript filter is built from the 30-term I0 series in plan 01,
while SciPy uses ``scipy.special.i0``, and the polyphase summation order
differs. Those differences are far below 1e-7 but larger than the usual 1e-9
golden default, so the deviation is documented here.
"""

from __future__ import annotations

from math import gcd

import numpy as np
from scipy.signal import firwin, resample_poly

from avalab_golden.fixtures import GoldenCase

RESAMPLE_RTOL = 1e-7
DURATION_SECONDS = 0.05
AMPLITUDE = 0.9
HALF_LENGTH_INPUT_SAMPLES = 16
KAISER_BETA = 8.6

CASES: tuple[tuple[str, int, int, float], ...] = (
    ("resample_48000_to_24000_sine5000hz", 48000, 24000, 5000.0),
    ("resample_44100_to_48000_sine1000hz", 44100, 48000, 1000.0),
    ("resample_48000_to_8000_sine1000hz", 48000, 8000, 1000.0),
)


def _input_sine(input_rate_hz: int, frequency_hz: float) -> np.ndarray:
    # int(round(...)) is exact for the three pinned integer rates.
    sample_count = round(DURATION_SECONDS * input_rate_hz)
    n = np.arange(sample_count, dtype=np.float64)
    return AMPLITUDE * np.sin(2.0 * np.pi * frequency_hz * n / input_rate_hz)


def _design_taps(input_rate_hz: int, output_rate_hz: int) -> tuple[int, int, np.ndarray]:
    divisor = gcd(input_rate_hz, output_rate_hz)
    up = output_rate_hz // divisor
    down = input_rate_hz // divisor
    max_rate = max(up, down)
    half_length = HALF_LENGTH_INPUT_SAMPLES * max_rate
    cutoff = 1.0 / max_rate
    taps = firwin(2 * half_length + 1, cutoff, window=("kaiser", KAISER_BETA))
    return up, down, taps


def _case(name: str, input_rate_hz: int, output_rate_hz: int, frequency_hz: float) -> GoldenCase:
    samples = _input_sine(input_rate_hz, frequency_hz)
    up, down, taps = _design_taps(input_rate_hz, output_rate_hz)
    resampled = resample_poly(samples, up, down, window=taps)

    expected_length = round(len(samples) * output_rate_hz / input_rate_hz)
    if resampled.size != expected_length:
        raise RuntimeError(
            f"{name}: scipy produced {resampled.size} samples, expected {expected_length}"
        )

    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=input_rate_hz,
        params={
            "operation": "resampleRational",
            "inputRateHz": input_rate_hz,
            "outputRateHz": output_rate_hz,
            "filter": "kaiserSinc",
            "kaiserBeta": KAISER_BETA,
            "halfLengthInputSamples": HALF_LENGTH_INPUT_SAMPLES,
        },
        expected={"samples": resampled.tolist()},
        rtol=RESAMPLE_RTOL,
    )


def cases() -> list[GoldenCase]:
    """Return the resample fixture case set in stable order."""
    return [
        _case(name, input_rate_hz, output_rate_hz, frequency_hz)
        for name, input_rate_hz, output_rate_hz, frequency_hz in CASES
    ]
