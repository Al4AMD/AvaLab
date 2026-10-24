"""Golden cases for IIR filter design (F11).

Part 1: Butterworth and Chebyshev type I
---------------------------------------
The reference is ``scipy.signal.butter`` / ``scipy.signal.cheby1`` with
``fs = 48000`` and the matching ``btype``. SciPy builds the same chain as
``packages/dsp/src/filters/iir.ts``:

    analog prototype (buttap / cheb1ap)
      -> prewarped frequency transform (lp2lp / lp2hp / lp2bp / lp2bs)
      -> bilinear transform with fs = 2 (its internal normalized form)
      -> zpk2tf

The cases pin the plan's set plus the controller's R10 set:

    butterworth lowpass   order 4  4000 Hz
    butterworth highpass  order 4  4000 Hz
    butterworth bandpass  order 3  1000-4000 Hz
    butterworth bandstop  order 2  1000-4000 Hz
    chebyshev1  lowpass   order 4  4000 Hz  ripple 0.5 dB
    chebyshev1  highpass  order 4  4000 Hz  ripple 0.5 dB
    chebyshev1  bandpass  order 3  1000-4000 Hz  ripple 0.5 dB
    butterworth lowpass   order 4  2000 Hz
    butterworth highpass  order 2  4000 Hz
    butterworth bandpass  order 4  1000-4000 Hz
    chebyshev1  lowpass   order 5  4000 Hz  ripple 1 dB
    chebyshev1  bandpass  order 4  1000-4000 Hz  ripple 1 dB

Tolerance rtol = 1e-9, atol = 1e-12 (same formulas; only libm/summation
rounding differs from NumPy).

Part 2: RBJ biquads
-------------------
The Audio EQ Cookbook formulas ARE the definition, so the golden values are
evaluated analytically in NumPy at fs = 48000 (no SciPy filter design call).
Cases: lowpass 1 kHz Q 0.7071, highpass 4 kHz Q 0.7071, notch 1 kHz Q 1,
peaking 2 kHz Q 1 at +6 dB and +12 dB. Tolerance rtol = 1e-12, atol = 1e-15
(closed-form double-precision coefficients).

For every case the fixture also stores the response of the designed filter to
a deterministic 64-sample input using ``scipy.signal.lfilter`` (transposed
direct form II with zero initial state), so the TypeScript ``applyFilter`` is
checked against SciPy as well.
"""

from __future__ import annotations

import math

import numpy as np
from scipy.signal import butter, cheby1, lfilter

from avalab_golden.fixtures import GoldenCase

SAMPLE_RATE_HZ = 48000
IIR_RTOL = 1e-9
IIR_ATOL = 1e-12
BIQUAD_RTOL = 1e-12
BIQUAD_ATOL = 1e-15


def _input_samples() -> np.ndarray:
    """Deterministic 64-sample probe used to exercise applyFilter."""
    index = np.arange(64, dtype=np.float64)
    samples = 0.6 * np.sin(2 * np.pi * 1000 * index / SAMPLE_RATE_HZ)
    samples += 0.25 * np.cos(2 * np.pi * 3000 * index / SAMPLE_RATE_HZ)
    samples[5] += 0.5
    return samples


def _iir_case(
    name: str,
    design: str,
    band: str,
    cutoff_hz: list[float],
    order: int,
    ripple_db: float | None = None,
) -> GoldenCase:
    if design == "butterworth":
        critical = cutoff_hz[0] if band in ("lowpass", "highpass") else cutoff_hz
        b, a = butter(order, critical, btype=band, fs=SAMPLE_RATE_HZ)
        params: dict[str, object] = {
            "design": design,
            "band": band,
            "cutoffHz": cutoff_hz,
            "order": order,
            "sampleRateHz": SAMPLE_RATE_HZ,
        }
    elif design == "chebyshev1":
        assert ripple_db is not None
        critical = cutoff_hz[0] if band in ("lowpass", "highpass") else cutoff_hz
        b, a = cheby1(order, ripple_db, critical, btype=band, fs=SAMPLE_RATE_HZ)
        params = {
            "design": design,
            "band": band,
            "cutoffHz": cutoff_hz,
            "order": order,
            "rippleDb": ripple_db,
            "sampleRateHz": SAMPLE_RATE_HZ,
        }
    else:  # pragma: no cover - internal misuse guard
        raise ValueError(f"unknown IIR design {design!r}")

    b = np.asarray(b, dtype=np.float64)
    a = np.asarray(a, dtype=np.float64)
    samples = _input_samples()
    filtered = lfilter(b, a, samples)
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=SAMPLE_RATE_HZ,
        params=params,
        expected={
            "b": b.tolist(),
            "a": a.tolist(),
            "filteredSamples": np.asarray(filtered, dtype=np.float64).tolist(),
        },
        rtol=IIR_RTOL,
        atol=IIR_ATOL,
    )


