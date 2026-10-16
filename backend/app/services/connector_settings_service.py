"""Org-scoped connector settings with env fallback."""
from __future__ import annotations

from contextvars import ContextVar, Token
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import settings

# Per-request org connectors (raw org overrides). Set by get_current_org.
_current_org_connectors: ContextVar[dict[str, Any] | None] = ContextVar(
    "_current_org_connectors", default=None
)


# Marker stored alongside the org's connectors for the duration of a request.
_PLATFORM_KEY = "_platform_org"

# The AI provider is part of the product, so its key is shared with every org.
_ALWAYS_SHARED = {"ollama"}


def is_platform_org(org: Any) -> bool:
    """May this org use the integration credentials from the server environment?"""
    if settings.APP_ENV != "production":
        return True
    allowed = set(settings.PLATFORM_ORG_IDS)
    return getattr(org, "id", None) in allowed or getattr(org, "workos_org_id", None) in allowed


def set_current_org_connectors(connectors: dict[str, Any] | None, platform: bool = True) -> Token:
    return _current_org_connectors.set({**(connectors or {}), _PLATFORM_KEY: platform})


def reset_current_org_connectors(token: Token) -> None:
    _current_org_connectors.reset(token)


def active(name: str) -> dict[str, str]:
    """Resolved connector for the current request (org override → env)."""
    return resolve(_current_org_connectors.get(), name)


SECRET_FIELDS = {
    "github": {"token"},
    "jira": {"token"},
    "vercel": {"token"},
    "ollama": {"api_key"},
    "slack": {"webhook_url"},
}

CONNECTOR_KEYS = ("github", "jira", "vercel", "ollama", "slack")


def _mask(value: str | None) -> dict[str, Any]:
    if not value:
        return {"configured": False, "masked": None}
    tail = value[-4:] if len(value) >= 4 else "****"
    return {"configured": True, "masked": f"••••{tail}"}


def _env_defaults() -> dict[str, dict[str, str]]:
    return {
        "github": {
            "token": settings.GITHUB_TOKEN or "",
            "repo_id": getattr(settings, "GITHUB_REPO_ID", "") or "",
        },
        "jira": {
            "domain": settings.JIRA_DOMAIN or "",
            "email": settings.JIRA_EMAIL or "",
            "token": settings.JIRA_TOKEN or "",
        },
        "vercel": {
            "token": settings.VERCEL_TOKEN or "",
            "team_id": settings.VERCEL_TEAM_ID or "",
            "project_id": settings.VERCEL_PROJECT_ID or "",
            "project_name": settings.VERCEL_PROJECT_NAME or "",
        },
        "ollama": {
            "provider": settings.MODEL_PROVIDER or "ollama",
            "base_url": settings.OLLAMA_BASE_URL or "",
            "api_key": settings.OLLAMA_API_KEY or "",
            "model": settings.OLLAMA_MODEL or "",
        },
        "slack": {"webhook_url": getattr(settings, "SLACK_WEBHOOK_URL", "") or ""},
    }


async def get_raw(db: AsyncIOMotorDatabase, org_id: str) -> dict[str, Any]:
    if not ObjectId.is_valid(org_id):
        return {}
    doc = await db.organizations.find_one({"_id": ObjectId(org_id)}, {"connectors": 1})
    return (doc or {}).get("connectors") or {}


def resolve(org_connectors: dict[str, Any] | None, name: str) -> dict[str, str]:
    """Merge org overrides over env defaults (non-empty org wins).

    A non-platform org gets the env field names with empty values, so callers see
    "not configured" instead of borrowing the operator's credentials.
    """
    base = _env_defaults().get(name, {})
    if name not in _ALWAYS_SHARED and not (org_connectors or {}).get(_PLATFORM_KEY, True):
        base = {k: "" for k in base}
    override = (org_connectors or {}).get(name) or {}
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, str) and v.strip() and v.strip() != "***":
            out[k] = v.strip()
    return out


def public_view(org_connectors: dict[str, Any] | None, platform: bool = True) -> dict[str, Any]:
    """Masked view for UI never return full secrets."""
    raw = {**(org_connectors or {}), _PLATFORM_KEY: platform}
    env = {n: resolve({_PLATFORM_KEY: platform}, n) for n in CONNECTOR_KEYS}
    out: dict[str, Any] = {}
    for name in CONNECTOR_KEYS:
        merged = resolve(raw, name)
        secrets = SECRET_FIELDS.get(name, set())
        panel: dict[str, Any] = {}
        for k, v in merged.items():
            if k in secrets:
                # Prefer showing org-configured mask if org has value
                org_val = (raw.get(name) or {}).get(k)
                source = "org" if org_val else ("env" if env.get(name, {}).get(k) else "none")
                panel[k] = {**_mask(v if v else None), "source": source}
            else:
                panel[k] = v or ""
        out[name] = panel
    out["updated_at"] = raw.get("updated_at")
    return out


async def update(
    db: AsyncIOMotorDatabase,
    org_id: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    if not ObjectId.is_valid(org_id):
        raise ValueError("invalid org id")
    existing = await get_raw(db, org_id)
    merged = dict(existing)
    for name in CONNECTOR_KEYS:
        if name not in patch:
            continue
        incoming = patch[name] or {}
        if not isinstance(incoming, dict):
            continue
        current = dict(merged.get(name) or {})
        secrets = SECRET_FIELDS.get(name, set())
        for k, v in incoming.items():
            if not isinstance(k, str):
                continue
            if v is None:
                continue
            if not isinstance(v, str):
                v = str(v)
            # Blank or *** means keep existing secret
            if k in secrets and (not v.strip() or v.strip() in {"***", "••••", "••••••••"}):
                continue
            if not v.strip() and k not in secrets:
                current.pop(k, None)
                continue
            current[k] = v.strip()
        merged[name] = current
    # Explicit removals. Only this organization's saved value goes; a value the
    # server environment supplies is untouched and becomes the fallback again.
    clear = patch.get("clear") or {}
    if isinstance(clear, dict):
        for name, fields in clear.items():
            if name not in CONNECTOR_KEYS or not isinstance(fields, (list, tuple, set)):
                continue
            current = dict(merged.get(name) or {})
            for field in fields:
                if isinstance(field, str):
                    current.pop(field, None)
            merged[name] = current
    merged["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.organizations.update_one(
        {"_id": ObjectId(org_id)},
        {"$set": {"connectors": merged}},
    )
    return public_view(merged)
