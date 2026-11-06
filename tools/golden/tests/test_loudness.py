"""Pins the F18 BS.1770 loudness reference and its deterministic fixture."""

from __future__ import annotations

import math

import numpy as np

from avalab_golden.algorithms import loudness


def test_48k_coefficients_are_exact() -> None:
    coefficients = loudness.k_weighting_coefficients(48_000)
    assert coefficients["shelf"]["b"] == loudness.SHELF_48K["b"]
    assert coefficients["highpass"]["a"] == loudness.HIGHPASS_48K["a"]


def test_other_rates_are_normalized_and_finite() -> None:
    for sample_rate_hz in (44_100, 8_000, 96_000):
        coefficients = loudness.k_weighting_coefficients(sample_rate_hz)
        for section in ("shelf", "highpass"):
            assert coefficients[section]["a"][0] == 1.0
            assert all(math.isfinite(value) for value in coefficients[section]["b"])
            assert all(math.isfinite(value) for value in coefficients[section]["a"])


def test_known_level_is_within_half_lu_of_minus_20() -> None:
    n = np.arange(48_000, dtype=np.float64)
    tone = np.sqrt(2.0) * 0.1 * np.sin(2.0 * np.pi * 1000.0 * n / 48_000)
    result = loudness.measure_loudness(tone, 48_000)
    assert abs(float(result["integratedLufs"]) - -20.0) <= 0.5


def test_silence_has_no_gated_blocks() -> None:
    result = loudness.measure_loudness(np.zeros(48_000, dtype=np.float64), 48_000)
    assert result["integratedLufs"] == -math.inf
    assert len(result["blocks"]) == 7
    assert not any(block["absoluteGated"] for block in result["blocks"])


def test_quiet_blocks_are_relative_gated() -> None:
    loud = _sine(0.5, 0.5)
    quiet = _sine(0.5 * 10.0 ** (-15.0 / 20.0), 0.5)
    result = loudness.measure_loudness(np.concatenate([loud, quiet]), 48_000)
    quiet_blocks = [block for block in result["blocks"] if block["startSample"] >= 24_000]
    assert quiet_blocks
    assert all(block["absoluteGated"] for block in quiet_blocks)
    assert not any(block["relativeGated"] for block in quiet_blocks)
    assert float(result["integratedLufs"]) > -20.0


def test_invalid_inputs_raise() -> None:
    for samples, sample_rate_hz in (
        (np.zeros(0), 48_000),
        (np.zeros(4), 0),
        (np.array([0.0, math.nan]), 48_000),
        (np.array([0.0, math.inf]), 48_000),
    ):
        try:
            loudness.measure_loudness(samples, sample_rate_hz)
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError")


def test_fixture_is_deterministic() -> None:
    first = [case.to_json_dict() for case in loudness.cases()]
    second = [case.to_json_dict() for case in loudness.cases()]
    assert first == second


def _sine(amplitude: float, duration_seconds: float) -> np.ndarray:
    n = np.arange(int(round(48_000 * duration_seconds)), dtype=np.float64)
    return amplitude * np.sin(2.0 * np.pi * 1000.0 * n / 48_000)
