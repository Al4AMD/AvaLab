"""Golden cases for the MDCT/IMDCT pair with TDAC overlap-add synthesis.

Pinned convention (controller amendment 2026-10-25, matches
``packages/dsp/src/timestretch/mdct.ts``)::

    hop = frame_length // 2      (2N = frame_length, N = hop)
    window w[n] = sin(pi*(n+0.5)/(2N)), n = 0..2N-1
        (applied at ANALYSIS and SYNTHESIS)
    M = ceil(sample_count / N); frame_count = M + 1  (pre-roll frame)
    frame i, 0-based, block start s_i = (i-1)*N:
        u_i[n] = x[s_i + n] * w[n]   (zero outside [0, sample_count))
        X_i[k] = sum_n u_i[n] * cos(pi*(2k+1)*(2n+1+N)/(4N)), k = 0..N-1
    inverse:
        v_i[n] = (2/N) * sum_k X_i[k] * cos(...same angle...)
        y[s_i + n] += v_i[n] * w[n]   (plain overlap-add, NO sum-w^2 division:
            every output sample is covered by exactly two frames and
            w[j]^2 + w[N+j]^2 = 1 exactly for the sine window)
    output length (frame_count-1)*N = M*N; positions [sample_count, M*N)
    are exact zeros (the cross terms cancel to 0 there), so callers trim.

Basis note: the angle ``pi*(2k+1)*(2n+1+N)/(4N)`` is the plain DCT-IV MDCT
angle ``pi*(2n+1)*(2k+1)/(4N)`` rotated per bin k by ``(2k+1)*pi/4``. The
rotation is what makes TDAC reconstruct: with the plain angle the per-frame
round trip is ``v[n] = u[n] - u[2N-1-n]`` (composite I - A) and the two
windows covering an interior sample swap DIFFERENT mirror samples, which no
window pair can cancel; with the rotated angle both windows reference one
shared mirror sample (weights -w[j0]*w[N-1-j0] + w[N+j0]*w[2N-1-j0] = 0 by
window symmetry) and the main terms give w[j0]^2 + w[N+j0]^2 = 1. This is
the half-sample-shifted basis real codecs (AAC, Vorbis, MP3) use; see
Princen & Bradley, IEEE Trans. ASSP 34(5), 1986.

Cross-check: the direct basis sum is asserted against the folded
``scipy.fft`` type-IV construction

    z[m]  = u[m] - u[2N-1-m],  z2[m] = u[m] + u[2N-1-m]   (m = 0..N-1)
    X[k]  = 0.5 * ( cos((2k+1)*pi/4) * dct(z, type=4)[k]
                  - sin((2k+1)*pi/4) * dst(z2, type=4)[k] )

to rtol = 1e-9, atol = 3e-12 (float accumulation between the BLAS matmul and
the FFT path peaked at 2.7e-12 absolute at N = 256, measured on these cases). ``expected.reconstruction``
stores the TDAC
overlap-add of the coefficients; it must reproduce ``samples`` padded with
zeros to ``M*N`` at rtol 1e-9, atol 1e-11. The loose atol is deliberate:
the TS implementation reduces the basis angles with Math.cos and sums in a
different order than SciPy/BLAS, so coefficient comparisons carry argument-
reduction noise (measured max 4.2e-12 across these cases, |X| up to ~157).

Reference: Princen & Bradley, IEEE Trans. ASSP 34(5), 1986; Malvar,
"Lapped transforms for efficient transform/subband coding", IEEE Trans.
ASSP 38(6), 1990. All inputs are deterministic (seeded, documented below).
"""

from __future__ import annotations

import math

import numpy as np
from scipy import fft as scipy_fft

from avalab_golden.fixtures import GoldenCase

MDCT_RTOL = 1e-9
MDCT_ATOL = 1e-11
CROSS_CHECK_RTOL = 1e-9
CROSS_CHECK_ATOL = 3e-12
PR_CHECK_RTOL = 1e-9
PR_CHECK_ATOL = 1e-12

SAMPLE_RATE_HZ = 48_000


def _sine(duration_samples: int, frequency_hz: float = 440.0) -> np.ndarray:
    sample_index = np.arange(duration_samples, dtype=np.float64)
    return np.sin(2.0 * np.pi * frequency_hz * sample_index / SAMPLE_RATE_HZ)


def _basis(frame_length: int) -> np.ndarray:
    """Return the (N, 2N) cosine basis (rows are bins k, columns are n)."""
    hop = frame_length // 2
    k = np.arange(hop, dtype=np.float64)
    n = np.arange(frame_length, dtype=np.float64)
    angle = math.pi * np.outer(2 * k + 1, 2 * n + 1 + hop) / (4 * hop)
    return np.cos(angle)


def _window(frame_length: int) -> np.ndarray:
    hop = frame_length // 2
    n = np.arange(frame_length, dtype=np.float64)
    return np.sin(math.pi * (n + 0.5) / (2 * hop))


