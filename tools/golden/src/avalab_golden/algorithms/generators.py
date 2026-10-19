"""Golden cases for the closed-form signal generators (F12).

Every case uses the pinned grid T = 0.01 s, fs = 1000 Hz (N = 10 samples,
t_n = n/fs), so the stored arrays stay small and readable. The formulas are
the NumPy transcription of the TypeScript implementation:

    sine      x[n] = a * sin(2*pi*f*n/fs + phase)
    square    phase = frac(f*n/fs); x[n] = +a if phase <= duty else -a
    sawtooth  x[n] = a * (2*frac(f*n/fs) - 1)
    triangle  piecewise-linear triangle of the cycle phase (see generators.ts)
    impulse   x[n] = a at n = impulseSampleIndex
    step      x[n] = before for n < index, after for n >= index
    chirp     phase = 2*pi * integral_0^t f(tau) dtau, closed form:
                linear      phase(t) = 2*pi*(f0*t + (f1-f0)*t^2/(2*T))
                logarithmic phase(t) = 2*pi*f0*T*expm1(alpha*t/T)/alpha
    two-tone  x[n] = (a/2)*(sin(2*pi*f1*n/fs) + sin(2*pi*f2*n/fs))
    AM        x[n] = a*(1 + m*sin(2*pi*fm*n/fs))*sin(2*pi*fc*n/fs)
    FM        x[n] = a*sin(2*pi*fc*n/fs + (dev/fm)*sin(2*pi*fm*n/fs))

The square threshold is inclusive on purpose: it pins the waveform to
sign(sin) with sign(0) = +1, so both zero crossings of a period are +a.

Tolerance: rtol = 1e-9, atol = 1e-12.
"""

from __future__ import annotations

import numpy as np

from avalab_golden.fixtures import GoldenCase

DURATION_SECONDS = 0.01
SAMPLE_RATE_HZ = 1000
SAMPLE_COUNT = 10
GENERATOR_RTOL = 1e-9
GENERATOR_ATOL = 1e-12


def _sample_index() -> np.ndarray:
    return np.arange(SAMPLE_COUNT, dtype=np.float64)


def _time_seconds() -> np.ndarray:
    return _sample_index() / SAMPLE_RATE_HZ


def _case(
    generator: str,
    name: str,
    params: dict[str, object],
    values: np.ndarray,
) -> GoldenCase:
    return GoldenCase(
        name=name,
        samples=[],
        sample_rate_hz=SAMPLE_RATE_HZ,
        params={
            "generator": generator,
            "durationSeconds": DURATION_SECONDS,
            "sampleRateHz": SAMPLE_RATE_HZ,
            **params,
        },
        expected={"samples": values.tolist()},
        rtol=GENERATOR_RTOL,
        atol=GENERATOR_ATOL,
    )


def _sine_case() -> GoldenCase:
    frequency_hz = 100.0
    amplitude = 0.5
    values = amplitude * np.sin(2.0 * np.pi * frequency_hz * _sample_index() / SAMPLE_RATE_HZ)
    return _case(
        "sine",
        "sine_100hz_amplitude0.5",
        {"frequencyHz": frequency_hz, "amplitude": amplitude},
        values,
    )


def _square_case() -> GoldenCase:
    frequency_hz = 100.0
    amplitude = 0.75
    duty_cycle = 0.25
    phase = np.mod(frequency_hz * _sample_index() / SAMPLE_RATE_HZ, 1.0)
    values = np.where(phase <= duty_cycle, amplitude, -amplitude)
    return _case(
        "square",
        "square_100hz_amplitude0.75_duty0.25",
        {"frequencyHz": frequency_hz, "amplitude": amplitude, "dutyCycle": duty_cycle},
        values,
    )


def _sawtooth_case() -> GoldenCase:
    frequency_hz = 100.0
    amplitude = 0.5
    phase = np.mod(frequency_hz * _sample_index() / SAMPLE_RATE_HZ, 1.0)
    values = amplitude * (2.0 * phase - 1.0)
    return _case(
        "sawtooth",
        "sawtooth_100hz_amplitude0.5",
        {"frequencyHz": frequency_hz, "amplitude": amplitude},
        values,
    )


def _triangle_case() -> GoldenCase:
    frequency_hz = 100.0
    amplitude = 0.5
    phase = np.mod(frequency_hz * _sample_index() / SAMPLE_RATE_HZ, 1.0)
    normalized = np.select(
        [phase < 0.25, phase < 0.75],
        [4.0 * phase, 2.0 - 4.0 * phase],
        default=4.0 * phase - 4.0,
    )
    return _case(
        "triangle",
        "triangle_100hz_amplitude0.5",
        {"frequencyHz": frequency_hz, "amplitude": amplitude},
        amplitude * normalized,
    )


