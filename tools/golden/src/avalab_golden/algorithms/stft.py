"""Golden cases for the short-time Fourier transform (STFT) and its inverse.

Pinned convention (matches ``packages/dsp/src/fourier/stft.ts``)::

    M = ceil(N / hop)
    frame m, n = 0..frame_length-1:
        y_m[n] = x[m*hop + n]   (zero when m*hop + n >= N)
    X_m[k] = sum_n w[n] * y_m[n] * exp(-j*2*pi*k*n/fft_length)
             for k = 0..fft_length-1

The forward transform is UNNORMALIZED: no ``1/fft_length`` and no window-sum
scaling. Frames are zero-padded from ``frame_length`` to ``fft_length`` before
the transform, and every frame is stored (frame-major, flat ``re`` / ``im``
arrays of length ``frames * fft_length``).

The spectra are computed directly with ``scipy.fft.fft(w * frame, n=fft)``.
As a cross-check, the same frames are recomputed with
``scipy.signal.stft(..., scaling="spectrum", boundary=None, padded=False,
return_onesided=False)``; SciPy's "spectrum" scaling divides by
``window.sum()``, so multiplying by ``window.sum()`` restores the unnormalized
DFT. The two paths must agree to rtol = 1e-12, atol = 1e-12 (asserted below).
The signal fed to ``scipy.signal.stft`` is padded to
``(frames - 1) * hop + frame_length`` samples so that exactly ``frames``
windows fit; the extra zero-padding from ``frame_length`` to ``fft_length`` is
performed by the ``nfft`` argument.

``expected.reconstruction`` stores the original N samples. With the synthesis
window and the per-sample squared-window normalization, inverse STFT of these
frames reproduces them (RTOL 1e-9, ATOL 1e-12); the sine starts at x[0] = 0,
so the periodic-hann zero at w[0] (R16) does not affect the pin.

Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
sections 10.3-10.4. All inputs are deterministic (no RNG).
"""

from __future__ import annotations

import numpy as np
from scipy import fft as scipy_fft
from scipy import signal as scipy_signal

from avalab_golden.fixtures import GoldenCase

STFT_RTOL = 1e-9
STFT_ATOL = 1e-12
CROSS_CHECK_RTOL = 1e-12
CROSS_CHECK_ATOL = 1e-12

SAMPLE_RATE_HZ = 48_000
DURATION_SAMPLES = 4096
SINE_FREQUENCY_HZ = 440.0

# (name, window kind, frame_length, hop_length, fft_length)
CASES: tuple[tuple[str, str, int, int, int], ...] = (
    ("sine440_hann_hop64_fft256", "hann", 256, 64, 256),
    ("sine440_hann_hop64_fft512", "hann", 256, 64, 512),
    ("sine440_rect_hop256_fft256", "rect", 256, 256, 256),
)


def _sine() -> np.ndarray:
    sample_index = np.arange(DURATION_SAMPLES, dtype=np.float64)
    return np.sin(2.0 * np.pi * SINE_FREQUENCY_HZ * sample_index / SAMPLE_RATE_HZ)


def _window(kind: str, length: int) -> np.ndarray:
    if kind == "rect":
        return scipy_signal.windows.boxcar(length, sym=False)
    if kind == "hann":
        return scipy_signal.windows.hann(length, sym=False)
    raise ValueError(f"unsupported window kind: {kind}")


def _direct_spectrum(
    samples: np.ndarray,
    window: np.ndarray,
    frame_length: int,
    hop_length: int,
    fft_length: int,
) -> np.ndarray:
    """Return the frame-major (frames, fft_length) unnormalized windowed DFT."""
    frame_count = -(-len(samples) // hop_length)
    spectrum = np.empty((frame_count, fft_length), dtype=np.complex128)
    for frame_index in range(frame_count):
        start = frame_index * hop_length
        frame = np.zeros(frame_length, dtype=np.float64)
        available = min(frame_length, len(samples) - start)
        if available > 0:
            frame[:available] = samples[start : start + available]
        spectrum[frame_index] = scipy_fft.fft(window * frame, n=fft_length)
    return spectrum


def _assert_scipy_stft_agrees(
    samples: np.ndarray,
    window: np.ndarray,
    spectrum: np.ndarray,
    frame_length: int,
    hop_length: int,
    fft_length: int,
) -> None:
    """Prove the direct FFT path matches scipy.signal.stft (spectrum scaling undone)."""
    frame_count = spectrum.shape[0]
    padded_length = (frame_count - 1) * hop_length + frame_length
    padded = np.zeros(padded_length, dtype=np.float64)
    padded[: len(samples)] = samples
    _, _, scaled = scipy_signal.stft(
        padded,
        fs=float(SAMPLE_RATE_HZ),
        window=window,
        nperseg=frame_length,
        noverlap=frame_length - hop_length,
        nfft=fft_length,
        boundary=None,
        padded=False,
        scaling="spectrum",
        return_onesided=False,
    )
    assert scaled.shape == (fft_length, frame_count), scaled.shape
    np.testing.assert_allclose(
        scaled.T * window.sum(),
        spectrum,
        rtol=CROSS_CHECK_RTOL,
        atol=CROSS_CHECK_ATOL,
    )


def _stft_case(
    name: str,
    kind: str,
    frame_length: int,
    hop_length: int,
    fft_length: int,
) -> GoldenCase:
    samples = _sine()
    window = _window(kind, frame_length)
    spectrum = _direct_spectrum(samples, window, frame_length, hop_length, fft_length)
    _assert_scipy_stft_agrees(
        samples, window, spectrum, frame_length, hop_length, fft_length
    )
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=SAMPLE_RATE_HZ,
        params={
            "frame_length": frame_length,
            "hop_length": hop_length,
            "fft_length": fft_length,
        },
        expected={
            "re": spectrum.real.ravel().tolist(),
            "im": spectrum.imag.ravel().tolist(),
            "reconstruction": samples.tolist(),
        },
        rtol=STFT_RTOL,
        atol=STFT_ATOL,
    )


def cases() -> list[GoldenCase]:
    """Return the STFT fixture case set in stable order."""
    return [
        _stft_case(name, kind, frame_length, hop_length, fft_length)
        for name, kind, frame_length, hop_length, fft_length in CASES
    ]
