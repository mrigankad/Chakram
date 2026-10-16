"""Model providers: one chat interface, several vendors, chosen per organization.

Every AI feature calls `ai_service._call_openai` (or streams through the same
client), which asks this module for the organization's `Profile` and a chat
client. Three vendors are supported behind the OpenAI chat-completions shape:

- `ollama`        Ollama, local or Ollama Cloud, through its `/v1` endpoint.
- `openai`        OpenAI, or any service that speaks the same API at a base URL.
- `azure_openai`  Azure OpenAI through its v1 OpenAI-compatible endpoint
                  (`https://<resource>.openai.azure.com/openai/v1/`): the OpenAI
                  client with the deployment name as the model and no dated
                  api-version (MOD 02).
- `gemini`        Gemini through the official `google-genai` SDK behind
                  `GeminiChat`, a small adapter that exposes the same
                  `chat.completions.create` call and result shape (MOD 03).

The profile comes from the `ollama` connector (its id is kept for stored data)
with a `provider` field; env defaults fill in what the org has not saved.
Capabilities are declared per provider so callers can ask before relying on
JSON mode or streaming. `check(profile)` is the registry's read-only probe.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Iterator

import httpx
from openai import OpenAI

from app.config import settings
from app.services import connector_settings_service as connectors

logger = logging.getLogger(__name__)

CHECK_TIMEOUT = 8.0
GEMINI_API_BASE = "https://generativelanguage.googleapis.com"
GEMINI_API_VERSION = "v1beta"
OPENAI_DEFAULT_BASE = "https://api.openai.com/v1"


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    api_version: str
    #: field → (label, placeholder); fields not listed are not used by this provider
    fields: dict[str, tuple[str, str]]
    #: what the vendor supports through this adapter; checked in tests, shown in Settings
    capabilities: dict[str, bool]
    #: fields that must be non-empty for "configured"
    required: tuple[str, ...]


PROVIDERS: dict[str, Provider] = {
    "ollama": Provider(
        id="ollama", name="Ollama", api_version="Ollama OpenAI-compatible /v1",
        fields={"base_url": ("Base URL", "https://ollama.com"), "api_key": ("API key", ""), "model": ("Model", "kimi-k3:cloud")},
        capabilities={"json_mode": True, "system": True, "stream": True, "prefix_cache": False},
        required=("base_url",),
    ),
    "openai": Provider(
        id="openai", name="OpenAI (or compatible)", api_version="OpenAI chat completions v1",
        fields={"base_url": ("Base URL", OPENAI_DEFAULT_BASE), "api_key": ("API key", ""), "model": ("Model", "gpt-4.1-mini")},
        capabilities={"json_mode": True, "system": True, "stream": True, "prefix_cache": True},
        required=("api_key",),
    ),
    "azure_openai": Provider(
        id="azure_openai", name="Azure OpenAI", api_version="Azure OpenAI v1 (OpenAI-compatible, no dated api-version)",
        fields={"base_url": ("Resource endpoint", "https://my-resource.openai.azure.com"), "api_key": ("API key", ""), "model": ("Deployment name", "gpt-4.1-mini")},
        capabilities={"json_mode": True, "system": True, "stream": True, "prefix_cache": True},
        required=("base_url", "api_key", "model"),
    ),
    "gemini": Provider(
        id="gemini", name="Gemini (Google AI)", api_version=f"google-genai SDK, Gemini API {GEMINI_API_VERSION}",
        fields={"api_key": ("API key", ""), "model": ("Model", "gemini-2.5-flash")},
        capabilities={"json_mode": True, "system": True, "stream": True, "prefix_cache": False},
        required=("api_key",),
    ),
}
DEFAULT_PROVIDER = "ollama"


@dataclass(frozen=True)
class Profile:
    provider: str
    base_url: str
    api_key: str
    model: str

    @property
    def spec(self) -> Provider:
        return PROVIDERS[self.provider]

    @property
    def is_configured(self) -> bool:
        return all(getattr(self, f) for f in self.spec.required)

    @property
    def label(self) -> str:
        return f"{self.spec.name} · {self.model}" if self.model else self.spec.name


def provider_id(value: str | None) -> str:
    v = (value or "").strip().lower().replace("-", "_")
    return v if v in PROVIDERS else DEFAULT_PROVIDER


def profile(cfg: dict[str, str] | None = None) -> Profile:
    """The active organization's profile (connector override → env), or one from `cfg`."""
    cfg = cfg if cfg is not None else connectors.active("ollama")
    pid = provider_id(cfg.get("provider") or settings.MODEL_PROVIDER)
    base = (cfg.get("base_url") or "").strip().rstrip("/")
    key = (cfg.get("api_key") or "").strip()
    model = (cfg.get("model") or "").strip()
    if pid == "ollama":
        base = base or (settings.OLLAMA_BASE_URL or "http://localhost:11434").rstrip("/")
        key = key or settings.OLLAMA_API_KEY or "ollama"
        model = model or settings.OLLAMA_MODEL or "llama3.1"
    elif pid == "openai":
        base = base or OPENAI_DEFAULT_BASE
        model = model or "gpt-4.1-mini"
    elif pid == "gemini":
        base = ""
        model = model or "gemini-2.5-flash"
    return Profile(provider=pid, base_url=base, api_key=key, model=model)


