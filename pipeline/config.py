"""Centralized configuration loaded from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _optional(name: str, default: str = "") -> str:
    return os.getenv(name, default)


@dataclass(frozen=True)
class Config:
    # Supabase
    supabase_url: str
    supabase_service_key: str

    # Paid APIs
    massive_api_key: str
    huggingface_api_key: str

    # Free APIs
    finnhub_api_key: str
    fred_api_key: str

    # Reddit
    reddit_client_id: str
    reddit_client_secret: str
    reddit_user_agent: str

    # Best-effort scrape
    marketwatch_session_cookie: str

    # Observability
    sentry_dsn: str

    # Behavior
    dry_run: bool
    log_level: str


def load_config() -> Config:
    return Config(
        supabase_url=_required("SUPABASE_URL"),
        supabase_service_key=_required("SUPABASE_SERVICE_KEY"),
        massive_api_key=_optional("MASSIVE_API_KEY"),
        huggingface_api_key=_optional("HUGGINGFACE_API_KEY"),
        finnhub_api_key=_optional("FINNHUB_API_KEY"),
        fred_api_key=_optional("FRED_API_KEY"),
        reddit_client_id=_optional("REDDIT_CLIENT_ID"),
        reddit_client_secret=_optional("REDDIT_CLIENT_SECRET"),
        reddit_user_agent=_optional("REDDIT_USER_AGENT", "marketmind-pipeline/0.1"),
        marketwatch_session_cookie=_optional("MARKETWATCH_SESSION_COOKIE"),
        sentry_dsn=_optional("SENTRY_DSN"),
        dry_run=_optional("PIPELINE_DRY_RUN", "false").lower() == "true",
        log_level=_optional("PIPELINE_LOG_LEVEL", "INFO"),
    )


CONFIG = load_config() if os.getenv("SUPABASE_URL") else None
