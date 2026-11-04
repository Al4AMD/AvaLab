"""DPDFNet denoise adapter: rate contract, length and short-input safety."""

import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from avalab_api.ml.denoise import DenoiseRunner, load_dpdfnet


class FakeDenoiser:
    """Records calls and returns half-scale audio at the model rate."""

    sample_rate = 48_000

    def __init__(self) -> None:
        self.calls: list[tuple[int, int]] = []

    def run(self, samples: np.ndarray, sample_rate_hz: int) -> Any:
        self.calls.append((samples.size, sample_rate_hz))
        return SimpleNamespace(
            samples=(np.asarray(samples, dtype=np.float32) * 0.5).tolist(),
            sample_rate=self.sample_rate,
        )


def _tone(sample_rate_hz: int, seconds: float = 0.3) -> np.ndarray:
    t = np.arange(round(sample_rate_hz * seconds), dtype=np.float64) / sample_rate_hz
    return (0.2 * np.sin(2.0 * np.pi * 440.0 * t)).astype(np.float32)


@pytest.mark.parametrize("source_rate", [8_000, 16_000, 22_050, 44_100, 48_000, 96_000])
def test_rate_restoration_and_length(source_rate: int) -> None:
    fake = FakeDenoiser()
    samples = _tone(source_rate)
    result = DenoiseRunner(fake).run(samples, source_rate, {}, lambda _: None)

    assert fake.calls
    assert fake.calls[0][1] == 48_000
    assert result.kind == "audio"
    assert result.sample_rate_hz == source_rate
    assert result.samples is not None
    assert result.samples.size == samples.size
    assert result.samples.dtype == np.float32
    assert np.isfinite(result.samples).all()
    assert result.stats["model_id"] == "Ceva-IP/DPDFNet"


def test_short_input_is_padded_for_model_and_trimmed() -> None:
    fake = FakeDenoiser()
    samples = _tone(16_000, seconds=0.05)
    result = DenoiseRunner(fake).run(samples, 16_000, {}, lambda _: None)

    assert fake.calls[0][0] >= round(0.2 * 48_000)
    assert result.samples is not None
    assert result.samples.size == samples.size


def test_silent_input_stays_finite_and_silent() -> None:
    fake = FakeDenoiser()
    samples = np.zeros(16_000, dtype=np.float32)
    result = DenoiseRunner(fake).run(samples, 16_000, {}, lambda _: None)

    assert result.samples is not None
    assert result.samples.size == samples.size
    assert np.isfinite(result.samples).all()
    assert np.max(np.abs(result.samples)) == 0.0


def test_empty_input_skips_backend() -> None:
    fake = FakeDenoiser()
    result = DenoiseRunner(fake).run(np.zeros(0, dtype=np.float32), 16_000, {}, lambda _: None)

    assert fake.calls == []
    assert result.samples is not None
    assert result.samples.size == 0
    assert result.sample_rate_hz == 16_000


def test_non_finite_input_is_rejected() -> None:
    fake = FakeDenoiser()
    samples = np.ones(1600, dtype=np.float32)
    samples[10] = np.nan

    with pytest.raises(ValueError, match="non-finite"):
        DenoiseRunner(fake).run(samples, 16_000, {}, lambda _: None)


@pytest.mark.ml
@pytest.mark.skipif(
    os.environ.get("AVALAB_RUN_ML_TESTS") != "1",
    reason="real-model smoke requires AVALAB_RUN_ML_TESTS=1",
)
def test_real_dpdfnet_smoke() -> None:
    cache = Path.home() / ".cache" / "avalab" / "models"
    model = cache / "denoise" / "onnx" / "dpdfnet2_48khz_hr.onnx"
    if not model.is_file():
        pytest.skip("DPDFNet weights are not cached")
    runner = load_dpdfnet(cache / "denoise")
    samples = _tone(16_000, seconds=0.5)
    result = runner.run(samples, 16_000, {}, lambda _: None)

    assert result.samples is not None
    assert result.samples.size == samples.size
    assert np.isfinite(result.samples).all()
