"""Registry of golden-vector generators, keyed by algorithm name."""

from __future__ import annotations

from collections.abc import Callable

from avalab_golden.algorithms import dft, energy, fft, fft_arbitrary, rfft, stft, windows
from avalab_golden.fixtures import GoldenCase

GENERATORS: dict[str, Callable[[], list[GoldenCase]]] = {
    "dft": dft.cases,
    "energy": energy.cases,
    "fft": fft.cases,
    "fft_arbitrary": fft_arbitrary.cases,
    "rfft": rfft.cases,
    "stft": stft.cases,
    "windows": windows.cases,
}

__all__ = ["GENERATORS"]
