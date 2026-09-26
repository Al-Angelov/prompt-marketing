"""Application configuration and structured logging setup.

Loads environment variables from a local `.env` file (via python-dotenv) and
exposes a single, validated `Settings` instance for the rest of the app.
"""

from __future__ import annotations

import logging
import sys
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load .env as early as possible so os.environ is populated before Settings reads it.
load_dotenv()

# Project root = the directory that contains this `app` package's parent.
PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Strongly-typed application settings sourced from environment / .env."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4o", alias="OPENAI_MODEL")
    enable_web_search: bool = Field(default=True, alias="ENABLE_WEB_SEARCH")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    storage_dir: str = Field(default="storage", alias="STORAGE_DIR")
    sourcing_api_token: str = Field(default="", alias="SOURCING_API_TOKEN")
    require_api_token: bool = Field(default=True, alias="REQUIRE_API_TOKEN")
    region_cache_hours: int = Field(default=168, ge=1, alias="REGION_CACHE_HOURS")
    company_cache_hours: int = Field(default=24, ge=1, alias="COMPANY_CACHE_HOURS")
    model_api_url: str = Field(default="http://localhost:8080", alias="MODEL_API_URL")
    model_api_token: str = Field(default="", alias="MODEL_API_TOKEN")

    @property
    def storage_path(self) -> Path:
        """Absolute path to the storage directory, created on access."""
        path = Path(self.storage_dir)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        path.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


class _JsonishFormatter(logging.Formatter):
    """Compact structured log formatter (key=value) for easy grepping."""

    def format(self, record: logging.LogRecord) -> str:
        base = (
            f"ts={self.formatTime(record, '%Y-%m-%dT%H:%M:%S%z')} "
            f"level={record.levelname} "
            f"logger={record.name} "
            f"msg={record.getMessage()!r}"
        )
        if record.exc_info:
            base += f" exc={self.formatException(record.exc_info)!r}"
        return base


def configure_logging() -> None:
    """Configure root logging once, using the level from settings."""
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    root = logging.getLogger()
    root.setLevel(level)

    # Avoid duplicate handlers on reload.
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonishFormatter())
    root.addHandler(handler)

    # Tame noisy third-party loggers.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Return a module-scoped logger."""
    return logging.getLogger(name)
