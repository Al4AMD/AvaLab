"""Golden cases for ITU-R BS.1770 integrated loudness (F18).

The NumPy reference pins the same arithmetic as
``packages/dsp/src/metrics/loudness.ts``:

    K-weighting = high-shelf biquad followed by the RLB high-pass biquad
    block       = 400 ms, hop = 100 ms (75% overlap)
    L_j         = -0.691 + 10 log10(mean(square(block_j)))
    absolute    = keep blocks with L_j > -70 LUFS
    relative    = keep absolute-gated blocks with L_j > (-0.691 + 10 log10(
                  mean(mean_square of absolute-gated blocks))) - 10
    integrated  = -0.691 + 10 log10(mean(mean_square of kept blocks))

Blocks are emitted in start order and only complete blocks are counted.
``absolute_gated`` means the block passed the absolute gate;
``relative_gated`` means it passed both gates. Silence has no kept block and
therefore an integrated loudness of -infinity; its expected fixture records
only the finite block count because JSON has no infinity.

The coefficients for 48 kHz are the exact BS.1770 values. Other rates are
derived from the analog prototypes with the bilinear transform (libebur128
parameters, ITU-R BS.1770-4), never interpolated.
"""

from __future__ import annotations

import math

import numpy as np

from avalab_golden.fixtures import GoldenCase

LOUDNESS_RTOL = 1e-6
BLOCK_SECONDS = 0.4
HOP_SECONDS = 0.1
ABSOLUTE_GATE_LUFS = -70.0
RELATIVE_GATE_LU = 10.0
OFFSET_DB = -0.691

SHELF_48K = {
    "b": [1.53512485958697, -2.69169618940638, 1.19839281085285],
    "a": [1.0, -1.69065929318241, 0.73248077421585],
}
HIGHPASS_48K = {
    "b": [1.0, -2.0, 1.0],
    "a": [1.0, -1.99004745483398, 0.99007225036621],
}


def k_weighting_coefficients(sample_rate_hz: int) -> dict[str, dict[str, list[float]]]:
    """Return the two cascaded K-weighting biquads for *sample_rate_hz*."""
    if not math.isfinite(float(sample_rate_hz)) or sample_rate_hz <= 0 or sample_rate_hz > 96_000:
        raise ValueError(f"sampleRateHz must be finite in (0, 96000], got {sample_rate_hz}")
    if sample_rate_hz == 48_000:
        return {
            "shelf": {"b": list(SHELF_48K["b"]), "a": list(SHELF_48K["a"])},
            "highpass": {"b": list(HIGHPASS_48K["b"]), "a": list(HIGHPASS_48K["a"])},
        }

    # High-shelf prototype (ITU-R BS.1770-4 / libebur128 constants).
    f0 = 1681.974450955533
    gain_db = 3.999843853973347
    q = 0.7071752369554196
    k = math.tan(math.pi * f0 / sample_rate_hz)
    vh = 10.0 ** (gain_db / 20.0)
    vb = vh**0.4996667741545416
    a0 = 1.0 + k / q + k * k
    shelf = {
        "b": [
            (vh + vb * k / q + k * k) / a0,
            2.0 * (k * k - vh) / a0,
            (vh - vb * k / q + k * k) / a0,
        ],
        "a": [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0],
    }

    # RLB high-pass prototype.
    f0 = 38.13547087602444
    q = 0.5003270373238773
    k = math.tan(math.pi * f0 / sample_rate_hz)
    a0 = 1.0 + k / q + k * k
    highpass = {
        "b": [1.0, -2.0, 1.0],
        "a": [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0],
    }
    return {"shelf": shelf, "highpass": highpass}


def _biquad(samples: np.ndarray, b: list[float], a: list[float]) -> np.ndarray:
    """Transposed direct-form II biquad with zero initial state, float64."""
    output = np.empty_like(samples, dtype=np.float64)
    z1 = 0.0
    z2 = 0.0
    b0, b1, b2 = b
    _, a1, a2 = a
    for index, x in enumerate(samples):
        y = b0 * x + z1
        z1 = b1 * x - a1 * y + z2
        z2 = b2 * x - a2 * y
        output[index] = y
    return output