def _rbj_coefficients(
    kind: str,
    frequency_hz: float,
    q: float,
    gain_db: float,
) -> tuple[np.ndarray, np.ndarray]:
    """RBJ Audio EQ Cookbook coefficients, Q parameterization."""
    w0 = 2 * math.pi * frequency_hz / SAMPLE_RATE_HZ
    cos_w0 = math.cos(w0)
    sin_w0 = math.sin(w0)
    alpha = sin_w0 / (2 * q)
    amplitude = 10 ** (gain_db / 40)

    if kind == "lowpass":
        b0, b1, b2 = (1 - cos_w0) / 2, 1 - cos_w0, (1 - cos_w0) / 2
        a0, a1, a2 = 1 + alpha, -2 * cos_w0, 1 - alpha
    elif kind == "highpass":
        b0, b1, b2 = (1 + cos_w0) / 2, -(1 + cos_w0), (1 + cos_w0) / 2
        a0, a1, a2 = 1 + alpha, -2 * cos_w0, 1 - alpha
    elif kind == "notch":
        b0, b1, b2 = 1.0, -2 * cos_w0, 1.0
        a0, a1, a2 = 1 + alpha, -2 * cos_w0, 1 - alpha
    elif kind == "peaking":
        b0, b1, b2 = 1 + alpha * amplitude, -2 * cos_w0, 1 - alpha * amplitude
        a0, a1, a2 = 1 + alpha / amplitude, -2 * cos_w0, 1 - alpha / amplitude
    else:  # pragma: no cover - internal misuse guard
        raise ValueError(f"unknown RBJ biquad {kind!r}")

    b = np.array([b0, b1, b2], dtype=np.float64) / a0
    a = np.array([a0, a1, a2], dtype=np.float64) / a0
    return b, a


def _biquad_case(
    name: str,
    kind: str,
    frequency_hz: float,
    q: float,
    gain_db: float = 0.0,
) -> GoldenCase:
    b, a = _rbj_coefficients(kind, frequency_hz, q, gain_db)
    samples = _input_samples()
    filtered = lfilter(b, a, samples)
    params: dict[str, object] = {
        "design": "biquad",
        "type": kind,
        "frequencyHz": frequency_hz,
        "q": q,
        "sampleRateHz": SAMPLE_RATE_HZ,
    }
    if kind == "peaking":
        params["gainDb"] = gain_db
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=SAMPLE_RATE_HZ,
        params=params,
        expected={
            "b": b.tolist(),
            "a": a.tolist(),
            "filteredSamples": np.asarray(filtered, dtype=np.float64).tolist(),
        },
        rtol=BIQUAD_RTOL,
        atol=BIQUAD_ATOL,
    )


def cases() -> list[GoldenCase]:
    """Return the IIR fixture case set in stable order."""
    return [
        _iir_case(
            "butterworth_lowpass_order4_fc4000_fs48000",
            "butterworth",
            "lowpass",
            [4000.0],
            4,
        ),
        _iir_case(
            "butterworth_highpass_order4_fc4000_fs48000",
            "butterworth",
            "highpass",
            [4000.0],
            4,
        ),
        _iir_case(
            "butterworth_bandpass_order3_fc1000_4000_fs48000",
            "butterworth",
            "bandpass",
            [1000.0, 4000.0],
            3,
        ),
        _iir_case(
            "butterworth_bandstop_order2_fc1000_4000_fs48000",
            "butterworth",
            "bandstop",
            [1000.0, 4000.0],
            2,
        ),
        _iir_case(
            "chebyshev1_lowpass_order4_fc4000_ripple0.5_fs48000",
            "chebyshev1",
            "lowpass",
            [4000.0],
            4,
            ripple_db=0.5,
        ),
        _iir_case(
            "chebyshev1_highpass_order4_fc4000_ripple0.5_fs48000",
            "chebyshev1",
            "highpass",
            [4000.0],
            4,
            ripple_db=0.5,
        ),
        _iir_case(
            "chebyshev1_bandpass_order3_fc1000_4000_ripple0.5_fs48000",
            "chebyshev1",
            "bandpass",
            [1000.0, 4000.0],
            3,
            ripple_db=0.5,
        ),
        _iir_case(
            "butterworth_lowpass_order4_fc2000_fs48000",
            "butterworth",
            "lowpass",
            [2000.0],
            4,
        ),
        _iir_case(
            "butterworth_highpass_order2_fc4000_fs48000",
            "butterworth",
            "highpass",
            [4000.0],
            2,
        ),
        _iir_case(
            "butterworth_bandpass_order4_fc1000_4000_fs48000",
            "butterworth",
            "bandpass",
            [1000.0, 4000.0],
            4,
        ),
        _iir_case(
            "chebyshev1_lowpass_order5_fc4000_ripple1_fs48000",
            "chebyshev1",
            "lowpass",
            [4000.0],
            5,
            ripple_db=1.0,
        ),
        _iir_case(
            "chebyshev1_bandpass_order4_fc1000_4000_ripple1_fs48000",
            "chebyshev1",
            "bandpass",
            [1000.0, 4000.0],
            4,
            ripple_db=1.0,
        ),
        _biquad_case("biquad_lowpass_fc1000_q0.7071_fs48000", "lowpass", 1000.0, 0.7071),
        _biquad_case("biquad_highpass_fc4000_q0.7071_fs48000", "highpass", 4000.0, 0.7071),
        _biquad_case("biquad_notch_fc1000_q1_fs48000", "notch", 1000.0, 1.0),
        _biquad_case(
            "biquad_peaking_fc2000_q1_gain6_fs48000",
            "peaking",
            2000.0,
            1.0,
            gain_db=6.0,
        ),
        _biquad_case(
            "biquad_peaking_fc2000_q1_gain12_fs48000",
            "peaking",
            2000.0,
            1.0,
            gain_db=12.0,
        ),
    ]
