"""Encodec neural-codec adapter: bandwidth, estimate and length contracts."""

import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from pydantic import ValidationError

from avalab_api.ml.neural_codec import (
    MODEL_RATE_HZ,
    NeuralCodecParams,
    NeuralCodecRunner,
    load_encodec,
)


class FakeEncodec:
    """Returns a deterministic, resampled copy and records the model call."""

    def __init__(self, extra_samples: int = 0) -> None:
        self.calls: list[tuple[int, int, float]] = []
        self._extra_samples = extra_samples

    @property
    def sample_rate_hz(self) -> int:
        return MODEL_RATE_HZ

    def roundtrip(self, samples: np.ndarray, bandwidth_kbps: float) -> np.ndarray:
        self.calls.append((samples.size, MODEL_RATE_HZ, bandwidth_kbps))
        output = np.asarray(samples, dtype=np.float32)
        if self._extra_samples > 0:
            return np.pad(output, (0, self._extra_samples))
        if self._extra_samples < 0:
            return output[: max(0, output.size + self._extra_samples)]
        return output


def _tone(sample_rate_hz: int, seconds: float = 0.5) -> np.ndarray:
    t = np.arange(round(sample_rate_hz * seconds), dtype=np.float64) / sample_rate_hz
    return (0.2 * np.sin(2.0 * np.pi * 440.0 * t)).astype(np.float32)


def test_bandwidth_values_are_validated() -> None:
    assert NeuralCodecParams().bandwidth_kbps == 6.0
    assert NeuralCodecParams.model_validate({"bandwidth_kbps": 1.5}).bandwidth_kbps == 1.5
    assert NeuralCodecParams.model_validate({"bandwidth_kbps": 24}).bandwidth_kbps == 24.0
    with pytest.raises(ValidationError):
        NeuralCodecParams.model_validate({"bandwidth_kbps": 8})


def test_estimate_uses_source_duration_and_requested_bandwidth() -> None:
    fake = FakeEncodec()
    samples = _tone(44_100, 2.0)
    result = NeuralCodecRunner(fake).run(
        samples, 44_100, {"bandwidth_kbps": 3.0}, lambda _: None
    )

    assert result.stats["bandwidth_kbps"] == 3.0
    assert result.stats["estimated_bitrate_kbps"] == 3.0
    assert result.stats["estimated_size_bytes"] == pytest.approx(3.0 * 1000 / 8 * 2.0)
    assert result.stats["duration_s"] == pytest.approx(2.0)
    assert result.stats["model_id"] == "facebook/encodec_48khz"


@pytest.mark.parametrize("source_rate", [8_000, 22_050, 44_100, 48_000])
def test_resamples_to_48k_and_restores_source_rate_and_length(source_rate: int) -> None:
    fake = FakeEncodec(extra_samples=37)
    samples = _tone(source_rate, 0.25)
    result = NeuralCodecRunner(fake).run(samples, source_rate, {}, lambda _: None)

    assert fake.calls
    assert fake.calls[0][1] == 48_000
    assert fake.calls[0][2] == 6.0
    assert result.sample_rate_hz == source_rate
    assert result.samples is not None
    assert result.samples.size == samples.size


def test_short_model_output_is_zero_padded() -> None:
    fake = FakeEncodec(extra_samples=-500)
    samples = _tone(44_100, 0.25)
    result = NeuralCodecRunner(fake).run(samples, 44_100, {}, lambda _: None)

    assert result.samples is not None
    assert result.samples.size == samples.size
    assert np.all(result.samples[-400:] == 0)


def test_silent_input_is_valid_and_still_estimated() -> None:
    fake = FakeEncodec()
    result = NeuralCodecRunner(fake).run(
        np.zeros(48_000, dtype=np.float32), 48_000, {}, lambda _: None
    )

    assert fake.calls
    assert result.samples is not None
    assert result.samples.size == 48_000
    assert result.stats["estimated_size_bytes"] == pytest.approx(750.0)


def test_empty_input_skips_the_model() -> None:
    fake = FakeEncodec()
    result = NeuralCodecRunner(fake).run(
        np.zeros(0, dtype=np.float32), 48_000, {}, lambda _: None
    )

    assert fake.calls == []
    assert result.samples is not None
    assert result.samples.size == 0
    assert result.stats["estimated_size_bytes"] == 0.0


def test_non_finite_input_is_rejected() -> None:
    samples = _tone(48_000)
    samples[10] = np.inf
    with pytest.raises(ValueError, match="non-finite"):
        NeuralCodecRunner(FakeEncodec()).run(samples, 48_000, {}, lambda _: None)


@pytest.mark.ml
@pytest.mark.skipif(
    os.environ.get("AVALAB_RUN_ML_TESTS") != "1",
    reason="real-model smoke requires AVALAB_RUN_ML_TESTS=1",
)
def test_real_encodec_smoke() -> None:
    cache = Path.home() / ".cache" / "avalab" / "models"
    model_dir = cache / "neural_codec"
    if not (model_dir / "model.safetensors").is_file():
        pytest.skip("Encodec weights are not cached")

    samples = _tone(48_000, 1.0)
    runner = load_encodec(model_dir)
    result: Any = runner.run(samples, 48_000, {"bandwidth_kbps": 6.0}, lambda _: None)

    assert result.kind == "audio"
    assert result.sample_rate_hz == 48_000
    assert result.samples is not None
    assert result.samples.size == samples.size
    assert np.isfinite(result.samples).all()
    assert result.stats["estimated_size_bytes"] == pytest.approx(750.0)
