"""htdemucs separation adapter: stem order, stereo input and length contract."""

import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.separation import SeparationRunner, load_demucs

STEM_ORDER = ("drums", "bass", "other", "vocals")


class FakeSeparator:
    """Records the model input and returns four scaled copies of it."""

    sample_rate = 44_100
    sources: tuple[str, ...] = STEM_ORDER

    def __init__(self, fail: bool = False) -> None:
        self.calls: list[np.ndarray] = []
        self.fail = fail

    def separate(self, samples: np.ndarray) -> np.ndarray:
        self.calls.append(np.asarray(samples, dtype=np.float32))
        if self.fail:
            raise RuntimeError("stem backend exploded")
        scales = np.array([0.1, 0.2, 0.3, 0.4], dtype=np.float32).reshape(4, 1, 1)
        return np.stack([samples, samples, samples, samples]) * scales


def _tone(sample_rate_hz: int, seconds: float = 0.3) -> np.ndarray:
    t = np.arange(round(sample_rate_hz * seconds), dtype=np.float64) / sample_rate_hz
    return (0.2 * np.sin(2.0 * np.pi * 440.0 * t)).astype(np.float32)


@pytest.mark.parametrize("source_rate", [8_000, 16_000, 22_050, 44_100, 48_000, 96_000])
def test_stems_are_ordered_and_restored(source_rate: int) -> None:
    fake = FakeSeparator()
    samples = _tone(source_rate)
    result = SeparationRunner(fake).run(samples, source_rate, {}, lambda _: None)

    assert fake.calls
    model_input = fake.calls[0]
    assert model_input.shape == (2, round(samples.size * fake.sample_rate / source_rate))
    assert np.array_equal(model_input[0], model_input[1])
    assert result.kind == "stems"
    assert result.stems is not None
    assert [stem.name for stem in result.stems] == list(STEM_ORDER)
    assert result.stats["model_id"] == "adefossez/HTDemucs"
    for stem in result.stems:
        assert stem.sample_rate_hz == source_rate
        assert stem.samples.size == samples.size
        assert stem.samples.dtype == np.float32
        assert np.isfinite(stem.samples).all()


def test_stem_failure_is_reported_as_ml_failed() -> None:
    samples = _tone(16_000, seconds=0.1)

    with pytest.raises(ApiError) as exc_info:
        SeparationRunner(FakeSeparator(fail=True)).run(samples, 16_000, {}, lambda _: None)

    assert exc_info.value.code is ErrorCode.ml_failed


def test_missing_backend_stem_is_not_silently_dropped() -> None:
    class ThreeStemSeparator(FakeSeparator):
        sources = ("drums", "bass", "other")

        def separate(self, samples: np.ndarray) -> np.ndarray:
            return super().separate(samples)[:3]

    samples = _tone(16_000, seconds=0.1)

    with pytest.raises(ApiError) as exc_info:
        SeparationRunner(ThreeStemSeparator()).run(samples, 16_000, {}, lambda _: None)

    assert exc_info.value.code is ErrorCode.ml_failed


@pytest.mark.ml
@pytest.mark.skipif(
    os.environ.get("AVALAB_RUN_ML_TESTS") != "1",
    reason="real-model smoke requires AVALAB_RUN_ML_TESTS=1",
)
def test_real_htdemucs_smoke() -> None:
    cache = Path.home() / ".cache" / "avalab" / "models"
    if not (cache / "separation" / "955717e8.safetensors").is_file():
        pytest.skip("htdemucs weights are not cached")
    runner = load_demucs(cache / "separation")
    samples = _tone(16_000, seconds=1.0)
    result: Any = runner.run(samples, 16_000, {}, lambda _: None)

    assert result.kind == "stems"
    assert result.stems is not None
    assert [stem.name for stem in result.stems] == list(STEM_ORDER)
    for stem in result.stems:
        assert stem.samples.size == samples.size
        assert np.isfinite(stem.samples).all()
