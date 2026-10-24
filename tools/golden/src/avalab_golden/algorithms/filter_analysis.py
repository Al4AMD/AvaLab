"""Golden cases for filter response analysis (F11, Task 5).

References
----------
* Frequency response: ``scipy.signal.freqz(b, a, worN=frequencies_hz,
  fs=48000)`` evaluated on the **inclusive** grid
  ``linspace(0, fs/2, 512)`` (controller ruling R3). SciPy's default
  ``worN=512`` grid excludes Nyquist, so the grid is always passed explicitly.
* Phase unwrapping: ``numpy.unwrap`` with the default π discontinuity
  threshold (ruling R5).
* Group delay: the pinned **finite-difference** definition (ruling R4), NOT
  ``scipy.signal.group_delay``. With ``Δω = π/(N−1)`` on the inclusive grid,

      τ[k] = −(φ[k+1] − φ[k−1]) / (2Δω)      interior
      τ[0] = −(φ[1] − φ[0]) / Δω             first point
      τ[N−1] = −(φ[N−1] − φ[N−2]) / Δω       last point

  where φ is the unwrapped phase of SciPy's ``freqz`` output. The TypeScript
  implementation applies exactly the same formula, so the comparison is
  meaningful at 1e-9.
* Step response: ``scipy.signal.lfilter(b, a, ones(64))`` (transposed direct
  form II, zero initial state).
* Poles/zeros: ``numpy.roots`` on ``a`` and on the leading-zero-trimmed
  ``b``.

Repeated-root handling (controller ruling)
------------------------------------------
The Butterworth lowpass order-4 numerator is ``k·(1 + z⁻¹)⁴``: a fourfold
zero at z = −1. The RBJ lowpass numerator is ``k·(1 + z⁻¹)²``: a double zero
there. Repeated roots are ill-conditioned in double precision, so
``numpy.roots`` and an independent Durand–Kerner solver scatter those zeros by
up to ~2e-4 even for identical coefficients. The 1e-8 root-to-root tolerance
therefore applies **only to simple roots**:

* Butterworth/RBJ **poles** are compared root-to-root at 1e-8 (simple).
* Butterworth/RBJ **zeros** are stored here as metadata only. The TypeScript
  test asserts the root count, a cluster within 1e-3 of z = −1, and the monic
  numerator residual ``|B(z)| / max(1, |z|)^degree <= 1e-8``.
* The FIR lowpass 31-tap Hamming case has distinct roots and is compared
  root-to-root at 1e-8; it pins the solver's accuracy where that claim is
  meaningful.

Root arrays are sorted by ``(round(|z|, 12), Re z, Im z)``. The 12-decimal
modulus is a tie-break: two members of a conjugate pair can differ in modulus
by ~1e-15, and the exact tuple would otherwise reorder them differently in
the reference and in the TypeScript solver.

Tolerances are stored per case; the test uses the field-specific limits
required by the brief (freqz 1e-9, group delay 1e-9, unwrap 1e-12, simple
roots 1e-8, step response 1e-12).
"""

from __future__ import annotations

import math

import numpy as np
from scipy.signal import butter, firwin, freqz, lfilter

from avalab_golden.fixtures import GoldenCase

SAMPLE_RATE_HZ = 48000
NUM_POINTS = 512
STEP_SAMPLES = 64
FREQZ_RTOL = 1e-9
FREQZ_ATOL = 1e-12
ROOT_RTOL = 1e-8
ROOT_ATOL = 1e-12
UNWRAP_RTOL = 1e-12
UNWRAP_ATOL = 1e-12
STEP_RTOL = 1e-12
STEP_ATOL = 1e-12


def _sort_key(root: complex) -> tuple[float, float, float]:
    """Deterministic sort key; the rounded modulus handles conjugate ties."""
    return (round(abs(root), 12), float(root.real), float(root.imag))


