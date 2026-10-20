"""Registry of golden-vector generators, keyed by algorithm name."""

from __future__ import annotations

from collections.abc import Callable

from avalab_golden.algorithms import (
    dft,
    energy,
    extent,
    fft,
    fft_arbitrary,
    fourier_series,
    generators,
    metrics,
    quantize,
    rfft,
    stft,
    windows,
)
from avalab_golden.fixtures import GoldenCase

GENERATORS: dict[str, Callable[[], list[GoldenCase]]] = {
    "dft": dft.cases,
    "energy": energy.cases,
    "extent": extent.cases,
    "fft": fft.cases,
    "fft_arbitrary": fft_arbitrary.cases,
    "fourier_series": fourier_series.cases,
    "generators": generators.cases,
    "metrics": metrics.cases,
    "quantize": quantize.cases,
    "rfft": rfft.cases,
    "stft": stft.cases,
    "windows": windows.cases,
}

__all__ = ["GENERATORS"]
