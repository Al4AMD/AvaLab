"""Golden cases for the F07 signal-extent operations.

The NumPy reference implementations pin the same definitions as
``packages/dsp/src/signals/extent.ts``:

    timeShift   y[n] = x[n - s] if 0 <= n - s < N, else 0
    timeScale   L = floor(N/a + 0.5); y[k] = linear interpolation of x at
                position k*a, clamped to x[N-1] past the last sample
    reverse     y[n] = x[N-1-n]
    truncate    y = x[start : min(N, start + length)] (no zero-fill)
    zeroPad     y = zeros(padStart) ++ x ++ zeros(padEnd)
    support     first/last n with abs(x[n]) > threshold; empty ->
                {startSampleIndex: N, endSampleIndex: N-1}

The round-half-up helper is explicit because Python's built-in round uses
banker's rounding, while the TypeScript implementation uses Math.round (ties
toward +infinity). It uses floor plus a fractional comparison, NOT
``floor(value + 0.5)``: adding 0.5 can round a value within 1 ulp below a
half-integer up to the tie. This mirrors ``quantize.py``. All cases use exact
binary values, so rtol = 1e-12 (atol = 0) is expected to hold to machine
precision.
"""

from __future__ import annotations

import numpy as np

from avalab_golden.fixtures import GoldenCase

EXTENT_RTOL = 1e-12
EXTENT_ATOL = 0.0


def _round_half_up(value: float) -> int:
    floored = float(np.floor(value))
    # Exact half-up (ties toward +infinity), matching ECMAScript Math.round.
    return int(floored + 1.0 if value - floored >= 0.5 else floored)


def _ramp(sample_count: int = 10) -> np.ndarray:
    return np.arange(sample_count, dtype=np.float64)


def _time_shift(samples: np.ndarray, shift_samples: int) -> np.ndarray:
    output = np.zeros(samples.size, dtype=np.float64)
    for n in range(samples.size):
        source_index = n - shift_samples
        if 0 <= source_index < samples.size:
            output[n] = samples[source_index]
    return output


def _time_scale(samples: np.ndarray, factor: float) -> np.ndarray:
    output_length = _round_half_up(samples.size / factor)
    output = np.zeros(output_length, dtype=np.float64)
    if samples.size == 0:
        return output
    for k in range(output_length):
        position = k * factor
        if position >= samples.size - 1:
            output[k] = samples[-1]
            continue
        lower_index = int(np.floor(position))
        fraction = position - lower_index
        output[k] = (1.0 - fraction) * samples[lower_index] + fraction * samples[lower_index + 1]
    return output


def _support(samples: np.ndarray, threshold: float) -> dict[str, int]:
    indices = np.flatnonzero(np.abs(samples) > threshold)
    if indices.size == 0:
        return {"startSampleIndex": int(samples.size), "endSampleIndex": int(samples.size) - 1}
    return {"startSampleIndex": int(indices[0]), "endSampleIndex": int(indices[-1])}


def _case(
    name: str,
    samples: np.ndarray,
    params: dict[str, object],
    expected: dict[str, object],
) -> GoldenCase:
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=None,
        params=params,
        expected=expected,
        rtol=EXTENT_RTOL,
        atol=EXTENT_ATOL,
    )


def _samples_case(
    name: str,
    samples: np.ndarray,
    params: dict[str, object],
    output: np.ndarray,
) -> GoldenCase:
    return _case(name, samples, params, {"samples": output.tolist()})


def cases() -> list[GoldenCase]:
    """Return the extent fixture case set in stable order."""
    ramp = _ramp()
    support_samples = np.array([0.0, 0.0, 1.0, -2.0, 0.0, 3.0, 0.0, 0.0, 0.0, 0.0])
    threshold_samples = np.array([0.0, 0.5, 0.75, -0.5, 0.25])
    silence = np.zeros(10, dtype=np.float64)

    return [
        _samples_case(
            "time_shift_plus3_ramp10",
            ramp,
            {"operation": "timeShift", "shiftSamples": 3},
            _time_shift(ramp, 3),
        ),
        _samples_case(
            "time_shift_minus3_ramp10",
            ramp,
            {"operation": "timeShift", "shiftSamples": -3},
            _time_shift(ramp, -3),
        ),
        _samples_case(
            "time_scale_half_ramp10",
            ramp,
            {"operation": "timeScale", "factor": 0.5},
            _time_scale(ramp, 0.5),
        ),
        _samples_case(
            "time_scale_double_ramp10",
            ramp,
            {"operation": "timeScale", "factor": 2.0},
            _time_scale(ramp, 2.0),
        ),
        _samples_case(
            "time_scale_half_up_ramp5",
            np.array([1.0, 2.0, 3.0, 4.0, 5.0]),
            {"operation": "timeScale", "factor": 2.0},
            _time_scale(np.array([1.0, 2.0, 3.0, 4.0, 5.0]), 2.0),
        ),
        _samples_case(
            "time_scale_half_up_single_sample",
            np.array([7.0]),
            {"operation": "timeScale", "factor": 2.0},
            _time_scale(np.array([7.0]), 2.0),
        ),
        _samples_case(
            "reverse_ramp10",
            ramp,
            {"operation": "reverse"},
            ramp[::-1],
        ),
        _samples_case(
            "truncate_ramp10_start2_length5",
            ramp,
            {"operation": "truncate", "startSampleIndex": 2, "lengthSamples": 5},
            ramp[2:7],
        ),
        _samples_case(
            "truncate_ramp10_start8_length5_clamped",
            ramp,
            {"operation": "truncate", "startSampleIndex": 8, "lengthSamples": 5},
            ramp[8:10],
        ),
        _samples_case(
            "zero_pad_ramp10_start2_end3",
            ramp,
            {"operation": "zeroPad", "padStartSamples": 2, "padEndSamples": 3},
            np.concatenate(
                [np.zeros(2, dtype=np.float64), ramp, np.zeros(3, dtype=np.float64)]
            ),
        ),
        _case(
            "support_nonzero_threshold0",
            support_samples,
            {"operation": "support", "threshold": 0.0},
            _support(support_samples, 0.0),
        ),
        _case(
            "support_silence_threshold0",
            silence,
            {"operation": "support", "threshold": 0.0},
            _support(silence, 0.0),
        ),
        _case(
            "support_threshold_strict_0.5",
            threshold_samples,
            {"operation": "support", "threshold": 0.5},
            _support(threshold_samples, 0.5),
        ),
    ]
