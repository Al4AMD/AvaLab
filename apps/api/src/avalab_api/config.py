"""Application settings (pydantic-settings, env prefix AVALAB_).

All limits are enforced before heavy work; see AGENTS.md section 7.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration read from AVALAB_* environment variables."""

    model_config = SettingsConfigDict(env_prefix="AVALAB_", env_file=".env")

    max_upload_bytes: int = 104857600
    max_duration_seconds: int = 300
    max_sample_rate_hz: int = 96000
    max_channels: int = 2
    ttl_minutes: int = 60
    ttl_sweep_interval_seconds: int = 60
    storage_dir: Path = Path("storage")
    cors_origins: list[str] = []


@lru_cache
def get_settings() -> Settings:
    """Return the cached settings instance (cleared in tests via cache_clear)."""
    return Settings()
