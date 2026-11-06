"""htdemucs source-separation adapter (Wave-5 Plan 03 Task 1).

The pinned Demucs 4.1 bag is loaded from the flat local cache, not the
HuggingFace cache. Demucs expects a stereo 44.1 kHz mixture, so the job
manager's mono input is resampled and duplicated; each returned stem is
downmixed, restored to the source rate, and trimmed/padded to the input
length so all stems stay aligned with the original for A/B playback.
"""

from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast

import numpy as np
from pydantic import BaseModel

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.audio import resample_to
from avalab_api.ml.jobs import MlResult, StemResult
from avalab_api.ml.registry import register_runner
from avalab_api.ml.runtime import torch_device

MODEL_ID = "adefossez/HTDemucs"
MODEL_RATE_HZ = 44_100
MODEL_YAML = "htdemucs.yaml"
STEM_ORDER = ("drums", "bass", "other", "vocals")


class SeparationParams(BaseModel):
    """htdemucs currently has no tunable parameters in the UI."""


class SeparationBackend(Protocol):
    """Minimal seam over a Demucs bag-of-models."""

    @property
    def sample_rate(self) -> int:
        """Model sample rate in Hz."""

    @property
    def sources(self) -> tuple[str, ...]:
        """Source names in the model's output order."""

    def separate(self, samples: np.ndarray) -> np.ndarray:
        """Return ``(sources, channels, samples)`` for a stereo input."""


def _fit_length(samples: np.ndarray, sample_count: int) -> np.ndarray:
    if samples.size >= sample_count:
        return np.ascontiguousarray(samples[:sample_count], dtype=np.float32)
    return np.pad(samples, (0, sample_count - samples.size)).astype(np.float32, copy=False)


class SeparationRunner:
    """Mono -> stereo htdemucs -> four mono stems at the source rate."""

    def __init__(self, separator: SeparationBackend) -> None:
        self._separator = separator

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
            "duration_s": float(audio.size / sample_rate_hz),
            "stems": list(STEM_ORDER),
        }
        if audio.size == 0:
            return MlResult(
                kind="stems",
                stems=[StemResult(name, audio, sample_rate_hz) for name in STEM_ORDER],
                stats=stats,
            )

        model_rate = int(self._separator.sample_rate)
        progress(0.05)
        model_audio = resample_to(audio, sample_rate_hz, model_rate)
        stereo = np.stack([model_audio, model_audio])
        progress(0.15)
        try:
            separated = np.asarray(self._separator.separate(stereo), dtype=np.float32)
        except Exception as exc:
            raise ApiError(ErrorCode.ml_failed, f"Separation failed: {exc}", 500) from exc

        sources = tuple(self._separator.sources)
        if separated.ndim != 3 or separated.shape[0] < len(STEM_ORDER):
            raise ApiError(
                ErrorCode.ml_failed,
                f"Separator returned {separated.shape[0] if separated.ndim else 0} stems",
                500,
            )
        if not np.isfinite(separated).all():
            raise ApiError(ErrorCode.ml_failed, "Separator returned non-finite samples", 500)

        index = {name: position for position, name in enumerate(sources)}
        missing = [name for name in STEM_ORDER if name not in index]
        if missing:
            raise ApiError(
                ErrorCode.ml_failed,
                f"Separator is missing stems: {', '.join(missing)}",
                500,
            )

        stems: list[StemResult] = []
        for name in STEM_ORDER:
            stem = separated[index[name]]
            mono = stem.mean(axis=0) if stem.ndim == 2 else stem
            restored = resample_to(np.asarray(mono, dtype=np.float32), model_rate, sample_rate_hz)
            stems.append(
                StemResult(name, _fit_length(restored, audio.size), sample_rate_hz)
            )
        progress(1.0)
        return MlResult(kind="stems", stems=stems, stats=stats)


class DemucsBackend:
    """Thin wrapper over the pinned Demucs bag."""

    def __init__(self, model: Any) -> None:
        self._model = model

    @property
    def sample_rate(self) -> int:
        return int(self._model.samplerate)

    @property
    def sources(self) -> tuple[str, ...]:
        return tuple(str(name) for name in self._model.sources)

    def separate(self, samples: np.ndarray) -> np.ndarray:
        torch = cast(Any, import_module("torch"))
        apply = cast(Any, import_module("demucs.apply"))
        with torch.no_grad():
            mixture = torch.from_numpy(np.ascontiguousarray(samples, dtype=np.float32))
            output = apply.apply_model(
                self._model,
                mixture.unsqueeze(0),
                device=torch_device(),
                progress=False,
            )[0]
        return np.asarray(output.detach().cpu().numpy(), dtype=np.float32)


def load_demucs(model_dir: Path) -> SeparationRunner:
    """Load the pinned bag from ``htdemucs.yaml`` and its safetensors files."""
    try:
        yaml = cast(Any, import_module("yaml"))
        demucs_hf = cast(Any, import_module("demucs.hf"))
        demucs_apply = cast(Any, import_module("demucs.apply"))
    except ImportError as exc:
        raise ApiError(
            ErrorCode.model_unavailable,
            "demucs is not installed; install the ml extra",
            503,
        ) from exc

    try:
        config = yaml.safe_load((model_dir / MODEL_YAML).read_text(encoding="utf-8"))
        signatures = config["models"]
        models = [
            demucs_hf.load_safetensors_model(model_dir / f"{signature}.safetensors")
            for signature in signatures
        ]
        model = demucs_apply.BagOfModels(models, config.get("weights"), config.get("segment"))
        model.eval()
    except Exception as exc:
        raise ApiError(ErrorCode.model_unavailable, f"Could not load htdemucs: {exc}", 503) from exc
    return SeparationRunner(DemucsBackend(model))


register_runner("separation", load_demucs)
