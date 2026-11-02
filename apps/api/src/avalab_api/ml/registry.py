"""Filesystem-backed model registry and runner factory hooks."""

from collections.abc import Callable
from pathlib import Path

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.ml.models import (
    MODEL_SPECS,
    MlTask,
    ModelRunner,
    ModelSpec,
    ModelState,
    ModelStatus,
)

RunnerFactory = Callable[[Path], ModelRunner]

_RUNNER_FACTORIES: dict[MlTask, RunnerFactory] = {}


def register_runner(task: MlTask, factory: RunnerFactory) -> None:
    """Register a lazy backend factory; model modules call this on import."""
    _RUNNER_FACTORIES[task] = factory


def model_dir(cache_dir: Path, task: MlTask) -> Path:
    """Flat per-task directory populated by ``scripts/download_models.py``."""
    return cache_dir / task


def model_state(cache_dir: Path, spec: ModelSpec) -> ModelState:
    """Return ``available`` only when every pinned file exists."""
    directory = model_dir(cache_dir, spec.task)
    return "available" if all((directory / name).is_file() for name in spec.files) else "missing"


class ModelRegistry:
    """Resolve pinned specs against one cache directory; no heavy imports."""

    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir

    def status(self, task: MlTask) -> ModelStatus:
        spec = MODEL_SPECS[task]
        return ModelStatus(
            task=task,
            state=model_state(self.cache_dir, spec),
            model_id=spec.model_id,
            revision=spec.revision,
            license=spec.license,
            size_bytes=spec.size_bytes,
        )

    def require(self, task: MlTask) -> ModelRunner:
        """Load a runner or raise a stable 503 when files/backend are absent."""
        spec = MODEL_SPECS[task]
        if model_state(self.cache_dir, spec) != "available":
            raise ApiError(
                ErrorCode.model_unavailable,
                f"Model {task} is not downloaded",
                503,
            )
        factory = _RUNNER_FACTORIES.get(task)
        if factory is None:
            raise ApiError(
                ErrorCode.model_unavailable,
                f"Model backend for {task} is not installed",
                503,
            )
        return factory(model_dir(self.cache_dir, task))
