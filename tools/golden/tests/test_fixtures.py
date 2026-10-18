"""Tests for the golden-vector fixture writer and CLI.

The fixture JSON is a cross-language contract (Python generator here,
TypeScript DSP tests in ``packages/dsp``), so these tests pin the schema
keys, the deterministic byte output, and the CLI flags.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from avalab_golden import __main__ as cli
from avalab_golden.algorithms.energy import cases as energy_cases
from avalab_golden.fixtures import GoldenCase, write_golden_file

REPO_ROOT = Path(__file__).resolve().parents[3]


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "avalab_golden", *args],
        capture_output=True,
        text=True,
        check=True,
    )


def test_write_round_trip_schema(tmp_path: Path) -> None:
    path = write_golden_file("energy", energy_cases(), tmp_path)
    assert path == tmp_path / "energy.json"
    data = _read_json(path)
    assert set(data) == {"algorithm", "cases"}
    assert data["algorithm"] == "energy"
    cases = data["cases"]
    assert isinstance(cases, list)
    assert len(cases) == 4
    for case in cases:
        assert isinstance(case, dict)
        assert set(case) == {"name", "input", "params", "expected", "tolerance"}
        assert set(case["input"]) == {"samples", "sample_rate_hz"}
        assert set(case["tolerance"]) == {"rtol", "atol"}
        assert case["tolerance"] == {"rtol": 1e-9, "atol": 1e-12}
        assert case["params"] == {}


def test_energy_case_values(tmp_path: Path) -> None:
    data = _read_json(write_golden_file("energy", energy_cases(), tmp_path))
    cases = {case["name"]: case for case in data["cases"]}
    assert set(cases) == {
        "sine_440hz_1s_48000",
        "silence_1000",
        "impulse_1_sample",
        "constant_half_64",
    }

    sine = cases["sine_440hz_1s_48000"]
    assert sine["input"]["sample_rate_hz"] == 48000
    assert len(sine["input"]["samples"]) == 48000
    assert sine["expected"]["energy"] == pytest.approx(24000.0, rel=1e-9)

    silence = cases["silence_1000"]
    assert silence["input"]["sample_rate_hz"] is None
    assert silence["input"]["samples"] == [0.0] * 1000
    assert silence["expected"]["energy"] == 0.0

    impulse = cases["impulse_1_sample"]
    assert impulse["input"]["samples"] == [1.0]
    assert impulse["expected"]["energy"] == 1.0

    constant = cases["constant_half_64"]
    assert constant["input"]["samples"] == [0.5] * 64
    assert constant["expected"]["energy"] == 16.0


def test_write_twice_is_byte_identical(tmp_path: Path) -> None:
    first = write_golden_file("energy", energy_cases(), tmp_path / "a")
    second = write_golden_file("energy", energy_cases(), tmp_path / "b")
    assert first.read_bytes() == second.read_bytes()


def test_cli_generate_twice_is_byte_identical(tmp_path: Path) -> None:
    out_dir = tmp_path / "golden"
    _run_cli("generate", "--only", "energy", "--out", str(out_dir))
    first = (out_dir / "energy.json").read_bytes()
    _run_cli("generate", "--only", "energy", "--out", str(out_dir))
    assert (out_dir / "energy.json").read_bytes() == first


def test_cli_rejects_unknown_algorithm(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "avalab_golden",
            "generate",
            "--only",
            "nope",
            "--out",
            str(tmp_path),
        ],
        capture_output=True,
        check=False,
        text=True,
    )
    assert result.returncode != 0
    assert "nope" in result.stderr


def test_rejects_empty_case_list(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        write_golden_file("energy", [], tmp_path)


def test_serialization_is_sorted_newline_terminated_and_utf8(tmp_path: Path) -> None:
    case = GoldenCase(
        name="unicode_β_wave",
        samples=[0.5],
        sample_rate_hz=None,
        expected={"energy": 0.25},
    )
    raw = write_golden_file("shape", [case], tmp_path).read_bytes()
    assert raw.endswith(b"\n")
    text = raw.decode("utf-8")
    assert "unicode_β_wave" in text
    assert text.index('"algorithm"') < text.index('"cases"')


def test_find_repo_root() -> None:
    root = cli.find_repo_root(Path(__file__))
    assert (root / ".git").exists()
    assert (root / "package.json").exists()
    assert cli.DEFAULT_OUT_DIR == Path("packages/dsp/test-data/golden")
