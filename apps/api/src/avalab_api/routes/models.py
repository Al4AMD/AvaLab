"""GET /api/v1/models — pinned model availability for the AI lab."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from avalab_api.config import Settings, get_settings
from avalab_api.ml.models import MODEL_SPECS, MlTask, ModelState
from avalab_api.ml.registry import ModelRegistry

router = APIRouter()


class ModelInfo(BaseModel):
    """One model row rendered by the AI lab model-status banner."""

    task: MlTask
    model_id: str
    revision: str
    license: str
    size_bytes: int
    state: ModelState


class ModelsResponse(BaseModel):
    """All five fixed tasks, in stable order."""

    models: list[ModelInfo]


@router.get("/models")
def list_models(settings: Annotated[Settings, Depends(get_settings)]) -> ModelsResponse:
    """Report local availability without importing any ML backend."""
    registry = ModelRegistry(settings.ml_model_cache_dir)
    return ModelsResponse(
        models=[
            ModelInfo(
                task=(status := registry.status(task)).task,
                model_id=status.model_id,
                revision=status.revision,
                license=status.license,
                size_bytes=status.size_bytes,
                state=status.state,
            )
            for task in MODEL_SPECS
        ]
    )
