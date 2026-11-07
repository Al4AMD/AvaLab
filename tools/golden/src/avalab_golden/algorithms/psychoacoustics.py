"""Golden cases for the F13 psychoacoustic teaching model.

Pinned formulas (matches ``packages/dsp/src/psychoacoustics``)::

    z(f) = 13 atan(0.00076 f) + 3.5 atan((f / 7500)^2)          [Bark]
    Tq(f) = 3.64 (f/1000)^-0.8
            - 6.5 exp(-0.6 (f/1000 - 3.3)^2)
            + 1e-3 (f/1000)^4                                   [dB SPL, f >= 20]
    S(dz) = 15.81 + 7.5 (|dz| + 0.474)
            - 17.5 sqrt(1 + (|dz| + 0.474)^2)                    [dB]

The raw Schroeder expression is asymmetric in ``dz``; the plan's symmetry pin
and the finite low-frequency floor require the absolute Bark distance.  Bands
are 25 equal Bark intervals ``z = 0..25`` converted to Hz and clamped to
Nyquist.  A band level is

    L_i = refSplDb + 10 log10(sum_{k in band i} C_k^2 / P_ref)

with ``P_ref`` measured through the same MDCT frame/window from one second of
a 1 kHz full-scale sine.  The masking threshold is

    T_i = max(ATH_i, 10 log10(sum_j 10^((L_j + S(z_i - z_j)) / 10)))

and ``SMR_i = L_i - T_i``.  Empty bands keep the ATH of their geometric
center and contribute no masker energy.

This is a stationary, per-frame teaching approximation: no temporal masking,
no tonal/noise separation, no transform-gain correction.  It is not an
MP3/AAC compliance implementation.

References: Zwicker & Terhardt, "Analytical expressions for critical-band
rate and its implementation", JASA 68(5), 1980; Terhardt, "Calculating
virtual pitch", Hearing Research 1, 1979 (ATH); Schroeder, "Models of Hearing",
Proc. IEEE 63(9), 1975 (spreading).
"""

from __future__ import annotations

import math

import numpy as np

from avalab_golden.algorithms import mdct as mdct_reference
from avalab_golden.fixtures import GoldenCase

SAMPLE_RATE_HZ = 48_000
FRAME_LENGTH_SAMPLES = 512
REFERENCE_SPL_DB = 94.0
BAND_COUNT = 25
LOWEST_FREQUENCY_HZ = 20.0


def hz_to_bark(frequency_hz: float) -> float:
    """Zwicker-Terhardt critical-band rate for a non-negative frequency."""
    return 13.0 * math.atan(0.00076 * frequency_hz) + 3.5 * math.atan(
        (frequency_hz / 7500.0) ** 2
    )


def bark_to_hz(bark: float, sample_rate_hz: float) -> float:
    """Invert ``hz_to_bark`` by deterministic bisection, clamped to Nyquist."""
    nyquist_hz = 0.5 * sample_rate_hz
    clamped = min(25.0, max(0.0, bark))
    if clamped <= 0.0:
        return 0.0
    if hz_to_bark(nyquist_hz) <= clamped:
        return nyquist_hz
    low = 0.0
    high = nyquist_hz
    for _ in range(80):
        middle = 0.5 * (low + high)
        if hz_to_bark(middle) < clamped:
            low = middle
        else:
            high = middle
    return 0.5 * (low + high)


def ath_db(frequency_hz: float) -> float:
    """Terhardt absolute threshold of hearing in dB SPL (f clamped to >= 20 Hz)."""
    kilo = max(LOWEST_FREQUENCY_HZ, frequency_hz) / 1000.0
    return 3.64 * kilo**-0.8 - 6.5 * math.exp(-0.6 * (kilo - 3.3) ** 2) + 1e-3 * kilo**4


def spreading_db(delta_bark: np.ndarray | float) -> np.ndarray | float:
    """Symmetric Schroeder spreading value in dB for a Bark distance."""
    distance = np.abs(np.asarray(delta_bark, dtype=np.float64))
    value = 15.81 + 7.5 * (distance + 0.474) - 17.5 * np.sqrt(1.0 + (distance + 0.474) ** 2)
    if np.isscalar(delta_bark):
        return float(value)
    return value


def band_edges_hz(sample_rate_hz: float) -> np.ndarray:
    """Return 26 Bark-band edges in Hz for 25 bands, clamped to Nyquist."""
    return np.array(
        [bark_to_hz(index, sample_rate_hz) for index in range(BAND_COUNT + 1)],
        dtype=np.float64,
    )


def _band_index(frequency_hz: float, edges_hz: np.ndarray) -> int:
    for index in range(edges_hz.shape[0] - 1):
        if frequency_hz < edges_hz[index + 1]:
            return index
    return edges_hz.shape[0] - 2


def band_bin_counts(sample_rate_hz: float, bin_count: int, edges_hz: np.ndarray) -> np.ndarray:
    """Count MDCT bins whose centers fall in each band."""
    counts = np.zeros(edges_hz.shape[0] - 1, dtype=np.int64)
    for bin_index in range(bin_count):
        center_hz = (bin_index + 0.5) * sample_rate_hz / (2 * bin_count)
        counts[_band_index(center_hz, edges_hz)] += 1
    return counts


