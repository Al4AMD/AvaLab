"""Pins the F13 psychoacoustic reference and its deterministic fixture."""

from __future__ import annotations

import math

import numpy as np

from avalab_golden.algorithms import psychoacoustics


def test_band_edges_have_one_more_edge_than_band() -> None:
    for sample_rate_hz in (48_000, 8_000):
        edges = psychoacoustics.band_edges_hz(sample_rate_hz)
        assert edges.shape == (psychoacoustics.BAND_COUNT + 1,)
        assert edges[0] == 0.0
        assert edges[-1] == sample_rate_hz / 2
        assert np.all(np.diff(edges) >= 0.0)


def test_ath_falls_then_rises_above_10_khz() -> None:
    frequencies = [20.0, 100.0, 1000.0, 4000.0]
    thresholds = [psychoacoustics.ath_db(frequency) for frequency in frequencies]
    assert all(thresholds[index + 1] < thresholds[index] for index in range(len(thresholds) - 1))
    assert psychoacoustics.ath_db(20_000.0) > psychoacoustics.ath_db(4_000.0)


def test_spreading_is_symmetric_and_finite() -> None:
    for delta in (0.0, 0.5, 2.5, 10.0):
        assert psychoacoustics.spreading_db(delta) == psychoacoustics.spreading_db(-delta)
        assert math.isfinite(psychoacoustics.spreading_db(delta))


def test_band_levels_and_thresholds_are_consistent() -> None:
    frame_length = 512
    coefficients = np.linspace(-1.0, 1.0, frame_length // 2)
    measured_reference_power = psychoacoustics.reference_power(48_000, frame_length)
    levels, counts, centers_hz = psychoacoustics.band_levels(
        coefficients,
        48_000,
        frame_length,
        psychoacoustics.REFERENCE_SPL_DB,
        measured_reference_power,
    )
    edges = psychoacoustics.band_edges_hz(48_000)
    ath, thresholds, smr = psychoacoustics.masking_threshold(levels, centers_hz, edges)
    assert counts.sum() == coefficients.shape[0]
    assert np.all(np.isfinite(ath))
    assert np.all(np.isfinite(thresholds))
    assert np.all(thresholds >= ath)
    np.testing.assert_allclose(smr, levels - thresholds)


def test_fixture_is_deterministic() -> None:
    first = [case.to_json_dict() for case in psychoacoustics.cases()]
    second = [case.to_json_dict() for case in psychoacoustics.cases()]
    assert first == second
