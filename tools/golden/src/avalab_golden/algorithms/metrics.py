"""Golden cases for the F05 quality metrics.

The NumPy references pin the same definitions as
``packages/dsp/src/metrics/basic.ts`` and ``entropy.ts``:

    mse              mean((reference - test)^2)
    snrDb            10*log10(sum(reference^2) / sum(error^2))
    segmentalSnrDb   arithmetic mean over frames with nonzero reference
                     energy of 10*log10(frame ref energy / frame error
                     energy); the partial last frame is included
    psnrDb           10*log10(peak^2 / mse); peak is explicit (1.0 here)
    entropy          -sum(p*log2(p)) over the empirical histogram

All cases use rtol = 1e-9 and the fixture schema's default atol = 1e-12.
The test signal for the MSE/SNR/PSNR cases is a pinned 3-bit quantized sine;
the residual is nonzero, so no case depends on IEEE 0/0 or x/0 behavior.
"""

from __future__ import annotations

import numpy as np

from avalab_golden.fixtures import GoldenCase

METRICS_RTOL = 1e-9


def _mse(reference: np.ndarray, test: np.ndarray) -> float:
    return float(np.mean((reference - test) ** 2))


def _snr_db(reference: np.ndarray, test: np.ndarray) -> float:
    reference_energy = float(np.sum(reference**2))
    error_energy = float(np.sum((reference - test) ** 2))
    return float(10.0 * np.log10(reference_energy / error_energy))


def _segmental_snr_db(reference: np.ndarray, test: np.ndarray, frame_length: int) -> float:
    frame_snrs: list[float] = []
    for start in range(0, reference.size, frame_length):
        end = min(start + frame_length, reference.size)
        frame_reference = reference[start:end]
        frame_error = reference[start:end] - test[start:end]
        reference_energy = float(np.sum(frame_reference**2))
        if reference_energy == 0.0:
            continue
        error_energy = float(np.sum(frame_error**2))
        frame_snrs.append(float(10.0 * np.log10(reference_energy / error_energy)))
    if not frame_snrs:
        return float("inf")
    return float(np.mean(frame_snrs))


def _entropy(symbols: np.ndarray) -> float:
    if symbols.size == 0:
        return 0.0
    counts = np.unique(symbols, return_counts=True)[1]
    probabilities = counts / symbols.size
    return float(-np.sum(probabilities * np.log2(probabilities)))


def _case(
    name: str,
    reference: np.ndarray,
    params: dict[str, object],
    expected: dict[str, object],
    sample_rate_hz: int | None = None,
) -> GoldenCase:
    return GoldenCase(
        name=name,
        samples=reference.tolist(),
        sample_rate_hz=sample_rate_hz,
        params=params,
        expected=expected,
        rtol=METRICS_RTOL,
    )


def _sine_and_quantized_sine() -> tuple[np.ndarray, np.ndarray]:
    sample_rate_hz = 8000
    duration_seconds = 0.05
    sample_count = int(sample_rate_hz * duration_seconds)
    n = np.arange(sample_count, dtype=np.float64)
    reference = 0.9 * np.sin(2.0 * np.pi * 440.0 * n / sample_rate_hz)
    test = np.round(reference * 8.0) / 8.0
    return reference, test


def _segmental_pair() -> tuple[np.ndarray, np.ndarray]:
    # Four frames of length 4. Frame 1 is pure reference silence but has huge
    # test values: it must be skipped. The last frame has only 2 samples and
    # must still be included (R8).
    reference = np.array(
        [1.0, 2.0, 3.0, 4.0, 0.0, 0.0, 0.0, 0.0, 1.0, -1.0, 1.0, -1.0, 2.0, 2.0],
        dtype=np.float64,
    )
    test = np.array(
        [1.1, 1.9, 3.05, 4.0, 99.0, 99.0, 99.0, 99.0, 1.01, -1.02, 1.03, -1.04, 2.1, 2.2],
        dtype=np.float64,
    )
    return reference, test


def cases() -> list[GoldenCase]:
    """Return the metrics fixture case set in stable order."""
    reference, quantized = _sine_and_quantized_sine()
    segmental_reference, segmental_test = _segmental_pair()
    skewed_symbols = np.array([0] * 8 + [1] * 3 + [2] * 2 + [3], dtype=np.int64)

    return [
        _case(
            "mse_sine_vs_quantized_sine",
            reference,
            {"testSamples": quantized.tolist()},
            {"mse": _mse(reference, quantized)},
            sample_rate_hz=8000,
        ),
        _case(
            "snr_sine_vs_quantized_sine",
            reference,
            {"testSamples": quantized.tolist()},
            {"snrDb": _snr_db(reference, quantized)},
            sample_rate_hz=8000,
        ),
        _case(
            "psnr_sine_vs_quantized_sine_peak1",
            reference,
            {"testSamples": quantized.tolist(), "peak": 1.0},
            {"psnrDb": 10.0 * np.log10(1.0**2 / _mse(reference, quantized))},
            sample_rate_hz=8000,
        ),
        _case(
            "segmental_snr_silent_frame_partial_tail",
            segmental_reference,
            {"testSamples": segmental_test.tolist(), "frameLengthSamples": 4},
            {"segmentalSnrDb": _segmental_snr_db(segmental_reference, segmental_test, 4)},
        ),
        _case(
            "entropy_skewed_histogram",
            skewed_symbols,
            {},
            {"entropyBitsPerSymbol": _entropy(skewed_symbols)},
        ),
    ]