def _sorted_roots(coefficients: np.ndarray) -> list[complex]:
    trimmed = np.trim_zeros(np.asarray(coefficients, dtype=np.float64), "f")
    if trimmed.size == 0:
        return []
    roots = np.roots(trimmed)
    return sorted((complex(root) for root in roots), key=_sort_key)


def _root_fields(roots: list[complex], prefix: str) -> dict[str, list[float]]:
    return {
        f"{prefix}Re": [float(root.real) for root in roots],
        f"{prefix}Im": [float(root.imag) for root in roots],
    }


def _finite_difference_group_delay(
    phase_unwrapped: np.ndarray,
    num_points: int,
) -> np.ndarray:
    """Pinned group-delay definition: −dφ/dω on the inclusive freqz grid."""
    delta_omega = np.pi / (num_points - 1)
    group_delay = np.empty(num_points, dtype=np.float64)
    group_delay[0] = -(phase_unwrapped[1] - phase_unwrapped[0]) / delta_omega
    if num_points > 2:
        group_delay[1:-1] = (
            -(phase_unwrapped[2:] - phase_unwrapped[:-2]) / (2 * delta_omega)
        )
    group_delay[-1] = (
        -(phase_unwrapped[-1] - phase_unwrapped[-2]) / delta_omega
    )
    return group_delay


def _response_fields(
    b: np.ndarray,
    a: np.ndarray,
    num_points: int,
    step_samples: int,
) -> dict[str, list[float]]:
    """Frequency/phase/group-delay/step-response reference for one filter."""
    frequencies_hz = np.linspace(0.0, SAMPLE_RATE_HZ / 2, num_points)
    _, response = freqz(b, a, worN=frequencies_hz, fs=SAMPLE_RATE_HZ)
    phase_wrapped = np.angle(response)
    phase_unwrapped = np.unwrap(phase_wrapped)
    group_delay = _finite_difference_group_delay(phase_unwrapped, num_points)
    step = lfilter(b, a, np.ones(step_samples, dtype=np.float64))
    return {
        "magnitude": np.abs(response).tolist(),
        "phaseWrapped": phase_wrapped.tolist(),
        "phaseUnwrapped": phase_unwrapped.tolist(),
        "groupDelaySamples": group_delay.tolist(),
        "stepResponseSamples": np.asarray(step, dtype=np.float64).tolist(),
    }


def _filter_case(
    name: str,
    description: str,
    b: np.ndarray,
    a: np.ndarray,
    zero_multiplicity: int,
) -> GoldenCase:
    b = np.asarray(b, dtype=np.float64)
    a = np.asarray(a, dtype=np.float64)
    trimmed_b = np.trim_zeros(b, "f")
    expected: dict[str, object] = _response_fields(
        b, a, NUM_POINTS, STEP_SAMPLES
    )
    expected.update(_root_fields(_sorted_roots(a), "poles"))
    expected.update(_root_fields(_sorted_roots(trimmed_b), "zeros"))
    expected["zeroMultiplicity"] = zero_multiplicity
    expected["zeroClusterRe"] = -1.0
    expected["zeroClusterIm"] = 0.0
    expected["numeratorDegree"] = int(trimmed_b.size - 1)
    return GoldenCase(
        name=name,
        samples=[],
        sample_rate_hz=SAMPLE_RATE_HZ,
        params={
            "kind": "filter",
            "filter": description,
            "b": b.tolist(),
            "a": a.tolist(),
            "numPoints": NUM_POINTS,
            "sampleRateHz": SAMPLE_RATE_HZ,
            "stepSamples": STEP_SAMPLES,
        },
        expected=expected,
        rtol=FREQZ_RTOL,
        atol=FREQZ_ATOL,
    )


