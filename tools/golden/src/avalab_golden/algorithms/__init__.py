"""Registry of golden-vector generators, keyed by algorithm name."""

from __future__ import annotations

from collections.abc import Callable

from avalab_golden.algorithms import (
    companding,
    convolution_direct,
    dft,
    energy,
    extent,
    fft,
    fft_arbitrary,
    filter_analysis,
    fir,
    fourier_series,
    generators,
    iir,
    metrics,
    quantize,
    resample,
    rle,
    rfft,
    stft,
    windows,
)
from avalab_golden.fixtures import GoldenCase

GENERATORS: dict[str, Callable[[], list[GoldenCase]]] = {
    "companding": companding.cases,
    "convolution_direct": convolution_direct.cases,
    "dft": dft.cases,
    "energy": energy.cases,
    "extent": extent.cases,
    "fft": fft.cases,
    "fft_arbitrary": fft_arbitrary.cases,
    "filter_analysis": filter_analysis.cases,
    "fir": fir.cases,
    "fourier_series": fourier_series.cases,
    "generators": generators.cases,
    "iir": iir.cases,
    "metrics": metrics.cases,
    "quantize": quantize.cases,
    "resample": resample.cases,
    "rle": rle.cases,
    "rfft": rfft.cases,
    "stft": stft.cases,
    "windows": windows.cases,
}

__all__ = ["GENERATORS"]
