"""Golden-vector fixture schema and deterministic JSON writer.

Purpose
-------
Define the on-disk contract between the Python reference generators
(``tools/golden``) and the TypeScript DSP tests (``packages/dsp/test``)
that consume these files as golden vectors.

Schema::

    {
      "algorithm": str,
      "cases": [
        {
          "name": str,
          "input": {"samples": list[float], "sample_rate_hz": int | None},
          "params": dict[str, object],
          "expected": dict[str, object],
          "tolerance": {"rtol": float, "atol": float}
        }
      ]
    }

Determinism
-----------
Files are written with sorted keys, ``ensure_ascii=False``, two-space
indentation and a trailing newline, using Python's shortest round-trip
float repr. Two runs therefore produce byte-identical files (pinned by
tests in ``tests/test_fixtures.py``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_TOLERANCE_RTOL = 1e-9
DEFAULT_TOLERANCE_ATOL = 1e-12


@dataclass(frozen=True)
class GoldenCase:
    """One algorithm input plus its reference output and comparison tolerance."""

    name: str
    samples: list[float]
    sample_rate_hz: int | None
    params: dict[str, object] = field(default_factory=dict)
    expected: dict[str, object] = field(default_factory=dict)
    rtol: float = DEFAULT_TOLERANCE_RTOL
    atol: float = DEFAULT_TOLERANCE_ATOL

    def to_json_dict(self) -> dict[str, object]:
        """Return the JSON-ready mapping for this case."""
        return {
            "name": self.name,
            "input": {"samples": self.samples, "sample_rate_hz": self.sample_rate_hz},
            "params": self.params,
            "expected": self.expected,
            "tolerance": {"rtol": self.rtol, "atol": self.atol},
        }


@dataclass(frozen=True)
class Fixture:
    """All golden cases for one algorithm."""

    algorithm: str
    cases: list[GoldenCase]

    def to_json_dict(self) -> dict[str, object]:
        """Return the JSON-ready mapping for this fixture file."""
        return {"algorithm": self.algorithm, "cases": [case.to_json_dict() for case in self.cases]}


def write_golden_file(algorithm: str, cases: list[GoldenCase], out_dir: Path) -> Path:
    """Write ``<out_dir>/<algorithm>.json`` deterministically and return its path.

    Raises ``ValueError`` for an empty algorithm name or an empty case list,
    so a mis-wired generator cannot ship a meaningless fixture.
    """
    if not algorithm.strip():
        raise ValueError("algorithm name must not be empty")
    if not cases:
        raise ValueError(f"algorithm {algorithm!r} has no cases; refusing to write an empty fixture")
    text = json.dumps(
        Fixture(algorithm=algorithm, cases=cases).to_json_dict(),
        ensure_ascii=False,
        sort_keys=True,
        indent=2,
    )
    out_path = Path(out_dir) / f"{algorithm}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text + "\n", encoding="utf-8")
    return out_path
