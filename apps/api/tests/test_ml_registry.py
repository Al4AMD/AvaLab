"""Model registry: status, require failure and /models coverage."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from avalab_api.errors import ApiError, ErrorCode
from avalab_api.main import create_app
from avalab_api.ml.models import MODEL_SPECS, ModelSpec
from avalab_api.ml.registry import ModelRegistry


def test_all_tasks_have_pinned_specs() -> None:
    assert set(MODEL_SPECS) == {
        "denoise",
        "superres",
        "separation",
        "asr",
        "neural_codec",
    }
    for spec in MODEL_SPECS.values():
        assert spec.model_id
        assert len(spec.revision) == 40
        assert spec.files


def test_missing_models_report_missing(tmp_path: Path) -> None:
    registry = ModelRegistry(tmp_path)
    for task in MODEL_SPECS:
        status = registry.status(task)
        assert status.state == "missing"
        assert status.task == task
        assert status.model_id == MODEL_SPECS[task].model_id


def test_existing_files_report_available(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    spec = ModelSpec(
        task="denoise",
        model_id="example/test",
        revision="a" * 40,
        license="Apache-2.0",
        size_bytes=1,
        files=("model.onnx",),
        loader_name="test",
    )
    (tmp_path / "denoise").mkdir()
    (tmp_path / "denoise" / "model.onnx").write_bytes(b"x")
    monkeypatch.setitem(MODEL_SPECS, "denoise", spec)

    status = ModelRegistry(tmp_path).status("denoise")

    assert status.state == "available"
    assert status.size_bytes == 1


def test_require_missing_model_raises_model_unavailable(tmp_path: Path) -> None:
    registry = ModelRegistry(tmp_path)
    with pytest.raises(ApiError) as exc_info:
        registry.require("denoise")
    assert exc_info.value.code is ErrorCode.model_unavailable
    assert exc_info.value.status_code == 503


def test_models_route_lists_every_task() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/models")

    assert response.status_code == 200
    body = response.json()
    assert [item["task"] for item in body["models"]] == list(MODEL_SPECS)
    for item in body["models"]:
        assert item["state"] in {"available", "missing", "loading", "error"}
        assert item["revision"] == MODEL_SPECS[item["task"]].revision
        assert isinstance(item["size_bytes"], int)
