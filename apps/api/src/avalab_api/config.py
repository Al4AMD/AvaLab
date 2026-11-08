"""Application settings (pydantic-settings, env prefix AVALAB_).

All limits are enforced before heavy work; see AGENTS.md section 7.
"""

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration read from AVALAB_* environment variables."""

    model_config = SettingsConfigDict(env_prefix="AVALAB_", env_file=".env")

    max_upload_bytes: int = 209715200
    max_duration_seconds: int = 300
    max_sample_rate_hz: int = 96000
    max_channels: int = 2
    ttl_minutes: int = 60
    ttl_sweep_interval_seconds: int = 60
    storage_dir: Path = Path("storage")
    cors_origins: list[str] = []
    public_origin: str = ""
    ml_enabled: bool = True
    ml_max_concurrency: int = Field(default=1, ge=1)
    ml_max_excerpt_seconds: int = Field(default=30, gt=0)
    codec_job_max_concurrency: int = Field(default=1, ge=1)
    codec_job_queue_limit: int = Field(default=8, ge=0)
    ml_model_cache_dir: Path = Path.home() / ".cache" / "avalab" / "models"
    ml_device: str = "cpu"

    @field_validator("public_origin")
    @classmethod
    def _normalize_public_origin(cls, value: str) -> str:
        origin = value.strip().rstrip("/")
        if not origin:
            return ""
        if "\\" in origin or "?" in origin or "#" in origin:
            raise ValueError("public_origin must be an absolute http(s) origin")
        parsed = urlsplit(origin)
        try:
            port = parsed.port
        except ValueError as exc:
            raise ValueError("public_origin has an invalid port") from exc
        if (
            parsed.scheme.lower() not in {"http", "https"}
            or not parsed.hostname
            or parsed.path
            or parsed.username is not None
            or parsed.password is not None
        ):
            raise ValueError("public_origin must be an absolute http(s) origin")
        scheme = parsed.scheme.lower()
        host = parsed.hostname.lower()
        if ":" in host:
            host = f"[{host}]"
        default_port = 80 if scheme == "http" else 443
        netloc = host if port in (None, default_port) else f"{host}:{port}"
        return f"{scheme}://{netloc}"


@lru_cache
def get_settings() -> Settings:
    """Return the cached settings instance (cleared in tests via cache_clear)."""
    return Settings()
