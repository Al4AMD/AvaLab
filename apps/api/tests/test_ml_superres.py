"""LavaSR super-resolution adapter: rate contract, length and high-band smoke."""

import os
from pathlib import Path

import numpy as np
import pytest

from avalab_api.ml.superres import SuperresRunner, load_lavasr

DEMO_SPEECH = (
    Path(__file__).resolve().parents[3]
    / "apps"
    / "web"
    / "public"
    / "demo"
    / "speech-kathleen-19s.wav"
)


class FakeEnhancer:
    """Records calls and returns half-scale audio at the configured output rate."""

    def __init__(self, input_rate_hz: int = 16_000, output_rate_hz: int = 48_000) -> None:
        self.input_sample_rate_hz = input_rate_hz
        self.output_sample_rate_hz = output_rate_hz
        self.calls: list[tuple[int, int]] = []

    def upscale(self, samples: np.ndarray, sample_rate_hz: int) -> tuple[np.ndarray, int]:
        self.calls.append((samples.size, sample_rate_hz))
        return (np.asarray(samples, dtype=np.float32) * 0.5).astype(np.float32), (
            self.output_sample_rate_hz
        )


def _tone(sample_rate_hz: int, seconds: float = 0.3) -> np.ndarray:
    t = np.arange(round(sample_rate_hz * seconds), dtype=np.float64) / sample_rate_hz
    return (0.2 * np.sin(2.0 * np.pi * 440.0 * t)).astype(np.float32)


@pytest.mark.parametrize("source_rate", [8_000, 16_000, 22_050, 44_100, 48_000, 96_000])
def test_rate_restoration_and_length(source_rate: int) -> None:
    fake = FakeEnhancer(input_rate_hz=16_000, output_rate_hz=48_000)
    samples = _tone(source_rate)
    result = SuperresRunner(fake).run(samples, source_rate, {}, lambda _: None)

    assert fake.calls
    assert fake.calls[0][1] == 16_000
    assert result.kind == "audio"
    assert result.sample_rate_hz == source_rate
    assert result.samples is not None
    assert result.samples.size == samples.size
    assert result.samples.dtype == np.float32
    assert np.isfinite(result.samples).all()
    assert result.stats["model_id"] == "TigreGotico/audiosronnx-lavasr"
    assert result.stats["input_sample_rate_hz"] == 16_000
    assert result.stats["output_sample_rate_hz"] == 48_000


def test_flexible_input_rate_passes_source_rate() -> None:
    fake = FakeEnhancer(input_rate_hz=0)
    samples = _tone(44_100)
    SuperresRunner(fake).run(samples, 44_100, {}, lambda _: None)

    assert fake.calls[0][1] == 44_100


def test_short_input_is_padded_for_model_and_trimmed() -> None:
    fake = FakeEnhancer(input_rate_hz=16_000)
    samples = _tone(16_000, seconds=0.02)
    result = SuperresRunner(fake).run(samples, 16_000, {}, lambda _: None)

    assert fake.calls[0][0] >= round(0.25 * 16_000)
    assert result.samples is not None
    assert result.samples.size == samples.size


def test_silent_input_stays_finite_and_silent() -> None:
    fake = FakeEnhancer()
    samples = np.zeros(16_000, dtype=np.float32)
    result = SuperresRunner(fake).run(samples, 16_000, {}, lambda _: None)

    assert result.samples is not None
    assert result.samples.size == samples.size
    assert np.isfinite(result.samples).all()
    assert np.max(np.abs(result.samples)) == 0.0


def test_empty_input_skips_backend() -> None:
    fake = FakeEnhancer()
    result = SuperresRunner(fake).run(np.zeros(0, dtype=np.float32), 16_000, {}, lambda _: None)

    assert fake.calls == []
    assert result.samples is not None
    assert result.samples.size == 0
    assert result.sample_rate_hz == 16_000


def test_non_finite_input_is_rejected() -> None:
    fake = FakeEnhancer()
    samples = np.ones(1600, dtype=np.float32)
    samples[10] = np.inf

    with pytest.raises(ValueError, match="non-finite"):
        SuperresRunner(fake).run(samples, 16_000, {}, lambda _: None)


def _band_energy_db(
    samples: np.ndarray, sample_rate_hz: int, low_hz: float, high_hz: float
) -> float:
    spectrum = np.fft.rfft(np.asarray(samples, dtype=np.float64))
    freqs = np.fft.rfftfreq(samples.size, d=1.0 / sample_rate_hz)
    band = (freqs >= low_hz) & (freqs <= high_hz)
    power = float(np.mean(np.abs(spectrum[band]) ** 2))
    return float(10.0 * np.log10(max(power, 1e-20)))


@pytest.mark.ml
@pytest.mark.skipif(
    os.environ.get("AVALAB_RUN_ML_TESTS") != "1",
    reason="real-model smoke requires AVALAB_RUN_ML_TESTS=1",
)
def test_real_lavasr_increases_high_band_on_bandlimited_speech() -> None:
    cache = Path.home() / ".cache" / "avalab" / "models"
    if not (cache / "superres" / "backbone.onnx").is_file():
        pytest.skip("LavaSR weights are not cached")
    if not DEMO_SPEECH.is_file():
        pytest.skip("speech demo clip is unavailable")

    import soundfile  # type: ignore[import-untyped]

    from avalab_api.ml.audio import resample_to

    speech, rate = soundfile.read(DEMO_SPEECH, frames=24_000, start=12_000, dtype="float32")
    assert rate == 48_000
    bandlimited = resample_to(resample_to(speech, rate, 8_000), 8_000, rate)

    runner = load_lavasr(cache / "superres")
    assert runner.input_sample_rate_hz in (0, 16_000)
    assert runner.output_sample_rate_hz == 48_000
    result = runner.run(bandlimited, rate, {}, lambda _: None)

    assert result.samples is not None
    assert result.samples.size == bandlimited.size
    assert np.isfinite(result.samples).all()
    before = _band_energy_db(bandlimited, rate, 10_000.0, 20_000.0)
    after = _band_energy_db(result.samples, rate, 10_000.0, 20_000.0)
    assert after > before + 3.0
