"""AST classification adapter: window averaging, top-k shape and input safety."""

import os
from pathlib import Path
from typing import cast

import numpy as np
import pytest

from avalab_api.ml.classification import ClassificationRunner, load_ast

DEMO_MUSIC = (
    Path(__file__).resolve().parents[3]
    / "apps"
    / "web"
    / "public"
    / "demo"
    / "music-life-turns-15s.wav"
)


class FakeAst:
    """Return fixed probabilities and record every model-rate window."""

    labels = ("Speech", "Music", "Dog")

    def __init__(self, probabilities: tuple[float, float, float] = (0.1, 0.8, 0.2)) -> None:
        self.probabilities = probabilities
        self.calls: list[tuple[int, int]] = []

    def classify(self, samples: np.ndarray, sample_rate_hz: int) -> np.ndarray:
        self.calls.append((samples.size, sample_rate_hz))
        return np.asarray(self.probabilities, dtype=np.float64)


def _tone(sample_rate_hz: int, seconds: float) -> np.ndarray:
    t = np.arange(round(sample_rate_hz * seconds), dtype=np.float64) / sample_rate_hz
    return (0.2 * np.sin(2.0 * np.pi * 440.0 * t)).astype(np.float32)


@pytest.mark.parametrize("source_rate", [8_000, 16_000, 44_100, 48_000, 96_000])
def test_resamples_and_returns_ranked_labels(source_rate: int) -> None:
    fake = FakeAst()
    progress_values: list[float] = []
    result = ClassificationRunner(fake).run(
        _tone(source_rate, 0.5), source_rate, {"top_k": 2}, progress_values.append
    )

    assert fake.calls
    model_samples, model_rate = fake.calls[0]
    assert model_rate == 16_000
    assert model_samples == round(0.5 * 16_000)
    assert result.kind == "classification"
    assert result.labels == [
        {"label": "Music", "probability": pytest.approx(0.8)},
        {"label": "Dog", "probability": pytest.approx(0.2)},
    ]
    assert result.stats["model_id"] == "MIT/ast-finetuned-audioset-10-10-0.4593"
    assert result.stats["window_count"] == 1
    assert result.stats["top_k"] == 2
    assert progress_values == sorted(progress_values)
    assert progress_values[-1] == 1.0


def test_averages_probabilities_across_ten_second_windows() -> None:
    fake = FakeAst((0.2, 0.6, 0.1))
    result = ClassificationRunner(fake).run(
        _tone(16_000, 25.0), 16_000, {"top_k": 3}, lambda _: None
    )

    assert [samples for samples, _ in fake.calls] == [160_000, 160_000, 80_000]
    assert result.stats["duration_s"] == pytest.approx(25.0)
    assert result.stats["analyzed_s"] == pytest.approx(25.0)
    assert result.stats["window_count"] == 3
    assert result.labels is not None
    assert [entry["probability"] for entry in result.labels] == pytest.approx(
        [0.6, 0.2, 0.1]
    )


def test_top_k_is_clamped_by_available_labels() -> None:
    result = ClassificationRunner(FakeAst()).run(
        _tone(16_000, 0.2), 16_000, {"top_k": 20}, lambda _: None
    )

    assert result.labels is not None
    assert len(result.labels) == 3


def test_empty_silent_and_non_finite_inputs_are_rejected() -> None:
    fake = FakeAst()
    with pytest.raises(ValueError, match="empty"):
        ClassificationRunner(fake).run(np.zeros(0, dtype=np.float32), 16_000, {}, lambda _: None)
    with pytest.raises(ValueError, match="silent"):
        ClassificationRunner(fake).run(np.zeros(16_000, dtype=np.float32), 16_000, {}, lambda _: None)
    samples = _tone(16_000, 0.2)
    samples[3] = np.inf
    with pytest.raises(ValueError, match="non-finite"):
        ClassificationRunner(fake).run(samples, 16_000, {}, lambda _: None)
    assert fake.calls == []


def test_model_shape_mismatch_is_rejected() -> None:
    class ShortAst(FakeAst):
        def classify(self, samples: np.ndarray, sample_rate_hz: int) -> np.ndarray:
            return np.asarray([0.5], dtype=np.float64)

    with pytest.raises(ValueError, match="unexpected probability shape"):
        ClassificationRunner(ShortAst()).run(
            _tone(16_000, 0.2), 16_000, {}, lambda _: None
        )


@pytest.mark.ml
@pytest.mark.skipif(
    os.environ.get("AVALAB_RUN_ML_TESTS") != "1",
    reason="real-model smoke requires AVALAB_RUN_ML_TESTS=1",
)
def test_real_ast_smoke_returns_ranked_audioset_labels() -> None:
    cache = Path.home() / ".cache" / "avalab" / "models"
    if not (cache / "classification" / "model.safetensors").is_file():
        pytest.skip("AST weights are not cached")
    if not DEMO_MUSIC.is_file():
        pytest.skip("music demo clip is unavailable")

    import soundfile  # type: ignore[import-untyped]

    rate = 48_000
    music, read_rate = soundfile.read(DEMO_MUSIC, frames=round(rate * 5.0), start=0)
    assert read_rate == rate
    runner = load_ast(cache / "classification")
    result = runner.run(music, rate, {"top_k": 3}, lambda _: None)

    assert result.kind == "classification"
    assert result.labels
    assert len(result.labels) == 3
    probabilities = [cast(float, entry["probability"]) for entry in result.labels]
    assert all(0.0 <= value <= 1.0 for value in probabilities)
    assert probabilities == sorted(probabilities, reverse=True)
