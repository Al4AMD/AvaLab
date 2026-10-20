"""Golden cases for F04 G.711 mu-law and A-law companding.

Reference implementation: Python 3.12 stdlib ``audioop``, pinned by controller
ruling R5 (``audioop`` is deprecated and removed in Python 3.13, which is why
the implementation side is TypeScript and only this reference depends on it).
``audioop`` operates on signed 16-bit little-endian PCM; the scale conversion
is identical to ``packages/dsp/src/metrics/companding.ts``:

    s[n]     = clip(round(x[n] * 32768), -32768, 32767)      (signed int16)
    encoded  = audioop.lin2ulaw / audioop.lin2alaw(struct.pack("<h" ...), 2)
    decoded  = audioop.ulaw2lin / audioop.alaw2lin(encoded, 2) / 32768

The golden inputs are exact multiples of 1/32768 (the 16-bit ramp) or 1/128
(the 8-bit-equivalent sine), so ``x * 32768`` is an exact integer in both
languages and no tie in the round rule is ever exercised. Encode vectors are
the exact audioop byte values; decode vectors are the audioop int16 output
divided by 32768. Decode tolerance is rtol = 1e-6 (atol = 1e-12), while the
TypeScript test additionally requires exact byte equality for encoding.

Both codecs are exercised on both signals, encode and decode, as required by
the plan. The sine uses 400 samples (0.05 s at 8 kHz, R9). The audioop
DeprecationWarning is silenced explicitly around the import.
"""

from __future__ import annotations

import struct
import warnings

import numpy as np

from avalab_golden.fixtures import GoldenCase

with warnings.catch_warnings():
    warnings.filterwarnings(
        "ignore",
        message="'audioop' is deprecated and slated for removal in Python 3.13",
        category=DeprecationWarning,
    )
    import audioop  # noqa: E402  (imported after the explicit warning filter)

COMPANDING_RTOL = 1e-6
RAMP_16BIT_VALUES = (
    -32768,
    -28672,
    -24576,
    -20480,
    -16384,
    -12288,
    -8192,
    -4096,
    0,
    4096,
    8192,
    12288,
    16384,
    20480,
    24576,
    28672,
    32767,
)
SINE_SAMPLE_RATE_HZ = 8000
SINE_DURATION_SECONDS = 0.05
SINE_FREQUENCY_HZ = 440.0
SINE_8BIT_AMPLITUDE = 127.0


def _ramp_16bit() -> list[float]:
    return [value / 32768.0 for value in RAMP_16BIT_VALUES]


def _sine_8bit_equivalent() -> list[float]:
    """440 Hz sine on the signed 8-bit PCM grid (multiples of 1/128)."""
    sample_count = round(SINE_DURATION_SECONDS * SINE_SAMPLE_RATE_HZ)
    n = np.arange(sample_count, dtype=np.float64)
    scaled = SINE_8BIT_AMPLITUDE * np.sin(
        2.0 * np.pi * SINE_FREQUENCY_HZ * n / SINE_SAMPLE_RATE_HZ
    )
    codes = np.round(scaled).astype(np.int64)
    return [int(code) / 128.0 for code in codes]


def _to_int16(sample: float) -> int:
    scaled = round(sample * 32768.0)
    return min(32767, max(-32768, scaled))


def _encode(codec: str, samples: list[float]) -> list[int]:
    int16_samples = [_to_int16(sample) for sample in samples]
    pcm = struct.pack(f"<{len(int16_samples)}h", *int16_samples)
    if codec == "mulaw":
        return list(audioop.lin2ulaw(pcm, 2))
    return list(audioop.lin2alaw(pcm, 2))


def _decode(codec: str, encoded: list[int]) -> list[float]:
    raw = bytes(encoded)
    linear = audioop.ulaw2lin(raw, 2) if codec == "mulaw" else audioop.alaw2lin(raw, 2)
    int16_samples = struct.unpack(f"<{len(encoded)}h", linear)
    return [value / 32768.0 for value in int16_samples]


def _case(
    name: str,
    samples: list[float],
    codec: str,
    sample_rate_hz: int | None,
) -> GoldenCase:
    encoded = _encode(codec, samples)
    return GoldenCase(
        name=name,
        samples=samples,
        sample_rate_hz=sample_rate_hz,
        params={"codec": codec, "bits": 8},
        expected={"encodedBytes": encoded, "decodedSamples": _decode(codec, encoded)},
        rtol=COMPANDING_RTOL,
    )


def cases() -> list[GoldenCase]:
    """Return the companding fixture case set in stable order."""
    ramp = _ramp_16bit()
    sine = _sine_8bit_equivalent()
    return [
        _case("companding_ramp16_mulaw", ramp, "mulaw", None),
        _case("companding_ramp16_alaw", ramp, "alaw", None),
        _case("companding_sine8_mulaw", sine, "mulaw", SINE_SAMPLE_RATE_HZ),
        _case("companding_sine8_alaw", sine, "alaw", SINE_SAMPLE_RATE_HZ),
    ]
