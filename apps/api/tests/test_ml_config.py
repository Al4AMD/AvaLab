"""ML settings and stable error codes (Wave-5 Plan 01 Task 2)."""

from __future__ import annotations

from pathlib import Path

from pytest import MonkeyPatch

from avalab_api.config import Settings
from avalab_api.errors import ErrorCode


def test_ml_settings_defaults(monkeypatch: MonkeyPatch) -> None:
    for name in (
        "AVALAB_ML_ENABLED",
        "AVALAB_ML_MAX_CONCURRENCY",
        "AVALAB_ML_MAX_EXCERPT_SECONDS",
        "AVALAB_ML_MODEL_CACHE_DIR",
        "AVALAB_ML_DEVICE",
    ):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.ml_enabled is True
    assert settings.ml_max_concurrency == 1
    assert settings.ml_max_excerpt_seconds == 30
    assert settings.ml_model_cache_dir == Path.home() / ".cache" / "avalab" / "models"
    assert settings.ml_device == "cpu"


def test_ml_settings_env_overrides(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AVALAB_ML_MAX_EXCERPT_SECONDS", "10")
    monkeypatch.setenv("AVALAB_ML_MAX_CONCURRENCY", "2")
    monkeypatch.setenv("AVALAB_ML_ENABLED", "false")
    monkeypatch.setenv("AVALAB_ML_DEVICE", "cuda")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.ml_max_excerpt_seconds == 10
    assert settings.ml_max_concurrency == 2
    assert settings.ml_enabled is False
    assert settings.ml_device == "cuda"


def test_ml_error_codes_serialize_as_strings() -> None:
    assert ErrorCode.model_unavailable == "model_unavailable"
    assert ErrorCode.job_not_found == "job_not_found"
    assert ErrorCode.job_cancelled == "job_cancelled"
    assert ErrorCode.ml_failed == "ml_failed"
    assert ErrorCode.ml_busy == "ml_busy"
