"""Registry of golden-vector generators, keyed by algorithm name."""

from __future__ import annotations

from collections.abc import Callable

from avalab_golden.algorithms import dft, energy
from avalab_golden.fixtures import GoldenCase

GENERATORS: dict[str, Callable[[], list[GoldenCase]]] = {
    "dft": dft.cases,
    "energy": energy.cases,
}

__all__ = ["GENERATORS"]
