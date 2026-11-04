"""LavaSR super-resolution adapter (Wave-5 Plan 02 Task 3).

The model is LavaSR's pure-ONNX bandwidth extension, loaded through
``audiosronnx``. The package's own resolver only accepts a flat local path for
one file, while AvaLab keeps three pinned graphs in a per-task directory, so
the loader subclasses the pinned adapter and opens the local files directly.
The adapter's ``input_sample_rate`` is ``0`` (flexible 8-48 kHz, internally
16 kHz); ``output_sample_rate`` is 48 kHz.

The runner resamples to the adapter's declared input rate (or passes the source
rate through when the adapter is flexible), pads very short inputs for the STFT
front-end, restores the source rate, and trims/pads to the input length so A/B
playback stays aligned.
"""

from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast

import numpy as np

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.audio import resample_to
from avalab_api.ml.jobs import MlResult
from avalab_api.ml.registry import register_runner

MODEL_ID = "TigreGotico/audiosronnx-lavasr"
MIN_MODEL_SECONDS = 0.25


class SuperresBackend(Protocol):
    """Minimal seam over an ``audiosronnx`` ``SRModel``."""

    @property
    def input_sample_rate_hz(self) -> int:
        """Declared input sample rate in Hz; ``0`` means flexible."""

    @property
    def output_sample_rate_hz(self) -> int:
        """Output sample rate in Hz."""

    def upscale(self, samples: np.ndarray, sample_rate_hz: int) -> tuple[np.ndarray, int]:
        """Return ``(samples, sample_rate_hz)`` for one mono array."""


def _fit_length(samples: np.ndarray, sample_count: int) -> np.ndarray:
    if samples.size >= sample_count:
        return np.ascontiguousarray(samples[:sample_count], dtype=np.float32)
    return np.pad(samples, (0, sample_count - samples.size)).astype(np.float32, copy=False)


class SuperresRunner:
    """Resample -> LavaSR -> resample-back runner with a strict length contract."""

    def __init__(self, enhancer: SuperresBackend) -> None:
        self._enhancer = enhancer

    @property
    def input_sample_rate_hz(self) -> int:
        return int(self._enhancer.input_sample_rate_hz)

    @property
    def output_sample_rate_hz(self) -> int:
        return int(self._enhancer.output_sample_rate_hz)

    def run(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        params: dict[str, object],
        progress: Callable[[float], None],
    ) -> MlResult:
        del params
        audio = np.ascontiguousarray(samples, dtype=np.float32)
        if sample_rate_hz <= 0:
            raise ValueError("sample_rate_hz must be positive")
        if audio.size and not np.isfinite(audio).all():
            raise ValueError("input contains non-finite samples")
        stats: dict[str, object] = {
            "model_id": MODEL_ID,
            "duration_s": 0.0,
            "input_sample_rate_hz": self.input_sample_rate_hz,
            "output_sample_rate_hz": self.output_sample_rate_hz,
        }
        if audio.size == 0:
            return MlResult(kind="audio", samples=audio, sample_rate_hz=sample_rate_hz, stats=stats)

        declared_input = self.input_sample_rate_hz
        target_rate = declared_input if declared_input > 0 else sample_rate_hz
        progress(0.05)
        model_audio = resample_to(audio, sample_rate_hz, target_rate)
        minimum = round(MIN_MODEL_SECONDS * target_rate)
        if model_audio.size < minimum:
            model_audio = np.pad(model_audio, (0, minimum - model_audio.size))

        progress(0.15)
        output, output_rate = self._enhancer.upscale(model_audio, target_rate)
        processed = np.asarray(output, dtype=np.float32)
        if processed.size == 0:
            raise ValueError("model returned no samples")
        if not np.isfinite(processed).all():
            raise ValueError("model returned non-finite samples")
        if output_rate <= 0:
            raise ValueError("model returned an invalid sample rate")
        progress(0.9)
        restored = resample_to(processed, int(output_rate), sample_rate_hz)
        restored = _fit_length(restored, audio.size)
        stats["duration_s"] = float(audio.size / sample_rate_hz)
        progress(1.0)
        return MlResult(
            kind="audio",
            samples=restored,
            sample_rate_hz=sample_rate_hz,
            stats=stats,
        )


class LavaSREnhancer:
    """Thin typed wrapper over the pinned ``audiosronnx`` adapter."""

    def __init__(self, model: Any) -> None:
        self._model = model

    @property
    def input_sample_rate_hz(self) -> int:
        return int(self._model.input_sample_rate)

    @property
    def output_sample_rate_hz(self) -> int:
        return int(self._model.output_sample_rate)

    def upscale(self, samples: np.ndarray, sample_rate_hz: int) -> tuple[np.ndarray, int]:
        output, rate = self._model.upscale(samples, sample_rate_hz)
        return np.asarray(output, dtype=np.float32), int(rate)


def load_lavasr(model_dir: Path) -> SuperresRunner:
    """Load the pinned local LavaSR graphs; heavy imports stay inside this call."""
    try:
        engine = cast(Any, import_module("audiosronnx.engines.lavasr"))
        onnxruntime = cast(Any, import_module("onnxruntime"))
    except ImportError as exc:
        raise ApiError(
            ErrorCode.model_unavailable,
            "audiosronnx/onnxruntime are not installed; install the ml extra",
            503,
        ) from exc

    class LocalLavaSR(engine.LavaSRAdapter):  # type: ignore[name-defined]
        """Use AvaLab's flat per-task cache instead of the package resolver."""

        _backbone: Any = None
        _head: Any = None
        _denoiser: Any = None
        _providers: list[str] | None = None
        _denoise: bool = False

        def __init__(self, directory: Path) -> None:
            super().__init__(denoise=False, providers=["CPUExecutionProvider"])
            self._directory = directory

        def _ensure_models(self) -> None:
            if self._backbone is not None:
                return
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = 1
            providers = self._providers or ["CPUExecutionProvider"]

            def session(filename: str) -> Any:
                path = self._directory / filename
                return onnxruntime.InferenceSession(
                    str(path), sess_options=options, providers=providers
                )

            self._backbone = session("backbone.onnx")
            self._head = session("spec_head.onnx")
            if self._denoise:
                self._denoiser = session("denoiser_core.onnx")

    try:
        model = LocalLavaSR(model_dir)
        model._ensure_models()
    except Exception as exc:
        raise ApiError(ErrorCode.model_unavailable, f"Could not load LavaSR: {exc}", 503) from exc
    return SuperresRunner(LavaSREnhancer(model))


register_runner("superres", load_lavasr)
