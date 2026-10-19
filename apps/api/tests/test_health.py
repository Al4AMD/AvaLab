"""App-level contract tests: health endpoint, stable error body, settings, OpenAPI metadata."""

from pathlib import Path

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from avalab_api.config import Settings, get_settings
from avalab_api.errors import ApiError, ErrorCode
from avalab_api.export_openapi import build_schema
from avalab_api.main import API_PREFIX, API_VERSION, create_app

EXPECTED_ERROR_CODES = {
    "file_too_large",
    "duration_too_long",
    "decode_failed",
    "not_found",
    "range_not_satisfiable",
    "invalid_request",
    "internal_error",
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


def test_openapi_declares_versioned_server_and_server_relative_paths(client: TestClient) -> None:
    schema = client.app.openapi()
    assert schema["servers"] == [{"url": API_PREFIX}]
    assert "/health" in schema["paths"]
    assert f"{API_PREFIX}/health" not in schema["paths"]


def test_served_openapi_paths_match_exporter(client: TestClient) -> None:
    served = client.get("/openapi.json")
    assert served.status_code == 200
    served_paths = set(served.json()["paths"])
    exported_paths = set(build_schema()["paths"])
    assert served_paths == exported_paths
    assert "/health" in served_paths
    assert f"{API_PREFIX}/health" not in served_paths


def test_openapi_declares_error_envelope_responses(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    components = schema["components"]["schemas"]
    assert components["ErrorResponse"]["properties"]["error"] == {
        "$ref": "#/components/schemas/ErrorBody"
    }
    assert components["ErrorBody"]["properties"]["code"]["type"] == "string"
    assert components["ErrorBody"]["properties"]["message"]["type"] == "string"

    def envelope_ref(path: str, method: str, status: str) -> str:
        response = schema["paths"][path][method]["responses"][status]
        return response["content"]["application/json"]["schema"]["$ref"]

    assert envelope_ref("/ingest", "post", "413") == "#/components/schemas/ErrorResponse"
    assert envelope_ref("/audio/{audio_id}", "get", "416") == "#/components/schemas/ErrorResponse"


def test_openapi_422_on_declared_route_is_envelope_not_validation_error(
    client: TestClient,
) -> None:
    schema = client.get("/openapi.json").json()
    ingest_422 = schema["paths"]["/ingest"]["post"]["responses"]["422"]
    assert ingest_422["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorResponse"
    }


def test_unhandled_exception_emits_500_envelope() -> None:
    test_app = create_app()
    router = APIRouter()

    @router.get("/boom")
    def boom() -> None:
        raise OSError("simulated internal failure")

    test_app.include_router(router, prefix=API_PREFIX)
    # The handler sends the 500 envelope; starlette's ServerErrorMiddleware
    # re-raises afterwards, so the client must not re-raise the test exception.
    with TestClient(test_app, raise_server_exceptions=False) as test_client:
        response = test_client.get(f"{API_PREFIX}/boom")

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Internal server error"}
    }
    assert "simulated" not in response.text


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


def test_unknown_route_emits_stable_error_envelope(client: TestClient) -> None:
    response = client.get(f"{API_PREFIX}/no-such-route")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Not Found"}}


def test_invalid_request_emits_stable_error_envelope() -> None:
    test_app = create_app()
    router = APIRouter()

    @router.get("/needs-param")
    def needs_param(required_value: int) -> int:
        return required_value

    test_app.include_router(router, prefix=API_PREFIX)
    with TestClient(test_app) as test_client:
        response = test_client.get(f"{API_PREFIX}/needs-param")

    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "invalid_request", "message": "Request validation failed"}
    }


def test_method_not_allowed_emits_stable_error_envelope_and_allow_header() -> None:
    test_app = create_app()
    router = APIRouter()

    @router.post("/post-only")
    def post_only() -> None:
        return None

    test_app.include_router(router, prefix=API_PREFIX)
    with TestClient(test_app) as test_client:
        response = test_client.get(f"{API_PREFIX}/post-only")

    assert response.status_code == 405
    body = response.json()
    assert "error" in body
    assert body["error"]["code"] == "invalid_request"
    assert "allow" in response.headers
    assert "POST" in response.headers["allow"]


def test_error_code_values_are_stable() -> None:
    assert {code.value for code in ErrorCode} == EXPECTED_ERROR_CODES


def test_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "AVALAB_MAX_UPLOAD_BYTES",
        "AVALAB_MAX_DURATION_SECONDS",
        "AVALAB_MAX_SAMPLE_RATE_HZ",
        "AVALAB_MAX_CHANNELS",
        "AVALAB_TTL_MINUTES",
        "AVALAB_TTL_SWEEP_INTERVAL_SECONDS",
        "AVALAB_STORAGE_DIR",
        "AVALAB_CORS_ORIGINS",
    ):
        monkeypatch.delenv(key, raising=False)
    settings = Settings(_env_file=None)
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
