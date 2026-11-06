"""Device selection shared by lazy ML runner factories."""

from collections.abc import Iterable
from importlib import import_module
from typing import Any, cast

from avalab_api.config import get_settings
from avalab_api.errors import ApiError, ErrorCode

SUPPORTED_DEVICES = {"cpu", "cuda"}


def torch_device() -> str:
    """Return the requested PyTorch device, failing if CUDA is unavailable."""
    device = get_settings().ml_device
    if device not in SUPPORTED_DEVICES:
        raise ApiError(
            ErrorCode.model_unavailable,
            f"Unsupported AVALAB_ML_DEVICE value: {device}",
            503,
        )
    if device == "cpu":
        return device
    torch = cast(Any, import_module("torch"))
    if not torch.cuda.is_available():
        raise ApiError(
            ErrorCode.model_unavailable,
            "AVALAB_ML_DEVICE=cuda but torch.cuda is unavailable",
            503,
        )
    return device


def onnx_providers(available: Iterable[str]) -> list[str]:
    """Prefer CUDA for ONNX graphs only when the runtime provides it."""
    installed = set(available)
    if get_settings().ml_device == "cuda" and "CUDAExecutionProvider" in installed:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]