def measure_loudness(samples: np.ndarray, sample_rate_hz: int) -> dict[str, object]:
    """Return the integrated loudness and block statistics."""
    if samples.ndim != 1:
        raise ValueError("samples must be one-dimensional")
    if samples.size == 0:
        raise ValueError("samples must not be empty")
    if not np.all(np.isfinite(samples)):
        raise ValueError("samples must be finite")

    coefficients = k_weighting_coefficients(sample_rate_hz)
    weighted = _biquad(
        _biquad(np.asarray(samples, dtype=np.float64), coefficients["shelf"]["b"], coefficients["shelf"]["a"]),
        coefficients["highpass"]["b"],
        coefficients["highpass"]["a"],
    )

    block_length = int(round(BLOCK_SECONDS * sample_rate_hz))
    hop = int(round(HOP_SECONDS * sample_rate_hz))
    starts = list(range(0, weighted.size - block_length + 1, hop)) if weighted.size >= block_length else []

    mean_squares = np.array(
        [float(np.mean(weighted[start : start + block_length] ** 2)) for start in starts],
        dtype=np.float64,
    )
    loudness = np.array(
        [OFFSET_DB + 10.0 * math.log10(value) if value > 0.0 else -math.inf for value in mean_squares],
        dtype=np.float64,
    )
    absolute = loudness > ABSOLUTE_GATE_LUFS
    if np.any(absolute):
        ungated_mean = float(np.mean(mean_squares[absolute]))
        relative_threshold = OFFSET_DB + 10.0 * math.log10(ungated_mean) - RELATIVE_GATE_LU
        relative = absolute & (loudness > relative_threshold)
        integrated = (
            OFFSET_DB + 10.0 * math.log10(float(np.mean(mean_squares[relative])))
            if np.any(relative)
            else -math.inf
        )
    else:
        relative = np.zeros_like(absolute, dtype=bool)
        integrated = -math.inf

    blocks: list[dict[str, object]] = []
    for index, start in enumerate(starts):
        blocks.append(
            {
                "startSample": int(start),
                "durationSeconds": BLOCK_SECONDS,
                "loudnessLufs": float(loudness[index]),
                "absoluteGated": bool(absolute[index]),
                "relativeGated": bool(relative[index]),
            }
        )
    return {
        "integratedLufs": float(integrated),
        "blocks": blocks,
        "blockDurationSeconds": BLOCK_SECONDS,
        "blockHopSeconds": HOP_SECONDS,
    }


def _sine(sample_rate_hz: int, amplitude: float, duration_seconds: float, phase: float = 0.0) -> np.ndarray:
    n = np.arange(int(round(sample_rate_hz * duration_seconds)), dtype=np.float64)
    return amplitude * np.sin(2.0 * np.pi * 1000.0 * n / sample_rate_hz + phase)


def _case(name: str, samples: np.ndarray, sample_rate_hz: int) -> GoldenCase:
    result = measure_loudness(samples, sample_rate_hz)
    integrated = float(result["integratedLufs"])
    blocks = [
        {
            **block,
            "loudnessLufs": block["loudnessLufs"]
            if math.isfinite(float(block["loudnessLufs"]))
            else None,
        }
        for block in result["blocks"]
    ]
    expected: dict[str, object] = {
        "integratedLufs": integrated if math.isfinite(integrated) else None,
        "blocks": blocks,
        "blockCount": len(result["blocks"]),
        "blockDurationSeconds": result["blockDurationSeconds"],
        "blockHopSeconds": result["blockHopSeconds"],
    }
    return GoldenCase(
        name=name,
        samples=samples.tolist(),
        sample_rate_hz=sample_rate_hz,
        params={"operation": "measureLoudness"},
        expected=expected,
        rtol=LOUDNESS_RTOL,
        atol=LOUDNESS_RTOL,
    )


def cases() -> list[GoldenCase]:
    """Return the loudness fixture case set in stable order.

    The -20 dBFS tones use an RMS amplitude of 0.1 (peak sqrt(2)/10), so the
    BS.1770 integrated target is -20 LUFS rather than the -23 LUFS a -20 dBFS
    peak sine produces.
    """
    silence_48k = np.zeros(28_800, dtype=np.float64)
    loud = _sine(48_000, 0.5, 0.4)
    quiet = _sine(48_000, 0.5 * 10.0 ** (-15.0 / 20.0), 0.5)
    two_level = np.concatenate([loud, quiet])

    return [
        _case("loudness_sine_1k_minus20_48k", _sine(48_000, np.sqrt(2.0) * 0.1, 0.6), 48_000),
        _case("loudness_sine_1k_minus20_44k1", _sine(44_100, np.sqrt(2.0) * 0.1, 0.6), 44_100),
        _case("loudness_sine_1k_minus20_96k", _sine(96_000, np.sqrt(2.0) * 0.1, 0.6), 96_000),
        _case("loudness_silence_48k", silence_48k, 48_000),
        _case("loudness_two_level_48k", two_level, 48_000),
    ]
