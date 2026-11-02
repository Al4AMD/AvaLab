"""DPDFNet speech denoiser adapter (Wave-5 Plan 02 Task 1).

The model is a 48 kHz ONNX graph run through ``sherpa-onnx``. The adapter
resamples the source to 48 kHz, runs one denoise pass, resamples back to the
source rate, and trims/pads to the original sample count so A/B playback stays
aligned. The backend is imported lazily: the default API install can import
this module and report ``model_unavailable`` without the ML extra.
"""

from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast

import numpy as np

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.audio import resample_to
from avalab_api.ml.jobs import MlResult
from avalab_api.ml.models import MODEL_SPECS
from avalab_api.ml.registry import register_runner

MODEL_RATE_HZ = 48_000
MIN_MODEL_SECONDS = 0.2
SILENT_DB = -120.0


class DenoiseBackend(Protocol):
    """Minimal seam over ``sherpa_onnx.OfflineSpeechDenoiser``."""

    @property
    def sample_rate(self) -> int:
        """Model sample rate in Hz."""

    def run(self, samples: np.ndarray, sample_rate_hz: int) -> Any:
        """Return an object with ``samples`` and ``sample_rate``."""


def _rms_db(samples: np.ndarray) -> float:
    if samples.size == 0:
        return SILENT_DB
    power = float(np.mean(np.square(samples, dtype=np.float64)))
    if power <= 0.0 or not np.isfinite(power):
        return SILENT_DB
    return float(10.0 * np.log10(power))


def _fit_length(samples: np.ndarray, sample_count: int) -> np.ndarray:
    if samples.size >= sample_count:
        return np.ascontiguousarray(samples[:sample_count], dtype=np.float32)
    return np.pad(samples, (0, sample_count - samples.size)).astype(np.float32, copy=False)


class DenoiseRunner:
    """Resample -> DPDFNet -> resample-back runner with a strict length contract."""

    def __init__(self, denoiser: DenoiseBackend) -> None:
        self._denoiser = denoiser

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
        if audio.size == 0:
            return MlResult(
                kind="audio",
                samples=audio,
                sample_rate_hz=sample_rate_hz,
                stats={"model_id": "Ceva-IP/DPDFNet", "duration_s": 0.0, "rms_in_db": SILENT_DB,
                       "rms_out_db": SILENT_DB},
            )

        progress(0.05)
        model_rate = int(self._denoiser.sample_rate)
        model_audio = resample_to(audio, sample_rate_hz, model_rate)
        minimum = round(MIN_MODEL_SECONDS * model_rate)
        if model_audio.size < minimum:
            model_audio = np.pad(model_audio, (0, minimum - model_audio.size))

        progress(0.15)
        output = self._denoiser.run(model_audio, model_rate)
        progress(0.85)
        denoised = np.asarray(output.samples, dtype=np.float32)
        if not np.isfinite(denoised).all():
            raise ValueError("model returned non-finite samples")
        output_rate = int(getattr(output, "sample_rate", model_rate))
        restored = resample_to(denoised, output_rate, sample_rate_hz)
        restored = _fit_length(restored, audio.size)
        progress(1.0)
        return MlResult(
            kind="audio",
            samples=restored,
            sample_rate_hz=sample_rate_hz,
            stats={
                "model_id": "Ceva-IP/DPDFNet",
                "duration_s": float(audio.size / sample_rate_hz),
                "rms_in_db": _rms_db(audio),
                "rms_out_db": _rms_db(restored),
            },
        )


def load_dpdfnet(model_dir: Path) -> DenoiseRunner:
    """Load the pinned DPDFNet graph; heavy import stays inside this call."""
    try:
        sherpa_onnx = cast(Any, import_module("sherpa_onnx"))
    except ImportError as exc:
        raise ApiError(
            ErrorCode.model_unavailable,
            "sherpa-onnx is not installed; install the ml extra",
            503,
        ) from exc

    spec = MODEL_SPECS["denoise"]
    path = model_dir / spec.files[0]
    config = sherpa_onnx.OfflineSpeechDenoiserConfig()
    config.model.dpdfnet.model = str(path)
    config.model.num_threads = 1
    try:
        denoiser = sherpa_onnx.OfflineSpeechDenoiser(config)
    except (RuntimeError, ValueError) as exc:
        raise ApiError(ErrorCode.model_unavailable, f"Could not load DPDFNet: {exc}", 503) from exc
    return DenoiseRunner(cast(DenoiseBackend, denoiser))


register_runner("denoise", load_dpdfnet)
