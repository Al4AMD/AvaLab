"""Golden cases for window-method FIR design (F11).

The reference is ``scipy.signal.firwin(..., scale=True, fs=48000)``, which
builds the same windowed-sinc sum as
``packages/dsp/src/filters/fir.ts``:

    alpha = (N - 1) / 2
    m[n]  = n - alpha
    h[n]  = w[n] * sum over passbands [left, right] of
            (right * sinc(right*m[n]) - left * sinc(left*m[n]))

with cutoff frequencies normalized by ``fs/2``. Passbands per band:

    lowpass   [0, fc]              highpass  [fc, 1]
    bandpass  [f1, f2]             bandstop  [0, f1] and [f2, 1]

SciPy's ``scale=True`` normalization is reproduced exactly by the TypeScript
implementation. The scale frequency is the first passband edge that is fixed:

    lowpass / bandstop  first passband starts at DC  -> divide by sum(h),
                        i.e. unity DC gain
    highpass            first passband ends at Nyquist -> divide by
                        sum(h[n] * cos(pi*m[n] * 1)), i.e. unity at fs/2
    bandpass            neither edge is 0 or 1 -> divide by
                        sum(h[n] * cos(pi*m[n] * f_center)),
                        f_center = (left + right) / 2 of the first passband

These are the two conventions documented by ``firwin`` (unity at the first
passband edge when it is DC or Nyquist, otherwise unity at the passband
centre). The fourth case (bandpass) is why a single "sum = 1" normalization is
not enough.

Cases (brief plus the even-tap pin from Review Focus 3):

    lowpass  31 taps hamming  fc 4 kHz          fs 48 kHz
    highpass 33 taps hamming  fc 4 kHz          fs 48 kHz (even taps rejected)
    bandpass 41 taps blackman fc 4-12 kHz       fs 48 kHz
    bandstop 33 taps kaiser beta 5, fc 4-12 kHz fs 48 kHz
    lowpass  32 taps hamming  fc 4 kHz          fs 48 kHz (even taps allowed)

Tolerance: rtol = 1e-9, atol = 1e-12 (same window formulas; only summation
order differs from NumPy).
"""

from __future__ import annotations

import numpy as np
from scipy.signal import firwin

from avalab_golden.fixtures import GoldenCase

FIR_RTOL = 1e-9
FIR_ATOL = 1e-12


def _window_argument(window_filter: dict[str, object]) -> str | tuple[str, float]:
    kind = str(window_filter["kind"])
    if kind == "kaiser":
        return ("kaiser", float(window_filter["beta"]))
    return kind


def _case(
    name: str,
    band: str,
    cutoff_hz: list[float],
    taps: int,
    sample_rate_hz: int,
    window_filter: dict[str, object],
) -> GoldenCase:
    pass_zero = {
        "lowpass": "lowpass",
        "highpass": "highpass",
        "bandpass": "bandpass",
        "bandstop": "bandstop",
    }[band]
    coefficients = firwin(
        taps,
        cutoff_hz,
        window=_window_argument(window_filter),
        pass_zero=pass_zero,
        scale=True,
        fs=sample_rate_hz,
    )
    return GoldenCase(
        name=name,
        samples=[],
        sample_rate_hz=None,
        params={
            "band": band,
            "cutoffHz": cutoff_hz,
            "taps": taps,
            "sampleRateHz": sample_rate_hz,
            "windowFilter": window_filter,
        },
        expected={"taps": np.asarray(coefficients, dtype=np.float64).tolist()},
        rtol=FIR_RTOL,
        atol=FIR_ATOL,
    )


def cases() -> list[GoldenCase]:
    """Return the FIR window-method fixture case set in stable order."""
    return [
        _case(
            "lowpass_31_hamming_fc4000_fs48000",
            "lowpass",
            [4000.0],
            31,
            48000,
            {"kind": "hamming"},
        ),
        _case(
            "highpass_33_hamming_fc4000_fs48000",
            "highpass",
            [4000.0],
            33,
            48000,
            {"kind": "hamming"},
        ),
        _case(
            "bandpass_41_blackman_fc4000_12000_fs48000",
            "bandpass",
            [4000.0, 12000.0],
            41,
            48000,
            {"kind": "blackman"},
        ),
        _case(
            "bandstop_33_kaiser_beta5_fc4000_12000_fs48000",
            "bandstop",
            [4000.0, 12000.0],
            33,
            48000,
            {"kind": "kaiser", "beta": 5.0},
        ),
        _case(
            "lowpass_32_hamming_fc4000_fs48000_even_taps",
            "lowpass",
            [4000.0],
            32,
            48000,
            {"kind": "hamming"},
        ),
    ]
