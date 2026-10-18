"""FastAPI application factory. All routes live under the /api/v1 prefix."""

import shutil

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from avalab_api.config import get_settings
from avalab_api.errors import ApiError

API_PREFIX = "/api/v1"
API_VERSION = "0.1.0"


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
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code.value, "message": exc.message}},
        )

    api_router = APIRouter(prefix=API_PREFIX)

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
