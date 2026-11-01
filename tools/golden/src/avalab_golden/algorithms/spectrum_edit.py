"""Golden cases for the F09 spectrum editor.

The NumPy reference mirrors ``packages/dsp/src/fourier/spectrumEdit.ts``:
rectangular window, zero-pad to the next power of two, full-band preset edits
on the one-sided spectrum, Hermitian mirroring, and the real part of the
inverse transform truncated to the input length.

Presets (``buildSpectrumPreset``):
    zeroIm          Im{X[k]} = 0 for every bin
    zeroRe          Re{X[k]} = 0 for every bin
    zeroPhase       phase = 0 for every bin (same as magnitudeOnly)
    magnitudeOnly   phase = 0 for every bin
    phaseOnly       |X[k]| = 1 for every bin, phase kept
"""

from __future__ import annotations

import numpy as np

from avalab_golden.fixtures import GoldenCase

SPECTRUM_EDIT_RTOL = 1e-12
SPECTRUM_EDIT_ATOL = 0.0

SAMPLES = np.array([0.25, -0.5, 1.0, 0.0, -1.5, 0.75, 0.125, -0.25], dtype=np.float64)


def _apply_preset(samples: np.ndarray, preset: str, fft_length: int) -> np.ndarray:
    spectrum = np.fft.rfft(samples, n=fft_length)
    if preset == "zeroIm":
        spectrum = spectrum.real.astype(np.complex128)
    elif preset == "zeroRe":
        spectrum = (1j * spectrum.imag).astype(np.complex128)
    elif preset in {"zeroPhase", "magnitudeOnly"}:
        spectrum = np.abs(spectrum).astype(np.complex128)
    elif preset == "phaseOnly":
        spectrum = np.exp(1j * np.angle(spectrum))
    else:
        raise ValueError(f"unknown preset {preset!r}")
    return np.fft.irfft(spectrum, n=fft_length)[: samples.size]


def cases() -> list[GoldenCase]:
    """Return the spectrum-edit fixture case set in stable order."""
    fft_length = 8
    result: list[GoldenCase] = []
    for preset in ("zeroIm", "zeroRe", "zeroPhase", "magnitudeOnly", "phaseOnly"):
        result.append(
            GoldenCase(
                name=f"{preset}_fixed8",
                samples=SAMPLES.tolist(),
                sample_rate_hz=None,
                params={
                    "preset": preset,
                    "hermitian": True,
                    "fftLengthSamples": fft_length,
                },
                expected={"samples": _apply_preset(SAMPLES, preset, fft_length).tolist()},
                rtol=SPECTRUM_EDIT_RTOL,
                atol=SPECTRUM_EDIT_ATOL,
            )
        )
    return result
