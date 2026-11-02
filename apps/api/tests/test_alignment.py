"""Delay estimation: lag sign, trimming, silence, bounds and input guards."""

import numpy as np
import pytest

from avalab_api.alignment import Alignment, align_pair, estimate_alignment

RATE = 8000


def base_signal(length: int = 1000) -> np.ndarray:
    rng = np.random.default_rng(42)
    return rng.standard_normal(length)


def test_positive_lag_means_test_is_delayed() -> None:
    reference = base_signal()
    test = np.concatenate([np.zeros(37), reference])

    alignment = estimate_alignment(reference, test, sample_rate_hz=RATE)

    assert alignment == Alignment(
        lag_samples=37,
        reference_start_sample=0,
        test_start_sample=37,
        aligned_sample_count=1000,
    )
    reference_aligned, test_aligned = align_pair(reference, test, alignment)
    assert np.array_equal(reference_aligned, test_aligned)
    assert len(reference_aligned) == 1000


def test_negative_lag_means_reference_is_delayed() -> None:
    test = base_signal()
    reference = np.concatenate([np.zeros(37), test])

    alignment = estimate_alignment(reference, test, sample_rate_hz=RATE)

    assert alignment == Alignment(
        lag_samples=-37,
        reference_start_sample=37,
        test_start_sample=0,
        aligned_sample_count=1000,
    )
    reference_aligned, test_aligned = align_pair(reference, test, alignment)
    assert np.array_equal(reference_aligned, test_aligned)


def test_noise_plus_delay_is_exact() -> None:
    rng = np.random.default_rng(7)
    reference = rng.standard_normal(2000)
    test = np.concatenate([np.zeros(123), reference, np.zeros(50)])

    alignment = estimate_alignment(reference, test, sample_rate_hz=RATE)

    assert alignment.lag_samples == 123
    assert alignment.aligned_sample_count == 2000


def test_both_silent_returns_zero_lag() -> None:
    reference = np.zeros(100)
    test = np.zeros(80)

    alignment = estimate_alignment(reference, test, sample_rate_hz=RATE)

    assert alignment == Alignment(
        lag_samples=0,
        reference_start_sample=0,
        test_start_sample=0,
        aligned_sample_count=80,
    )


def test_unequal_lengths_trim_to_overlap() -> None:
    reference = base_signal(1000)
    test = reference[:800]

    alignment = estimate_alignment(reference, test, sample_rate_hz=RATE)

    assert alignment.lag_samples == 0
    assert alignment.aligned_sample_count == 800


def test_delay_beyond_search_window_is_not_reported() -> None:
    reference = base_signal(2000)
    test = np.concatenate([np.zeros(500), reference])

    alignment = estimate_alignment(
        reference, test, sample_rate_hz=RATE, max_lag_samples=37
    )

    # The true +500 lag is outside the search window. The best in-window score
    # may be a side peak, but the result never claims the out-of-window delay.
    assert abs(alignment.lag_samples) <= 37
    assert alignment.lag_samples != 500
    assert alignment.aligned_sample_count == min(
        reference.size - alignment.reference_start_sample,
        test.size - alignment.test_start_sample,
    )


@pytest.mark.parametrize(
    "reference,test",
    [
        (np.array([]), np.ones(3)),
        (np.ones(3), np.array([])),
        (np.array([np.nan, 0.0]), np.ones(2)),
        (np.ones(2), np.array([np.inf, 0.0])),
        (np.ones((2, 2)), np.ones(4)),
    ],
)
def test_invalid_inputs_raise_value_error(reference: np.ndarray, test: np.ndarray) -> None:
    with pytest.raises(ValueError):
        estimate_alignment(reference, test, sample_rate_hz=RATE)


def test_align_pair_does_not_mutate_inputs() -> None:
    reference = base_signal()
    test = np.concatenate([np.zeros(5), reference])
    test_copy = test.copy()
    alignment = estimate_alignment(reference, test, sample_rate_hz=RATE)

    align_pair(reference, test, alignment)

    assert np.array_equal(test, test_copy)
    assert np.array_equal(reference, base_signal())
