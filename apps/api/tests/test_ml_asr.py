"""Whisper ASR adapter: 16 kHz input, transcript shape and empty-input safety."""

import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from avalab_api.ml.asr import AsrRunner, load_asr

DEMO_SPEECH = (
    Path(__file__).resolve().parents[3]
    / "apps"
    / "web"
    / "public"
    / "demo"
    / "speech-kathleen-19s.wav"
)


class FakeWhisper:
    """Records the model call and returns a transcript with two chunks."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, int, str | None]] = []

    def transcribe(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        language: str | None,
        progress: Any = None,
    ) -> dict[str, Any]:
        self.calls.append((samples.size, sample_rate_hz, language))
        if progress is not None:
            progress(0.5)
        return {
            "text": " Hello world. ",
            "chunks": [
                {"timestamp": (0.0, 1.25), "text": " Hello"},
                {"timestamp": (1.25, 2.0), "text": " world."},
            ],
            "language": "en",
        }


def _tone(sample_rate_hz: int, seconds: float = 0.5) -> np.ndarray:
    t = np.arange(round(sample_rate_hz * seconds), dtype=np.float64) / sample_rate_hz
    return (0.2 * np.sin(2.0 * np.pi * 440.0 * t)).astype(np.float32)


@pytest.mark.parametrize("source_rate", [8_000, 16_000, 44_100, 48_000])
def test_resamples_to_16k_and_shapes_transcript(source_rate: int) -> None:
    fake = FakeWhisper()
    samples = _tone(source_rate)
    result = AsrRunner(fake).run(samples, source_rate, {"language": "en"}, lambda _: None)

    assert fake.calls
    model_samples, model_rate, language = fake.calls[0]
    assert model_rate == 16_000
    assert model_samples == round(samples.size * 16_000 / source_rate)
    assert language == "en"
    assert result.kind == "transcript"
    assert result.text == "Hello world."
    assert result.language == "en"
    assert result.segments == [
        {"start_s": 0.0, "end_s": 1.25, "text": "Hello"},
        {"start_s": 1.25, "end_s": 2.0, "text": "world."},
    ]
    assert result.stats["model_id"] == "Systran/faster-whisper-medium"
    assert result.stats["duration_s"] == pytest.approx(samples.size / source_rate)


def test_empty_input_skips_the_pipeline() -> None:
    fake = FakeWhisper()

    with pytest.raises(ValueError, match="empty"):
        AsrRunner(fake).run(np.zeros(0, dtype=np.float32), 16_000, {}, lambda _: None)

    assert fake.calls == []


def test_silent_input_is_an_error_not_an_empty_transcript() -> None:
    fake = FakeWhisper()

    with pytest.raises(ValueError, match="silent"):
        AsrRunner(fake).run(np.zeros(16_000, dtype=np.float32), 16_000, {}, lambda _: None)

    assert fake.calls == []


def test_empty_model_text_is_rejected() -> None:
    class EmptyWhisper(FakeWhisper):
        def transcribe(
            self,
            samples: np.ndarray,
            sample_rate_hz: int,
            language: str | None,
            progress: Any = None,
        ) -> dict[str, Any]:
            return {"text": "   ", "chunks": []}

    with pytest.raises(ValueError, match="empty transcript"):
        AsrRunner(EmptyWhisper()).run(_tone(16_000), 16_000, {}, lambda _: None)


def test_faster_whisper_backend_maps_segments_and_progress() -> None:
    from avalab_api.ml import asr as asr_module

    class FakeSegment:
        def __init__(self, start: float, end: float, text: str) -> None:
            self.start = start
            self.end = end
            self.text = text

    class FakeInfo:
        language = "fa"

    class FakeModel:
        def __init__(self) -> None:
            self.calls: list[tuple[int, dict[str, object]]] = []

        def transcribe(
            self, samples: np.ndarray, **kwargs: object
        ) -> tuple[list[FakeSegment], FakeInfo]:
            self.calls.append((samples.size, kwargs))
            return (
                [
                    FakeSegment(0.0, 1.0, " سلام"),
                    FakeSegment(1.0, 2.0, " دنیا "),
                ],
                FakeInfo(),
            )

    model = FakeModel()
    backend_cls = asr_module.FasterWhisperBackend
    progress: list[float] = []
    output = backend_cls(model).transcribe(
        np.zeros(32_000, dtype=np.float32), 16_000, None, progress.append
    )

    assert model.calls == [
        (
            32_000,
            {"language": None, "beam_size": 5, "vad_filter": True},
        )
    ]
    assert output == {
        "text": "سلام دنیا",
        "chunks": [
            {"timestamp": (0.0, 1.0), "text": " سلام"},
            {"timestamp": (1.0, 2.0), "text": " دنیا "},
        ],
        "language": "fa",
    }
    assert progress == [0.5, 1.0]


@pytest.mark.ml
@pytest.mark.skipif(
    os.environ.get("AVALAB_RUN_ML_TESTS") != "1",
    reason="real-model smoke requires AVALAB_RUN_ML_TESTS=1",
)
def test_real_faster_whisper_medium_smoke() -> None:
    cache = Path.home() / ".cache" / "avalab" / "models"
    if not (cache / "asr" / "model.bin").is_file():
        pytest.skip("faster-whisper medium weights are not cached")
    if not DEMO_SPEECH.is_file():
        pytest.skip("speech demo clip is unavailable")

    import soundfile  # type: ignore[import-untyped]

    speech, rate = soundfile.read(DEMO_SPEECH, frames=80_000, start=0, dtype="float32")
    assert rate == 48_000
    runner = load_asr(cache / "asr")
    result = runner.run(speech, rate, {"language": "en"}, lambda _: None)

    assert result.kind == "transcript"
    assert result.text
    assert result.segments
    assert result.language == "en"
