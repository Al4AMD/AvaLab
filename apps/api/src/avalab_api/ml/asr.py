"""faster-whisper ASR adapter.

Whisper medium is loaded as a pinned CTranslate2 model from the flat cache.
The job manager hands over mono audio at the source rate; this adapter
resamples to the model's fixed 16 kHz, runs one transcription pass, and
normalizes the segments into ``{start_s, end_s, text}``. Empty or silent
excerpts are rejected instead of being reported as a successful empty
transcript. CPU uses int8; CUDA uses float16.
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
from avalab_api.ml.runtime import torch_device

MODEL_ID = "Systran/faster-whisper-medium"
MODEL_RATE_HZ = 16_000
SILENT_PEAK = 1e-7


class AsrParams(BaseModel):
    """Optional language hint forwarded to Whisper."""

    language: str | None = None


class AsrBackend(Protocol):
    """Minimal seam over a speech-recognition model."""

    def transcribe(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        language: str | None,
        progress: Callable[[float], None] | None = None,
    ) -> dict[str, Any]:
        """Return a dict with ``text``, optional ``chunks`` and ``language``."""


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
        def report(fraction: float) -> None:
            progress(0.15 + 0.75 * min(max(fraction, 0.0), 1.0))

        output = self._backend.transcribe(model_audio, MODEL_RATE_HZ, language, report)
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


class FasterWhisperBackend:
    """Translate faster-whisper segments into the adapter's dict shape."""

    def __init__(self, model: Any) -> None:
        self._model = model

    def transcribe(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        language: str | None,
        progress: Callable[[float], None] | None = None,
    ) -> dict[str, Any]:
        segments, info = self._model.transcribe(
            np.ascontiguousarray(samples, dtype=np.float32),
            language=language,
            beam_size=5,
            vad_filter=True,
        )
        duration_s = max(samples.size / sample_rate_hz, 1e-9)
        chunks: list[dict[str, object]] = []
        texts: list[str] = []
        for segment in segments:
            start = float(segment.start)
            end = float(segment.end)
            text = segment.text
            if (
                not isinstance(text, str)
                or not math.isfinite(start)
                or not math.isfinite(end)
                or end < start
            ):
                continue
            chunks.append({"timestamp": (start, end), "text": text})
            texts.append(text.strip())
            if progress is not None:
                progress(min(max(end / duration_s, 0.0), 1.0))
        detected = getattr(info, "language", None)
        return {
            "text": " ".join(text for text in texts if text),
            "chunks": chunks,
            "language": detected if isinstance(detected, str) else None,
        }


def load_asr(model_dir: Path) -> AsrRunner:
    """Load the pinned CTranslate2 Whisper model with a lazy import."""
    try:
        faster_whisper = cast(Any, import_module("faster_whisper"))
    except ImportError as exc:
        raise ApiError(
            ErrorCode.model_unavailable,
            "faster-whisper is not installed; install the ml extra",
            503,
        ) from exc

    device = torch_device()
    compute_type = "float16" if device == "cuda" else "int8"
    try:
        model = faster_whisper.WhisperModel(
            str(model_dir),
            device=device,
            compute_type=compute_type,
            local_files_only=True,
        )
    except Exception as exc:
        raise ApiError(
            ErrorCode.model_unavailable, f"Could not load faster-whisper: {exc}", 503
        ) from exc
    return AsrRunner(FasterWhisperBackend(model))


register_runner("asr", load_asr)
