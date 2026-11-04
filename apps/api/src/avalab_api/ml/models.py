"""Pinned model metadata and the runner contract.

No model backend is imported here: the registry must stay cheap for ``GET
/models`` and for test collection. Sizes are the sum of the listed files, not
the upstream parameter size.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np

MlTask = Literal["denoise", "superres", "separation", "asr", "neural_codec"]
ModelState = Literal["available", "missing", "loading", "error"]


@dataclass(frozen=True)
class ModelSpec:
    """One pinned model revision and the files needed for offline use."""

    task: MlTask
    model_id: str
    revision: str
    license: str
    size_bytes: int
    files: tuple[str, ...]
    loader_name: str


@dataclass(frozen=True)
class ModelStatus:
    """Current local availability of a model without importing its backend."""

    task: MlTask
    state: ModelState
    model_id: str
    revision: str
    license: str
    size_bytes: int


class ModelRunner(Protocol):
    """A loaded model backend that processes mono float32 audio."""

    def run(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        params: dict[str, object],
        progress: Callable[[float], None],
    ) -> object:
        """Process ``samples`` and report progress in the range 0..1."""


MODEL_SPECS: dict[MlTask, ModelSpec] = {
    "denoise": ModelSpec(
        task="denoise",
        model_id="Ceva-IP/DPDFNet",
        revision="dd6818d00f50c836fed43a6243ebe49116de5964",
        license="Apache-2.0",
        size_bytes=10_493_337,
        files=("onnx/dpdfnet2_48khz_hr.onnx",),
        loader_name="sherpa_onnx_dpdfnet",
    ),
    "superres": ModelSpec(
        task="superres",
        model_id="TigreGotico/audiosronnx-lavasr",
        revision="b3df8a262cf44e59bf84a40b7084f4479ca566b4",
        license="Apache-2.0",
        size_bytes=57_143_745,
        files=("backbone.onnx", "spec_head.onnx", "denoiser_core.onnx"),
        loader_name="audiosronnx_lavasr",
    ),
    "separation": ModelSpec(
        task="separation",
        model_id="adefossez/HTDemucs",
        revision="cbc8a9b1a87023b7fd74e7b3412e6321c0eab003",
        license="MIT",
        size_bytes=84_025_461,
        files=("htdemucs.yaml", "955717e8.safetensors"),
        loader_name="demucs_htdemucs",
    ),
    "asr": ModelSpec(
        task="asr",
        model_id="openai/whisper-tiny",
        revision="169d4a4341b33bc18d8881c4b69c2e104e1cc0af",
        license="Apache-2.0",
        size_bytes=155_434_424,
        files=(
            "config.json",
            "generation_config.json",
            "model.safetensors",
            "preprocessor_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "vocab.json",
            "merges.txt",
            "special_tokens_map.json",
            "normalizer.json",
            "added_tokens.json",
        ),
        loader_name="transformers_whisper",
    ),
    "neural_codec": ModelSpec(
        task="neural_codec",
        model_id="facebook/encodec_48khz",
        revision="c3def8e7185ac8c8efdce6eb8c4a651e487a503e",
        license="MIT",
        size_bytes=76_292_186,
        files=("config.json", "model.safetensors", "preprocessor_config.json"),
        loader_name="transformers_encodec",
    ),
}