def _windowed_frames(
    samples: np.ndarray, window: np.ndarray, hop: int, frame_count: int
) -> np.ndarray:
    """Return (frame_count, 2N) windowed analysis blocks (u_i)."""
    frame_length = window.shape[0]
    u = np.zeros((frame_count, frame_length), dtype=np.float64)
    for i in range(frame_count):
        start = (i - 1) * hop
        for n in range(frame_length):
            offset = start + n
            if 0 <= offset < samples.shape[0]:
                u[i, n] = samples[offset] * window[n]
    return u


def _direct_mdct(u: np.ndarray, basis: np.ndarray) -> np.ndarray:
    """Return (frame_count, N) coefficients from the direct basis sum."""
    return u @ basis.T


def _assert_dct4_construction(
    u: np.ndarray, coefficients: np.ndarray, frame_length: int
) -> None:
    """Prove the direct basis sum equals the folded scipy.fft type-IV path."""
    hop = frame_length // 2
    dk = (2 * np.arange(hop, dtype=np.float64) + 1) * math.pi / 4
    cos_dk = np.cos(dk)
    sin_dk = np.sin(dk)
    for i in range(u.shape[0]):
        # u[i, ::-1] reversed gives u[2N-1], ..., u[0]; fold-minus takes
        # u[m] - u[2N-1-m] for m = 0..N-1 (the second half is u[N-1]..u[0]).
        fold_minus = u[i, :hop] - u[i, frame_length - 1 : hop - 1 : -1]
        fold_plus = u[i, :hop] + u[i, frame_length - 1 : hop - 1 : -1]
        built = 0.5 * (
            cos_dk * scipy_fft.dct(fold_minus, type=4)
            - sin_dk * scipy_fft.dst(fold_plus, type=4)
        )
        np.testing.assert_allclose(
            built, coefficients[i], rtol=CROSS_CHECK_RTOL, atol=CROSS_CHECK_ATOL
        )


def _overlap_add(coefficients: np.ndarray, window: np.ndarray, hop: int) -> np.ndarray:
    """Return the (frame_count-1)*hop TDAC synthesis (exact zeros beyond input)."""
    frame_length = window.shape[0]
    basis = _basis(frame_length)
    output_length = (coefficients.shape[0] - 1) * hop
    y = np.zeros(output_length, dtype=np.float64)
    for i in range(coefficients.shape[0]):
        start = (i - 1) * hop
        v = (2.0 / hop) * (basis.T @ coefficients[i])
        for n in range(frame_length):
            offset = start + n
            if 0 <= offset < output_length:
                y[offset] += v[n] * window[n]
    return y


def _mdct_case(name: str, samples: np.ndarray, frame_length: int) -> GoldenCase:
    hop = frame_length // 2
    frame_count = -(-len(samples) // hop) + 1
    window = _window(frame_length)
    basis = _basis(frame_length)
    u = _windowed_frames(samples, window, hop, frame_count)
    coefficients = _direct_mdct(u, basis)
    _assert_dct4_construction(u, coefficients, frame_length)
    reconstruction = _overlap_add(coefficients, window, hop)
    np.testing.assert_allclose(
        reconstruction,
        np.pad(samples, (0, reconstruction.shape[0] - samples.shape[0])),
        rtol=PR_CHECK_RTOL,
        atol=PR_CHECK_ATOL,
    )
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=SAMPLE_RATE_HZ,
        params={
            "frame_length_samples": frame_length,
            "hop_length_samples": hop,
        },
        expected={
            "coefficients": coefficients.ravel().tolist(),
            "reconstruction": reconstruction.tolist(),
        },
        rtol=MDCT_RTOL,
        atol=MDCT_ATOL,
    )


def cases() -> list[GoldenCase]:
    """Return the MDCT fixture case set in stable order."""
    sine = _sine(4096)
    dc = np.full(2048, 0.25, dtype=np.float64)
    impulse_0 = np.zeros(1024, dtype=np.float64)
    impulse_0[0] = 1.0
    impulse_255 = np.zeros(1024, dtype=np.float64)
    impulse_255[255] = 1.0
    # numpy PCG64 seeds; values flow into the fixture JSON, so only
    # within-NumPy determinism matters (byte-identical regen).
    uniform = np.random.default_rng(2026).uniform(-1.0, 1.0, size=4096)
    ramp_jitter = np.arange(11, dtype=np.float64) * 0.1
    ramp_jitter += 0.05 * np.random.default_rng(11).uniform(-1.0, 1.0, size=11)
    return [
        _mdct_case("sine440_frame512", sine, 512),
        _mdct_case("dc_frame512", dc, 512),
        _mdct_case("impulse_0_frame512", impulse_0, 512),
        _mdct_case("impulse_255_frame512", impulse_255, 512),
        _mdct_case("random_frame512", uniform, 512),
        _mdct_case("random_frame4_min", ramp_jitter, 4),
    ]