def _impulse_case() -> GoldenCase:
    impulse_index = 3
    amplitude = 0.75
    values = np.zeros(SAMPLE_COUNT, dtype=np.float64)
    values[impulse_index] = amplitude
    return _case(
        "impulse",
        "impulse_index3_amplitude0.75",
        {"impulseSampleIndex": impulse_index, "amplitude": amplitude},
        values,
    )


def _step_case() -> GoldenCase:
    step_index = 4
    amplitude_before = -0.25
    amplitude_after = 0.5
    values = np.where(
        _sample_index() < step_index,
        amplitude_before,
        amplitude_after,
    ).astype(np.float64)
    return _case(
        "step",
        "step_index4_before-0.25_after0.5",
        {
            "stepSampleIndex": step_index,
            "amplitudeBefore": amplitude_before,
            "amplitudeAfter": amplitude_after,
        },
        values,
    )


def _linear_chirp_case() -> GoldenCase:
    start_frequency_hz = 100.0
    end_frequency_hz = 400.0
    time = _time_seconds()
    difference_hz = end_frequency_hz - start_frequency_hz
    phase_cycles = (
        start_frequency_hz * time
        + difference_hz * time * time / (2.0 * DURATION_SECONDS)
    )
    values = np.sin(2.0 * np.pi * phase_cycles)
    return _case(
        "chirp",
        "chirp_linear_100to400hz",
        {
            "startFrequencyHz": start_frequency_hz,
            "endFrequencyHz": end_frequency_hz,
            "sweep": "linear",
        },
        values,
    )


def _logarithmic_chirp_case() -> GoldenCase:
    start_frequency_hz = 100.0
    end_frequency_hz = 400.0
    alpha = np.log(end_frequency_hz) - np.log(start_frequency_hz)
    u = _time_seconds() / DURATION_SECONDS
    phase_cycles = start_frequency_hz * DURATION_SECONDS * np.expm1(alpha * u) / alpha
    values = np.sin(2.0 * np.pi * phase_cycles)
    return _case(
        "chirp",
        "chirp_logarithmic_100to400hz",
        {
            "startFrequencyHz": start_frequency_hz,
            "endFrequencyHz": end_frequency_hz,
            "sweep": "logarithmic",
        },
        values,
    )


def _two_tone_case() -> GoldenCase:
    first_frequency_hz = 100.0
    second_frequency_hz = 250.0
    amplitude = 0.5
    time = _time_seconds()
    values = (amplitude / 2.0) * (
        np.sin(2.0 * np.pi * first_frequency_hz * time)
        + np.sin(2.0 * np.pi * second_frequency_hz * time)
    )
    return _case(
        "twoTone",
        "two_tone_100_250hz_amplitude0.5",
        {"frequenciesHz": [first_frequency_hz, second_frequency_hz], "amplitude": amplitude},
        values,
    )


def _am_case() -> GoldenCase:
    carrier_hz = 100.0
    modulation_hz = 10.0
    modulation_index = 0.5
    amplitude = 0.75
    time = _time_seconds()
    values = (
        amplitude
        * (1.0 + modulation_index * np.sin(2.0 * np.pi * modulation_hz * time))
        * np.sin(2.0 * np.pi * carrier_hz * time)
    )
    return _case(
        "am",
        "am_carrier100_mod10_index0.5_amplitude0.75",
        {
            "carrierHz": carrier_hz,
            "modulationHz": modulation_hz,
            "modulationIndex": modulation_index,
            "amplitude": amplitude,
        },
        values,
    )


def _fm_case() -> GoldenCase:
    carrier_hz = 100.0
    modulation_hz = 10.0
    frequency_deviation_hz = 25.0
    amplitude = 0.75
    time = _time_seconds()
    beta = frequency_deviation_hz / modulation_hz
    values = amplitude * np.sin(
        2.0 * np.pi * carrier_hz * time + beta * np.sin(2.0 * np.pi * modulation_hz * time)
    )
    return _case(
        "fm",
        "fm_carrier100_mod10_deviation25_amplitude0.75",
        {
            "carrierHz": carrier_hz,
            "modulationHz": modulation_hz,
            "frequencyDeviationHz": frequency_deviation_hz,
            "amplitude": amplitude,
        },
        values,
    )


def cases() -> list[GoldenCase]:
    """Return the generator fixture case set in stable order."""
    return [
        _sine_case(),
        _square_case(),
        _sawtooth_case(),
        _triangle_case(),
        _impulse_case(),
        _step_case(),
        _linear_chirp_case(),
        _logarithmic_chirp_case(),
        _two_tone_case(),
        _am_case(),
        _fm_case(),
    ]
