"""App-level contract tests: health endpoint, stable error body, settings, OpenAPI metadata."""

from pathlib import Path

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode
from avalab_api.main import API_PREFIX, API_VERSION, create_app

EXPECTED_ERROR_CODES = {
    "file_too_large",
    "duration_too_long",
    "decode_failed",
    "not_found",
    "range_not_satisfiable",
    "invalid_request",
}


def test_health_returns_ok_with_exact_keys(client: TestClient) -> None:
    response = client.get(f"{API_PREFIX}/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == API_VERSION
    assert isinstance(body["ffmpeg"], bool)
    assert set(body) == {"status", "version", "ffmpeg"}


def test_health_reports_ffmpeg_missing(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda _name: None)
    response = client.get(f"{API_PREFIX}/health")
    assert response.status_code == 200
    assert response.json()["ffmpeg"] is False


def test_openapi_declares_versioned_server_and_health_path(client: TestClient) -> None:
    schema = client.app.openapi()
    assert schema["servers"] == [{"url": API_PREFIX}]
    assert f"{API_PREFIX}/health" in schema["paths"]


def test_api_error_handler_emits_stable_body() -> None:
    test_app = create_app()
    router = APIRouter()

    @router.get("/explode")
    def explode() -> None:
        raise ApiError(ErrorCode.invalid_request, "bad request", 400)

    test_app.include_router(router, prefix=API_PREFIX)
    with TestClient(test_app) as test_client:
        response = test_client.get(f"{API_PREFIX}/explode")

    assert response.status_code == 400
    assert response.json() == {"error": {"code": "invalid_request", "message": "bad request"}}


def test_error_code_values_are_stable() -> None:
    assert {code.value for code in ErrorCode} == EXPECTED_ERROR_CODES


def test_settings_defaults() -> None:
    settings = Settings()
    assert settings.max_upload_bytes == 104857600
    assert settings.max_duration_seconds == 300
    assert settings.max_sample_rate_hz == 96000
    assert settings.max_channels == 2
    assert settings.ttl_minutes == 60
    assert settings.ttl_sweep_interval_seconds == 60
    assert settings.storage_dir == Path("storage")
    assert settings.cors_origins == []


def test_settings_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AVALAB_MAX_UPLOAD_BYTES", "1024")
    monkeypatch.setenv("AVALAB_STORAGE_DIR", "/tmp/avalab-test")
    monkeypatch.setenv("AVALAB_CORS_ORIGINS", '["http://localhost:5173"]')
    get_settings.cache_clear()
    try:
        settings = get_settings()
        assert settings.max_upload_bytes == 1024
        assert settings.storage_dir == Path("/tmp/avalab-test")
        assert settings.cors_origins == ["http://localhost:5173"]
    finally:
        get_settings.cache_clear()
