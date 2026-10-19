"""FastAPI application factory. All routes live under the /api/v1 prefix."""

import asyncio
import contextlib
import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from avalab_api.config import get_settings
from avalab_api.errors import ApiError, ErrorCode
from avalab_api.openapi_utils import server_relative_schema
from avalab_api.routes.audio import router as audio_router
from avalab_api.routes.ingest import router as ingest_router
from avalab_api.storage import Storage
from avalab_api.ttl import SWEEPER_TASK_NAME, sweep_loop
from avalab_api.upload_limit import UploadLimitMiddleware

API_PREFIX = "/api/v1"
API_VERSION = "0.1.0"

# Statuses raised by framework internals (FileResponse ranges, routing) that
# must surface as specific machine-readable codes instead of invalid_request.
_HTTP_STATUS_TO_ERROR_CODE = {
    404: ErrorCode.not_found,
    416: ErrorCode.range_not_satisfiable,
}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start the TTL sweeper on startup; cancel and await it on shutdown."""
    settings = get_settings()
    sweeper = asyncio.create_task(
        sweep_loop(
            Storage(settings.storage_dir),
            ttl_seconds=settings.ttl_minutes * 60,
            interval_seconds=settings.ttl_sweep_interval_seconds,
        ),
        name=SWEEPER_TASK_NAME,
    )
    try:
        yield
    finally:
        sweeper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweeper


class HealthResponse(BaseModel):
    """Health payload: service status, API version, ffmpeg availability."""

    status: str
    version: str
    ffmpeg: bool


def create_app() -> FastAPI:
    """Build a FastAPI app: versioned prefix, stable error body, CORS, health."""
    settings = get_settings()

    app = FastAPI(
        title="AvaLab API",
        version=API_VERSION,
        servers=[{"url": API_PREFIX}],
        lifespan=lifespan,
    )

    # Paths are relative to the declared server URL, so the served spec must
    # not repeat the router prefix (see avalab_api.openapi_utils). The same
    # helper runs in export_openapi, keeping served and committed specs equal.
    original_openapi = app.openapi

    def server_relative_openapi() -> dict[str, Any]:
        schema = app.openapi_schema
        if schema is None:
            schema = server_relative_schema(original_openapi(), API_PREFIX)
            app.openapi_schema = schema
        return schema

    app.openapi = server_relative_openapi  # type: ignore[method-assign]

    # Starlette wraps user middleware in reverse registration order, so the
    # upload cap is registered first to keep CORSMiddleware outermost — its
    # headers must appear on the middleware's own 413 responses.
    app.add_middleware(UploadLimitMiddleware, max_upload_bytes=settings.max_upload_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Range"],
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code.value, "message": exc.message}},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        code = _HTTP_STATUS_TO_ERROR_CODE.get(exc.status_code, ErrorCode.invalid_request)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": code.value, "message": str(exc.detail)}},
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": ErrorCode.invalid_request.value,
                    "message": "Request validation failed",
                }
            },
        )

    api_router = APIRouter(prefix=API_PREFIX)
    api_router.include_router(ingest_router)
    api_router.include_router(audio_router)

    @api_router.get("/health")
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            version=API_VERSION,
            ffmpeg=shutil.which("ffmpeg") is not None,
        )

    app.include_router(api_router)
    return app


app = create_app()