def reference_power(sample_rate_hz: float, frame_length_samples: int) -> float:
    """Measure P_ref through the same MDCT from one second of a 1 kHz sine."""
    sample_count = sample_rate_hz
    index = np.arange(sample_count, dtype=np.float64)
    sine = np.sin(2.0 * np.pi * 1000.0 * index / sample_rate_hz)
    hop = frame_length_samples // 2
    frame_count = -(-sample_count // hop) + 1
    window = mdct_reference._window(frame_length_samples)
    basis = mdct_reference._basis(frame_length_samples)
    frames = mdct_reference._windowed_frames(sine, window, hop, frame_count)
    coefficients = mdct_reference._direct_mdct(frames, basis)
    return float(np.mean(np.sum(coefficients**2, axis=1)) / hop)


def band_levels(
    coefficients: np.ndarray,
    sample_rate_hz: float,
    frame_length_samples: int,
    reference_spl_db: float,
    measured_reference_power: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return band levels, bin counts and band centers in Hz."""
    edges = band_edges_hz(sample_rate_hz)
    bin_count = coefficients.shape[0]
    centers_hz = np.array(
        [math.sqrt(edges[i] * edges[i + 1]) for i in range(BAND_COUNT)], dtype=np.float64
    )
    levels = np.full(BAND_COUNT, -np.inf, dtype=np.float64)
    counts = np.zeros(BAND_COUNT, dtype=np.int64)
    for bin_index in range(bin_count):
        center_hz = (bin_index + 0.5) * sample_rate_hz / (2 * bin_count)
        band = _band_index(center_hz, edges)
        coefficient = coefficients[bin_index]
        counts[band] += 1
        if coefficient != 0.0:
            if np.isneginf(levels[band]):
                levels[band] = 0.0
            levels[band] += coefficient * coefficient
    for band in range(BAND_COUNT):
        if counts[band] > 0:
            levels[band] = reference_spl_db + 10.0 * math.log10(
                levels[band] / measured_reference_power
            )
    return levels, counts, centers_hz


def masking_threshold(
    levels_db: np.ndarray,
    band_centers_hz: np.ndarray,
    edges_hz: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return ATH, masking thresholds and SMR for the band levels."""
    centers_bark = np.array([hz_to_bark(center) for center in band_centers_hz])
    ath = np.array([ath_db(center) for center in band_centers_hz])
    thresholds = np.full(BAND_COUNT, -np.inf, dtype=np.float64)
    for band in range(BAND_COUNT):
        masker_sum = 0.0
        for masker in range(BAND_COUNT):
            if np.isneginf(levels_db[masker]):
                continue
            masker_sum += 10.0 ** (
                (levels_db[masker] + spreading_db(centers_bark[band] - centers_bark[masker])) / 10.0
            )
        threshold = -np.inf if masker_sum == 0.0 else 10.0 * math.log10(masker_sum)
        thresholds[band] = max(ath[band], threshold)
    smr = levels_db - thresholds
    return ath, thresholds, smr


def _points_case(
    name: str,
    frequencies: list[float] | None = None,
    deltas: list[float] | None = None,
) -> GoldenCase:
    expected: dict[str, object] = {}
    params: dict[str, object] = {}
    if frequencies is not None:
        params["frequencies_hz"] = frequencies
        expected["ath_db"] = [ath_db(frequency) for frequency in frequencies]
    if deltas is not None:
        params["delta_bark"] = deltas
        expected["spreading_db"] = [float(spreading_db(delta)) for delta in deltas]
    return GoldenCase(
        name=name,
        samples=[],
        sample_rate_hz=None,
        params=params,
        expected=expected,
    )


def _edges_case(name: str, sample_rate_hz: int) -> GoldenCase:
    edges = band_edges_hz(sample_rate_hz)
    return GoldenCase(
        name=name,
        samples=[],
        sample_rate_hz=sample_rate_hz,
        params={"band_count": BAND_COUNT},
        expected={"edges_hz": edges.tolist()},
    )


def _band_levels_case() -> GoldenCase:
    frame_length = FRAME_LENGTH_SAMPLES
    hop = frame_length // 2
    coefficients = np.random.default_rng(2027).uniform(-1.0, 1.0, size=hop)
    measured_reference_power = reference_power(SAMPLE_RATE_HZ, frame_length)
    levels, counts, centers_hz = band_levels(
        coefficients,
        SAMPLE_RATE_HZ,
        frame_length,
        REFERENCE_SPL_DB,
        measured_reference_power,
    )
    edges = band_edges_hz(SAMPLE_RATE_HZ)
    ath, thresholds, smr = masking_threshold(levels, centers_hz, edges)
    return GoldenCase(
        name="band_levels_48k_frame512",
        samples=[],
        sample_rate_hz=SAMPLE_RATE_HZ,
        params={
            "frame_length_samples": frame_length,
            "band_count": BAND_COUNT,
            "reference_spl_db": REFERENCE_SPL_DB,
            "reference_power": measured_reference_power,
        },
        expected={
            "coefficients": coefficients.tolist(),
            "edges_hz": edges.tolist(),
            "band_centers_hz": centers_hz.tolist(),
            "bin_counts": counts.tolist(),
            "levels_db": levels.tolist(),
            "ath_db": ath.tolist(),
            "thresholds_db": thresholds.tolist(),
            "smr_db": smr.tolist(),
        },
    )


def cases() -> list[GoldenCase]:
    """Return the psychoacoustics fixture set in stable order."""
    return [
        _edges_case("bark_edges_48k", 48_000),
        _edges_case("bark_edges_8k", 8_000),
        _points_case(
            "ath_points",
            frequencies=[20.0, 100.0, 1000.0, 4000.0, 10000.0, 20000.0],
        ),
        _points_case(
            "spreading_points",
            deltas=[-10.0, -7.5, -5.0, -2.5, 0.0, 2.5, 5.0, 7.5, 10.0],
        ),
        _band_levels_case(),
    ]
