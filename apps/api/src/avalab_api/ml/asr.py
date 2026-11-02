"""Whisper ASR adapter (Wave-5 Plan 03 Task 3).

Whisper tiny is loaded from the pinned flat cache through Transformers. The
job manager hands over mono audio at the source rate; this adapter resamples
to the model's fixed 16 kHz, runs one transcription pass, and normalizes the
pipeline's chunk timestamps into ``{start_s, end_s, text}`` segments. Empty or
silent excerpts are rejected instead of being reported as a successful empty
transcript.
"""

import math
from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast

import numpy as np
from pydantic import BaseModel

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.audio import resample_to
from avalab_api.ml.jobs import MlResult
from avalab_api.ml.registry import register_runner

MODEL_ID = "openai/whisper-tiny"
MODEL_RATE_HZ = 16_000
SILENT_PEAK = 1e-7


class AsrParams(BaseModel):
    """Optional language hint forwarded to Whisper."""

    language: str | None = None


class AsrBackend(Protocol):
    """Minimal seam over a Transformers ASR pipeline."""

    def transcribe(
        self, samples: np.ndarray, sample_rate_hz: int, language: str | None
    ) -> dict[str, Any]:
        """Return a pipeline-shaped dict with ``text`` and optional ``chunks``."""


def _segments(output: dict[str, Any], text: str, duration_s: float) -> list[dict[str, object]]:
    segments: list[dict[str, object]] = []
    chunks = output.get("chunks")
    if isinstance(chunks, list):
        for chunk in chunks:
            if not isinstance(chunk, dict):
                continue
            timestamp = chunk.get("timestamp")
            chunk_text = chunk.get("text")
            if not isinstance(chunk_text, str) or not isinstance(timestamp, (list, tuple)):
                continue
            if len(timestamp) != 2:
                continue
            start, end = timestamp
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                continue
            if not math.isfinite(start) or not math.isfinite(end) or end < start:
                continue
            segments.append(
                {
                    "start_s": float(start),
                    "end_s": float(end),
                    "text": chunk_text.strip(),
                }
            )
    if not segments:
        segments.append({"start_s": 0.0, "end_s": duration_s, "text": text})
    return segments


class AsrRunner:
    """Resample -> Whisper -> transcript/segments at the source length."""

    def __init__(self, backend: AsrBackend) -> None:
        self._backend = backend

    def run(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        params: dict[str, object],
        progress: Callable[[float], None],
    ) -> MlResult:
        audio = np.ascontiguousarray(samples, dtype=np.float32)
        if sample_rate_hz <= 0:
            raise ValueError("sample_rate_hz must be positive")
        if audio.size and not np.isfinite(audio).all():
            raise ValueError("input contains non-finite samples")
        if audio.size == 0:
            raise ValueError("input is empty")
        if float(np.max(np.abs(audio))) < SILENT_PEAK:
            raise ValueError("input is silent")

        language = AsrParams.model_validate(params).language
        if language is not None and language.strip() == "":
            language = None
        duration_s = float(audio.size / sample_rate_hz)

        progress(0.05)
        model_audio = resample_to(audio, sample_rate_hz, MODEL_RATE_HZ)
        progress(0.15)
        output = self._backend.transcribe(model_audio, MODEL_RATE_HZ, language)
        if not isinstance(output, dict):
            raise TypeError("ASR backend returned an unexpected payload")
        progress(0.9)

        text = output.get("text")
        if not isinstance(text, str) or text.strip() == "":
            raise ValueError("model returned an empty transcript")
        text = text.strip()
        detected = output.get("language")
        result_language = detected if isinstance(detected, str) else language
        progress(1.0)
        return MlResult(
            kind="transcript",
            text=text,
            segments=_segments(output, text, duration_s),
            language=result_language,
            stats={
                "model_id": MODEL_ID,
                "duration_s": duration_s,
                "language": result_language,
            },
        )


class WhisperBackend:
    """Thin typed wrapper over a Transformers ASR pipeline."""

    def __init__(self, pipeline: Any) -> None:
        self._pipeline = pipeline

    def transcribe(
        self, samples: np.ndarray, sample_rate_hz: int, language: str | None
    ) -> dict[str, Any]:
        del sample_rate_hz
        options: dict[str, Any] = {
            "return_timestamps": True,
            "chunk_length_s": 30,
        }
        if language is not None:
            options["generate_kwargs"] = {"language": language}
        output = self._pipeline(np.ascontiguousarray(samples, dtype=np.float32), **options)
        if isinstance(output, list):
            output = output[0] if output else {}
        if not isinstance(output, dict):
            raise TypeError("Whisper pipeline returned an unexpected payload")
        return cast(dict[str, Any], output)


def load_asr(model_dir: Path) -> AsrRunner:
    """Load the pinned Whisper tiny files with a lazy Transformers import."""
    try:
        transformers = cast(Any, import_module("transformers"))
    except ImportError as exc:
        raise ApiError(
            ErrorCode.model_unavailable,
            "transformers is not installed; install the ml extra",
            503,
        ) from exc

    try:
        processor = transformers.WhisperProcessor.from_pretrained(
            str(model_dir), local_files_only=True
        )
        model = transformers.WhisperForConditionalGeneration.from_pretrained(
            str(model_dir), local_files_only=True
        )
        pipeline = transformers.pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            device=-1,
        )
    except Exception as exc:
        raise ApiError(ErrorCode.model_unavailable, f"Could not load Whisper: {exc}", 503) from exc
    return AsrRunner(WhisperBackend(pipeline))


register_runner("asr", load_asr)