def _rbj_lowpass(
    frequency_hz: float,
    q: float,
) -> tuple[np.ndarray, np.ndarray]:
    """RBJ Audio EQ Cookbook lowpass, Q parameterization."""
    w0 = 2 * math.pi * frequency_hz / SAMPLE_RATE_HZ
    cos_w0 = math.cos(w0)
    sin_w0 = math.sin(w0)
    alpha = sin_w0 / (2 * q)
    b = np.array(
        [(1 - cos_w0) / 2, 1 - cos_w0, (1 - cos_w0) / 2],
        dtype=np.float64,
    )
    a = np.array([1 + alpha, -2 * cos_w0, 1 - alpha], dtype=np.float64)
    return b / (a[0]), a / (a[0])


def _distinct_root_case() -> GoldenCase:
    """FIR lowpass 31 taps Hamming: all roots simple, checked at 1e-8."""
    taps = firwin(31, 4000.0, window="hamming", fs=SAMPLE_RATE_HZ)
    taps = np.asarray(taps, dtype=np.float64)
    a = np.array([1.0], dtype=np.float64)
    trimmed_taps = np.trim_zeros(taps, "f")
    expected: dict[str, object] = {
        "zeroMultiplicity": 1,
        "zeroClusterRe": 0.0,
        "zeroClusterIm": 0.0,
        "numeratorDegree": int(trimmed_taps.size - 1),
    }
    expected.update(_root_fields(_sorted_roots(a), "poles"))
    expected.update(_root_fields(_sorted_roots(trimmed_taps), "zeros"))
    return GoldenCase(
        name="fir_lowpass_31_hamming_fc4000_fs48000_distinct_zeros",
        samples=[],
        sample_rate_hz=SAMPLE_RATE_HZ,
        params={
            "kind": "roots",
            "filter": "fir_lowpass",
            "b": taps.tolist(),
            "a": a.tolist(),
            "taps": 31,
            "cutoffHz": 4000.0,
            "window": "hamming",
            "sampleRateHz": SAMPLE_RATE_HZ,
        },
        expected=expected,
        rtol=ROOT_RTOL,
        atol=ROOT_ATOL,
    )


def _wrapped_phase_case() -> GoldenCase:
    """Synthetic wrapped phase exercising np.unwrap's π-jump rule."""
    wrapped = np.array(
        [
            0.0,
            0.35,
            0.7,
            1.05,
            1.4,
            -2.9,
            -2.55,
            -2.2,
            -1.85,
            -1.5,
            -1.15,
            -0.8,
            -0.45,
            -0.1,
            0.25,
            0.6,
            0.95,
            1.3,
            1.65,
            2.0,
            2.35,
            2.7,
            np.pi,
            -np.pi,
            -2.7,
            -2.35,
            -2.0,
            3.0,
            2.65,
            2.3,
            1.95,
            1.6,
            1.25,
            0.9,
            0.55,
            0.2,
            -0.15,
            -0.5,
            -0.85,
            -1.2,
            -1.55,
            -1.9,
        ],
        dtype=np.float64,
    )
    return GoldenCase(
        name="wrapped_phase_sequence",
        samples=[],
        sample_rate_hz=None,
        params={"kind": "wrappedPhase"},
        expected={
            "wrappedPhase": wrapped.tolist(),
            "unwrappedPhase": np.unwrap(wrapped).tolist(),
        },
        rtol=UNWRAP_RTOL,
        atol=UNWRAP_ATOL,
    )


def cases() -> list[GoldenCase]:
    """Return the filter-analysis fixture cases in stable order."""
    butterworth_b, butterworth_a = butter(
        4, 4000.0, btype="lowpass", fs=SAMPLE_RATE_HZ
    )
    rbj_b, rbj_a = _rbj_lowpass(1000.0, 0.7071)
    return [
        _filter_case(
            "butterworth_lowpass_order4_fc4000_fs48000",
            "butterworth_lowpass",
            butterworth_b,
            butterworth_a,
            4,
        ),
        _filter_case(
            "rbj_lowpass_fc1000_q0.7071_fs48000",
            "rbj_lowpass",
            rbj_b,
            rbj_a,
            2,
        ),
        _distinct_root_case(),
        _wrapped_phase_case(),
    ]
