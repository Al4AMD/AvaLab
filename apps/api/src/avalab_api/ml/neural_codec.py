"""Encodec neural-codec adapter (Wave-5 Plan 03 Task 5).

Encodec is a learned codec, so this adapter is an A/B tool rather than a
bit-exact codec: the mono input is resampled to the model's 48 kHz, encoded
and decoded at one of Encodec's target bandwidths, then restored to the source
rate and exact input length. The compressed stream is never written to disk;
``estimated_size_bytes`` is derived from the requested bandwidth and source
duration and must be labelled as an estimate in the UI.
"""

from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from typing import Any, Literal, Protocol, cast

import numpy as np
from pydantic import BaseModel

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.audio import resample_to
from avalab_api.ml.jobs import MlResult
from avalab_api.ml.registry import register_runner

MODEL_ID = "facebook/encodec_48khz"
MODEL_RATE_HZ = 48_000
BandwidthKbps = Literal[1.5, 3.0, 6.0, 12.0, 24.0]  # type: ignore[valid-type]  # typing excludes float Literal args; Pydantic validates the five targets.


class NeuralCodecParams(BaseModel):
    """Encodec target bandwidth; 48 kHz checkpoints support these five."""

    bandwidth_kbps: BandwidthKbps = 6.0


class EncodecBackend(Protocol):
    """Minimal seam over one Encodec model/processor pair."""

    @property
    def sample_rate_hz(self) -> int:
        """Model input sample rate in Hz."""

    def roundtrip(self, samples: np.ndarray, bandwidth_kbps: float) -> np.ndarray:
        """Encode then decode mono samples at the model rate."""


def _fit_length(samples: np.ndarray, sample_count: int) -> np.ndarray:
    if samples.size >= sample_count:
        return np.ascontiguousarray(samples[:sample_count], dtype=np.float32)
    return np.pad(samples, (0, sample_count - samples.size)).astype(np.float32, copy=False)


class NeuralCodecRunner:
    """Resample -> Encodec round-trip -> source rate/length restoration."""

    def __init__(self, backend: EncodecBackend) -> None:
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

        bandwidth_kbps = float(NeuralCodecParams.model_validate(params).bandwidth_kbps)
        duration_s = float(audio.size / sample_rate_hz)
        stats: dict[str, object] = {
            "model_id": MODEL_ID,
            "bandwidth_kbps": bandwidth_kbps,
            "estimated_size_bytes": bandwidth_kbps * 1000 / 8 * duration_s,
            "estimated_bitrate_kbps": bandwidth_kbps,
            "duration_s": duration_s,
        }
        if audio.size == 0:
            progress(1.0)
            return MlResult(
                kind="audio",
                samples=audio,
                sample_rate_hz=sample_rate_hz,
                stats=stats,
            )

        model_rate = int(self._backend.sample_rate_hz)
        if model_rate <= 0:
            raise ValueError("model returned an invalid sample rate")
        progress(0.05)
        model_audio = resample_to(audio, sample_rate_hz, model_rate)
        progress(0.15)
        processed = np.asarray(self._backend.roundtrip(model_audio, bandwidth_kbps), dtype=np.float32)
        if processed.size == 0:
            raise ValueError("model returned no samples")
        if not np.isfinite(processed).all():
            raise ValueError("model returned non-finite samples")
        progress(0.9)
        restored = _fit_length(resample_to(processed, model_rate, sample_rate_hz), audio.size)
        progress(1.0)
        return MlResult(
            kind="audio",
            samples=restored,
            sample_rate_hz=sample_rate_hz,
            stats=stats,
        )


class TransformersEncodecBackend:
    """Thin typed wrapper over a pinned Transformers Encodec model."""

    def __init__(self, model: Any, processor: Any) -> None:
        self._model = model
        self._processor = processor

    @property
    def sample_rate_hz(self) -> int:
        feature_extractor = getattr(self._processor, "feature_extractor", None)
        rate = getattr(feature_extractor, "sampling_rate", None)
        if isinstance(rate, int) and rate > 0:
            return rate
        return MODEL_RATE_HZ

    def roundtrip(self, samples: np.ndarray, bandwidth_kbps: float) -> np.ndarray:
        torch = cast(Any, import_module("torch"))
        mono = np.ascontiguousarray(samples, dtype=np.float32)
        stereo = np.stack([mono, mono])
        inputs = self._processor(
            raw_audio=stereo,
            sampling_rate=self.sample_rate_hz,
            return_tensors="pt",
        )
        input_values = inputs["input_values"]
        padding_mask = inputs.get("padding_mask")
        with torch.no_grad():
            encoded = self._model.encode(
                input_values,
                padding_mask=padding_mask,
                bandwidth=float(bandwidth_kbps),
                return_dict=True,
            )
            decoded = self._model.decode(
                encoded.audio_codes,
                encoded.audio_scales,
                padding_mask=padding_mask,
                return_dict=True,
                last_frame_pad_length=getattr(encoded, "last_frame_pad_length", 0) or 0,
            )
        audio = decoded.audio_values[0].detach().cpu().numpy()
        array = np.asarray(audio, dtype=np.float32)
        if array.ndim == 2:
            array = array.mean(axis=0)
        return np.ascontiguousarray(array, dtype=np.float32)


def load_encodec(model_dir: Path) -> NeuralCodecRunner:
    """Load the pinned Encodec files; heavy imports stay inside this call."""
    try:
        transformers = cast(Any, import_module("transformers"))
    except ImportError as exc:
        raise ApiError(
            ErrorCode.model_unavailable,
            "transformers is not installed; install the ml extra",
            503,
        ) from exc

    try:
        processor = transformers.AutoProcessor.from_pretrained(
            str(model_dir), local_files_only=True
        )
        model = transformers.EncodecModel.from_pretrained(
            str(model_dir), local_files_only=True
        )
        model.eval()
    except Exception as exc:
        raise ApiError(ErrorCode.model_unavailable, f"Could not load Encodec: {exc}", 503) from exc
    return NeuralCodecRunner(TransformersEncodecBackend(model, processor))


register_runner("neural_codec", load_encodec)