def _v1(base: str) -> str:
    base = base.rstrip("/")
    return base if base.endswith("/v1") else f"{base}/v1"


def azure_v1_base(endpoint: str) -> str:
    """`https://<resource>.openai.azure.com` → `.../openai/v1/` (already-complete URLs pass through)."""
    e = endpoint.rstrip("/")
    if e.endswith("/openai/v1"):
        return e + "/"
    if e.endswith("/openai"):
        return e + "/v1/"
    return e + "/openai/v1/"


def chat_client(p: Profile, timeout: float | None = None) -> Any:
    """A client with `chat.completions.create(model=…, messages=…, …)`; `max_retries=0` (callers retry)."""
    timeout = timeout or settings.LLM_TIMEOUT_SECONDS
    if p.provider == "gemini":
        return GeminiChat(api_key=p.api_key, timeout=timeout)
    if p.provider == "azure_openai":
        return OpenAI(base_url=azure_v1_base(p.base_url), api_key=p.api_key or "missing", timeout=timeout, max_retries=0)
    return OpenAI(base_url=_v1(p.base_url), api_key=p.api_key or "ollama", timeout=timeout, max_retries=0)


# ── Gemini behind the chat-completions shape ────────────────────────────────

def _completion(text: str | None, usage: Any) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text), delta=SimpleNamespace(content=text))],
        usage=SimpleNamespace(
            prompt_tokens=int(getattr(usage, "prompt_token_count", 0) or 0),
            completion_tokens=int(getattr(usage, "candidates_token_count", 0) or 0) + int(getattr(usage, "thoughts_token_count", 0) or 0),
        ) if usage is not None else None,
    )


class GeminiChat:
    """`chat.completions.create` over `google-genai`: system → system_instruction, user/assistant →
    contents, `response_format json_object` → `application/json`, usage → prompt/completion tokens.
    Unknown OpenAI-only arguments (extra_body, stream_options, …) are ignored."""

    def __init__(self, api_key: str, timeout: float, client: Any | None = None):
        self._timeout_ms = int(timeout * 1000)
        if client is None:
            from google import genai  # the official SDK; imported here so other providers never need it
            from google.genai import types

            client = genai.Client(api_key=api_key or "missing", http_options=types.HttpOptions(timeout=self._timeout_ms))
        self._client = client
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    @staticmethod
    def _config(messages: list[dict], response_format: dict | None, max_tokens: int | None, temperature: float | None, timeout_ms: int | None):
        from google.genai import types

        system = "\n\n".join(str(m.get("content") or "") for m in messages if m.get("role") == "system").strip() or None
        contents = [
            types.Content(role="user" if m.get("role") == "user" else "model", parts=[types.Part.from_text(text=str(m.get("content") or ""))])
            for m in messages
            if m.get("role") != "system"
        ]
        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json" if (response_format or {}).get("type") == "json_object" else None,
            max_output_tokens=max_tokens,
            temperature=temperature,
            http_options=types.HttpOptions(timeout=timeout_ms) if timeout_ms else None,
        )
        return contents, config

    def create(self, *, model: str, messages: list[dict], stream: bool = False, response_format: dict | None = None,
               max_tokens: int | None = None, temperature: float | None = None, timeout: float | None = None, **_ignored: Any):
        contents, config = self._config(messages, response_format, max_tokens, temperature, int(timeout * 1000) if timeout else None)
        if stream:
            return self._stream(model, contents, config)
        resp = self._client.models.generate_content(model=model, contents=contents, config=config)
        return _completion(resp.text, getattr(resp, "usage_metadata", None))

    def _stream(self, model: str, contents: Any, config: Any) -> Iterator[SimpleNamespace]:
        for chunk in self._client.models.generate_content_stream(model=model, contents=contents, config=config):
            yield _completion(chunk.text, getattr(chunk, "usage_metadata", None))


