from pathlib import Path
from typing import Annotated, Any

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Always load backend/.env regardless of process cwd (avoids picking up repo-root .env).
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"


_PLACEHOLDER_WORDS = ("change-me", "changeme", "insecure", "replace-with", "generate-a", "your-secret", "example")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # MongoDB
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB: str = "aidlc"

    # Ollama (OpenAI-compatible API)
    # Local: http://localhost:11434 with any non-empty api key.
    # Ollama cloud/pro: https://ollama.com with an API key from ollama.com/settings/keys.
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_API_KEY: str = "ollama"
    OLLAMA_MODEL: str = "kimi-k3:cloud"
    # Default per-call timeout; callers that pass an explicit timeout override it.
    LLM_TIMEOUT_SECONDS: float = 120.0
    # Maximum LLM calls in flight at once across all requests.
    LLM_MAX_CONCURRENCY: int = 4

    # Browsers one Test Execution run may drive at the same time.
    TEST_EXECUTION_CONCURRENCY: int = 3
    # Hard cap on headless browsers alive at once across every feature that launches one
    # (Test Execution, Live Test Runner, self-healing scans). Sized for container memory.
    MAX_CONCURRENT_BROWSERS: int = 4

    # Longest an API request may run before the server answers 504 itself. Kept under the
    # ~240 s limit of the Azure ingress so the client gets a readable message, not a proxy error.
    REQUEST_TIMEOUT_SECONDS: int = 225

    # GitHub
    GITHUB_TOKEN: str = ""
    GITHUB_REPO_ID: str = ""

    # Vercel Deployments
    VERCEL_TOKEN: str = ""
    VERCEL_TEAM_ID: str = ""
    VERCEL_PROJECT_ID: str = ""
    VERCEL_PROJECT_NAME: str = ""

    # Jira
    JIRA_DOMAIN: str = ""
    JIRA_EMAIL: str = ""
    JIRA_TOKEN: str = ""

    # Slack
    SLACK_WEBHOOK_URL: str = ""

    # Datadog

    # WorkOS AuthKit (real user auth + organizations)
    WORKOS_API_KEY: str = ""
    WORKOS_CLIENT_ID: str = ""
    WORKOS_WEBHOOK_SECRET: str = ""
    WORKOS_REDIRECT_URI: str = "http://localhost:8000/api/auth/callback"

    # Backend-signed session cookie (separate from WorkOS see auth/session.py)
    SESSION_SECRET: str = "dev-only-insecure-secret-change-me"

    # Accounts are provisioned by the operator: sign-up is off unless this is set.
    SIGNUP_ENABLED: bool = False

    # Account created at startup if it does not exist yet (any environment). The
    # password lives only in the environment / secret store, never in source.
    SEED_USER_EMAIL: str = ""
    SEED_USER_PASSWORD: str = ""
    SEED_USER_NAME: str = ""
    SEED_ORG_NAME: str = ""

    # Local email/password signup. Always open in development. In production it is
    # closed unless the email domain is listed here or ALLOW_OPEN_SIGNUP is set.
    SIGNUP_ALLOWED_DOMAINS: Annotated[list[str], NoDecode] = []
    ALLOW_OPEN_SIGNUP: bool = False

    # Orgs (by id or workos_org_id) that may use the GitHub/Jira/Vercel/Slack/Datadog
    # credentials from this server's environment. In production every other org must
    # save its own in Settings -> Connectors. The AI provider key is shared with all orgs.
    PLATFORM_ORG_IDS: Annotated[list[str], NoDecode] = []

    # AI Workspace
    WORKSPACE_TEMP_DIR: str = "/tmp/workspaces"
    MAX_FILE_SIZE_KB: int = 500
    MAX_REPO_SIZE_MB: int = 100
    COMMIT_AUTHOR_NAME: str = "SDLC AI"
    COMMIT_AUTHOR_EMAIL: str = "ai@sdlc.dev"

    # App
    APP_ENV: str = "development"
    FRONTEND_URL: str = "http://localhost:8081"
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:8080",
        "http://localhost:8081",
        "http://localhost:5173",
        "http://localhost:8083",
        "https://localhost:8000",
    ]

    # PR Review Engine
    PR_REVIEW_V2_ENABLED: bool = True
    # App Studio: plan a structured app spec and compose pages from the kit
    # (one planner call + one seed call per app) instead of one model call per
    # file. Falls back to per-file generation when a usable spec cannot be planned.
    AI_IDE_COMPOSER: bool = True
    PR_REVIEW_MAX_FILES: int = 15
    PR_REVIEW_MAX_PATCH_CHARS: int = 3000
    PR_REVIEW_MAX_HUNKS_PER_FILE: int = 8

    @field_validator("CORS_ORIGINS", "SIGNUP_ALLOWED_DOMAINS", "PLATFORM_ORG_IDS", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: Any) -> list[str]:
        """Accept JSON array, comma-separated string, or list from env."""
        if value is None or value == "":
            return []
        if isinstance(value, list):
            return [str(x).strip() for x in value if str(x).strip()]
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                import json

                parsed = json.loads(text)
                return [str(x).strip() for x in parsed if str(x).strip()]
            return [part.strip() for part in text.split(",") if part.strip()]
        return value

    @model_validator(mode="after")
    def _no_local_origins_in_production(self) -> "Settings":
        """The development defaults must not let localhost pages send credentials in production."""
        if self.APP_ENV == "production":
            self.CORS_ORIGINS = [o for o in self.CORS_ORIGINS if "localhost" not in o and "127.0.0.1" not in o]
        return self

    @model_validator(mode="after")
    def _require_real_secret_in_production(self) -> "Settings":
        """A guessable signing key lets anyone forge a session for any org."""
        if self.APP_ENV == "production":
            secret = self.SESSION_SECRET.strip()
            placeholder = any(word in secret.lower() for word in _PLACEHOLDER_WORDS)
            if len(secret) < 32 or placeholder:
                raise ValueError(
                    "SESSION_SECRET must be a random value of at least 32 characters when "
                    "APP_ENV=production (generate one with: python -c \"import secrets; "
                    "print(secrets.token_urlsafe(48))\")"
                )
        return self

    @property
    def jira_base_url(self) -> str:
        """Extract clean Jira base URL from potentially messy JIRA_DOMAIN value."""
        domain = self.JIRA_DOMAIN.strip()
        if not domain:
            return ""
        # Strip query params if present
        if "?" in domain:
            domain = domain.split("?")[0]
        # Ensure https prefix
        if not domain.startswith("http"):
            domain = f"https://{domain}"
        return domain.rstrip("/")


settings = Settings()
