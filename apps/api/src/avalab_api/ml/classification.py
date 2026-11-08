"""AudioSet classification adapter (Wave 7 F14).

AST is a multi-label classifier: the pinned checkpoint was fine-tuned on the
527 AudioSet classes, so every window produces one independent sigmoid score
per class, not a softmax distribution. The runner resamples to the model's
16 kHz rate, splits the excerpt into non-overlapping 10 s windows, averages
the per-class probabilities across windows, and returns the top-k labels.
The 10 s window keeps AST's fixed 1024-patch input (10.24 s) honest; longer
excerpts are averaged rather than silently truncated.
"""

from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast

import numpy as np
from pydantic import BaseModel, Field

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.audio import resample_to
from avalab_api.ml.jobs import MlResult
from avalab_api.ml.registry import register_runner
from avalab_api.ml.runtime import torch_device

MODEL_ID = "MIT/ast-finetuned-audioset-10-10-0.4593"
MODEL_RATE_HZ = 16_000
WINDOW_SECONDS = 10.0
SILENT_PEAK = 1e-7


class ClassificationParams(BaseModel):
    """Number of ranked AudioSet labels to return."""

    top_k: int = Field(default=5, ge=1, le=20)


class ClassificationBackend(Protocol):
    """Minimal seam over an AST processor/model pair."""

    @property
    def labels(self) -> tuple[str, ...]:
        """Class names ordered by model output index."""

    def classify(self, samples: np.ndarray, sample_rate_hz: int) -> np.ndarray:
        """Return one probability per class for a mono window."""


def _windows(audio: np.ndarray, sample_rate_hz: int) -> list[np.ndarray]:
    window_samples = max(1, round(WINDOW_SECONDS * sample_rate_hz))
    return [audio[start : start + window_samples] for start in range(0, audio.size, window_samples)]


class ClassificationRunner:
    """Resample -> AST windows -> averaged top-k AudioSet labels."""

    def __init__(self, backend: ClassificationBackend) -> None:
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

        top_k = ClassificationParams.model_validate(params).top_k
        labels = self._backend.labels
        if not labels:
            raise ValueError("model returned no labels")
        duration_s = float(audio.size / sample_rate_hz)

        progress(0.02)
        model_audio = resample_to(audio, sample_rate_hz, MODEL_RATE_HZ)
        chunks = _windows(model_audio, MODEL_RATE_HZ)
        total = np.zeros(len(labels), dtype=np.float64)
        for index, chunk in enumerate(chunks):
            probabilities = np.asarray(
                self._backend.classify(chunk, MODEL_RATE_HZ), dtype=np.float64
            )
            if probabilities.shape != (len(labels),):
                raise ValueError("model returned an unexpected probability shape")
            if not np.isfinite(probabilities).all():
                raise ValueError("model returned non-finite probabilities")
            total += probabilities
            progress(0.02 + 0.93 * (index + 1) / len(chunks))
        averaged = total / len(chunks)

        ranked = np.argsort(-averaged, kind="stable")[: min(top_k, len(labels))]
        ranked_labels: list[dict[str, object]] = [
            {"label": labels[int(index)], "probability": float(averaged[index])}
            for index in ranked
        ]
        progress(1.0)
        return MlResult(
            kind="classification",
            labels=ranked_labels,
            stats={
                "model_id": MODEL_ID,
                "duration_s": duration_s,
                "analyzed_s": duration_s,
                "window_s": WINDOW_SECONDS,
                "window_count": len(chunks),
                "top_k": top_k,
            },
        )


class AstBackend:
    """Thin typed wrapper over a pinned Transformers AST model."""

    def __init__(self, processor: Any, model: Any, labels: tuple[str, ...]) -> None:
        self._processor = processor
        self._model = model
        self._labels = labels

    @property
    def labels(self) -> tuple[str, ...]:
        return self._labels

    def classify(self, samples: np.ndarray, sample_rate_hz: int) -> np.ndarray:
        torch = cast(Any, import_module("torch"))
        device = getattr(self._model, "device", "cpu")
        inputs = self._processor(
            np.ascontiguousarray(samples, dtype=np.float32),
            sampling_rate=sample_rate_hz,
            return_tensors="pt",
        )
        tensors = {key: value.to(device) for key, value in inputs.items()}
        with torch.no_grad():
            logits = self._model(**tensors).logits
            probabilities = torch.sigmoid(logits)[0]
        return cast(np.ndarray, probabilities.detach().float().cpu().numpy())


def load_ast(model_dir: Path) -> ClassificationRunner:
    """Load the pinned AST files; heavy imports stay inside this call."""
    try:
        transformers = cast(Any, import_module("transformers"))
    except ImportError as exc:
        raise ApiError(
            ErrorCode.model_unavailable,
            "transformers is not installed; install the ml extra",
            503,
        ) from exc

    try:
        processor = transformers.AutoFeatureExtractor.from_pretrained(
            str(model_dir), local_files_only=True
        )
        model = transformers.AutoModelForAudioClassification.from_pretrained(
            str(model_dir), local_files_only=True
        )
        model.to(torch_device())
        model.eval()
        id2label = cast(dict[object, object], model.config.id2label)
        labels = tuple(str(id2label[index]) for index in range(len(id2label)))
    except Exception as exc:
        raise ApiError(
            ErrorCode.model_unavailable, f"Could not load AST: {exc}", 503
        ) from exc
    return ClassificationRunner(AstBackend(processor, model, labels))


register_runner("classification", load_ast)