def is_quota_error(exc: Exception) -> bool:
    """429 from any vendor: the OpenAI SDK sets `status_code`, google-genai sets `code`."""
    for attr in ("status_code", "code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value == 429
    return False


# ── read-only checks ──────────────────────────────────────────────────────────

def _warn_if_missing(model: str, names: list[str], reachable: str) -> tuple[bool, str]:
    if model and names and not any(n == model or n.startswith(model.split(":")[0]) for n in names):
        return True, f"Reachable, but '{model}' is not in the endpoint's model list ({len(names)} models)."
    return True, f"{reachable}; {len(names)} model(s) listed." if names else reachable + "."


async def check(p: Profile) -> tuple[bool, str]:
    """One harmless read per provider: list models (Ollama tags, OpenAI/Azure/Gemini model lists)."""
    if not p.is_configured:
        missing = [f for f in p.spec.required if not getattr(p, f)]
        return False, f"{p.spec.name} needs: {', '.join(p.spec.fields[f][0] for f in missing)}."
    async with httpx.AsyncClient(timeout=CHECK_TIMEOUT) as client:
        if p.provider == "ollama":
            headers = {"Authorization": f"Bearer {p.api_key}"} if p.api_key and p.api_key != "ollama" else {}
            resp = await client.get(f"{p.base_url}/api/tags", headers=headers)
            names = [str(m.get("name")) for m in (resp.json() or {}).get("models") or [] if isinstance(m, dict)] if resp.status_code < 400 else []
        elif p.provider == "gemini":
            resp = await client.get(f"{GEMINI_API_BASE}/{GEMINI_API_VERSION}/models", params={"pageSize": 100}, headers={"x-goog-api-key": p.api_key})
            names = [str(m.get("name", "")).removeprefix("models/") for m in (resp.json() or {}).get("models") or [] if isinstance(m, dict)] if resp.status_code < 400 else []
        else:
            base = azure_v1_base(p.base_url) if p.provider == "azure_openai" else _v1(p.base_url) + "/"
            headers = {"api-key": p.api_key} if p.provider == "azure_openai" else {"Authorization": f"Bearer {p.api_key}"}
            resp = await client.get(f"{base}models", headers=headers)
            names = [str(m.get("id")) for m in (resp.json() or {}).get("data") or [] if isinstance(m, dict)] if resp.status_code < 400 else []
    if resp.status_code in (401, 403):
        return False, f"{p.spec.name} rejected the key ({resp.status_code})."
    if resp.status_code >= 400:
        return False, f"{p.spec.name} answered {resp.status_code}."
    if p.provider == "azure_openai":
        # The v1 model list names base models, not deployments; the deployment is only proven by a call.
        return True, f"Reachable; deployment '{p.model}' will be used."
    return _warn_if_missing(p.model, names, "Reachable")


def public_catalog() -> list[dict[str, Any]]:
    """What the Settings page needs to render the provider choice."""
    return [
        {"id": p.id, "name": p.name, "api_version": p.api_version, "fields": {k: {"label": v[0], "placeholder": v[1]} for k, v in p.fields.items()},
         "required": list(p.required), "capabilities": p.capabilities}
        for p in PROVIDERS.values()
    ]
