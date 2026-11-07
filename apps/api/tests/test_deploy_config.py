"""Deployment environment settings and public-origin CORS wiring (Plan 06 Task 1)."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pydantic_settings import SettingsError

from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError
from avalab_api.main import create_app
from avalab_api.ml import runtime
from avalab_api.ml.runtime import onnx_providers, torch_device

DEPLOY_ENV_NAMES = (
    "AVALAB_ML_ENABLED",
    "AVALAB_ML_MAX_CONCURRENCY",
    "AVALAB_ML_MAX_EXCERPT_SECONDS",
    "AVALAB_ML_DEVICE",
    "AVALAB_ML_MODEL_CACHE_DIR",
    "AVALAB_CORS_ORIGINS",
    "AVALAB_PUBLIC_ORIGIN",
    "AVALAB_STORAGE_DIR",
)


def test_deployment_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in DEPLOY_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)

    settings = Settings(_env_file=None)  # type: ignore[call-arg]

    assert settings.ml_enabled is True
    assert settings.ml_max_concurrency == 1
    assert settings.ml_max_excerpt_seconds == 30
    assert settings.ml_device == "cpu"
    assert settings.ml_model_cache_dir == Path.home() / ".cache" / "avalab" / "models"
    assert settings.cors_origins == []
    assert settings.public_origin == ""


def test_deployment_settings_read_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AVALAB_ML_ENABLED", "false")
    monkeypatch.setenv("AVALAB_ML_MAX_CONCURRENCY", "2")
    monkeypatch.setenv("AVALAB_ML_MAX_EXCERPT_SECONDS", "45")
    monkeypatch.setenv("AVALAB_ML_DEVICE", "cuda")
    monkeypatch.setenv("AVALAB_ML_MODEL_CACHE_DIR", "/models")
    monkeypatch.setenv("AVALAB_CORS_ORIGINS", '["https://lab.example"]')
    monkeypatch.setenv("AVALAB_PUBLIC_ORIGIN", "https://avalab.example")

    settings = Settings(_env_file=None)  # type: ignore[call-arg]

    assert settings.ml_enabled is False
    assert settings.ml_max_concurrency == 2
    assert settings.ml_max_excerpt_seconds == 45
    assert settings.ml_device == "cuda"
    assert settings.ml_model_cache_dir == Path("/models")
    assert settings.cors_origins == ["https://lab.example"]
    assert settings.public_origin == "https://avalab.example"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://avalab.example/", "https://avalab.example"),
        ("HTTPS://AvaLab.Example:443/", "https://avalab.example"),
        ("http://AvaLab.Example:80", "http://avalab.example"),
        ("https://avalab.example:8443/", "https://avalab.example:8443"),
        ("https://[::1]:8443", "https://[::1]:8443"),
    ],
)
def test_public_origin_is_canonicalized(
    monkeypatch: pytest.MonkeyPatch, value: str, expected: str
) -> None:
    monkeypatch.setenv("AVALAB_PUBLIC_ORIGIN", value)
    settings = Settings(_env_file=None)  # type: ignore[call-arg]

    assert settings.public_origin == expected


@pytest.mark.parametrize(
    "origin",
    [
        "avalab.example",
        "ftp://avalab.example",
        "https://avalab.example/app",
        "https://avalab.example:bad",
        "https://user@avalab.example",
        "https://avalab.example?",
        "https://avalab.example#",
        "https:\\\\avalab.example",
    ],
)
def test_public_origin_rejects_non_origin_values(
    monkeypatch: pytest.MonkeyPatch, origin: str
) -> None:
    monkeypatch.setenv("AVALAB_PUBLIC_ORIGIN", origin)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_public_origin_is_appended_to_cors(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("AVALAB_STORAGE_DIR", str(tmp_path))
    monkeypatch.setenv("AVALAB_CORS_ORIGINS", '["https://lab.example"]')
    monkeypatch.setenv("AVALAB_PUBLIC_ORIGIN", "https://avalab.example/")
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as client:
            public = client.get(
                "/api/v1/health", headers={"Origin": "https://avalab.example"}
            )
            listed = client.get(
                "/api/v1/health", headers={"Origin": "https://lab.example"}
            )
            unlisted = client.get(
                "/api/v1/health", headers={"Origin": "https://other.example"}
            )
    finally:
        get_settings.cache_clear()

    assert public.headers["access-control-allow-origin"] == "https://avalab.example"
    assert listed.headers["access-control-allow-origin"] == "https://lab.example"
    assert "access-control-allow-origin" not in unlisted.headers


def test_deployment_settings_reject_invalid_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AVALAB_ML_MAX_CONCURRENCY", "not-an-integer")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)  # type: ignore[call-arg]

    monkeypatch.setenv("AVALAB_ML_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("AVALAB_CORS_ORIGINS", "not-json")
    with pytest.raises(SettingsError):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_deployment_settings_reject_out_of_range_concurrency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AVALAB_ML_MAX_CONCURRENCY", "0")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_deployment_settings_reject_out_of_range_excerpt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AVALAB_ML_MAX_EXCERPT_SECONDS", "0")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)  # type: ignore[call-arg]


def _download_models_module() -> ModuleType:
    script = Path(__file__).parents[1] / "scripts" / "download_models.py"
    spec = importlib.util.spec_from_file_location("download_models", script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_download_models_uses_configured_cache_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("AVALAB_ML_MODEL_CACHE_DIR", str(tmp_path))
    get_settings.cache_clear()
    try:
        args = _download_models_module()._parser().parse_args([])
    finally:
        get_settings.cache_clear()

    assert args.cache_dir == tmp_path


def test_torch_device_uses_cpu_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AVALAB_ML_DEVICE", raising=False)
    get_settings.cache_clear()
    try:
        assert torch_device() == "cpu"
    finally:
        get_settings.cache_clear()


def test_torch_device_rejects_unavailable_cuda(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AVALAB_ML_DEVICE", "cuda")
    get_settings.cache_clear()
    monkeypatch.setattr(
        runtime,
        "import_module",
        lambda _name: SimpleNamespace(
            cuda=SimpleNamespace(is_available=lambda: False)
        ),
    )
    try:
        with pytest.raises(ApiError):
            torch_device()
    finally:
        get_settings.cache_clear()


def test_onnx_providers_fall_back_to_cpu_without_cuda(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AVALAB_ML_DEVICE", "cuda")
    get_settings.cache_clear()
    try:
        assert onnx_providers(["CPUExecutionProvider"]) == ["CPUExecutionProvider"]
        assert onnx_providers(
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
        ) == ["CUDAExecutionProvider", "CPUExecutionProvider"]
    finally:
        get_settings.cache_clear()
