"""One chat interface, several vendors (MOD 01–03): profile resolution, client construction,
the Gemini adapter's mapping, quota detection and the read-only checks."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.config import settings
from app.services import ai_service, connector_registry as registry, model_providers as mp


# ── profiles ─────────────────────────────────────────────────────────────────

def test_profile_falls_back_to_env_for_ollama_and_ignores_unknown_providers(monkeypatch):
    monkeypatch.setattr(settings, "MODEL_PROVIDER", "ollama")
    monkeypatch.setattr(settings, "OLLAMA_BASE_URL", "https://ollama.com/")
    monkeypatch.setattr(settings, "OLLAMA_API_KEY", "k")
    monkeypatch.setattr(settings, "OLLAMA_MODEL", "kimi-k3:cloud")
    p = mp.profile({})
    assert (p.provider, p.base_url, p.api_key, p.model) == ("ollama", "https://ollama.com", "k", "kimi-k3:cloud")
    assert p.is_configured and p.label == "Ollama · kimi-k3:cloud"
    assert mp.profile({"provider": "something-else"}).provider == "ollama"
    assert mp.profile({"provider": "Azure-OpenAI"}).provider == "azure_openai"


def test_each_provider_has_its_own_configured_rule():
    assert mp.profile({"provider": "openai", "api_key": "sk"}).is_configured
    assert not mp.profile({"provider": "openai"}).is_configured
    azure = mp.profile({"provider": "azure_openai", "base_url": "https://r.openai.azure.com", "api_key": "k"})
    assert not azure.is_configured  # the deployment name is required
    assert mp.profile({"provider": "azure_openai", "base_url": "https://r.openai.azure.com", "api_key": "k", "model": "gpt-4.1"}).is_configured
    gem = mp.profile({"provider": "gemini", "api_key": "g", "base_url": "ignored"})
    assert gem.is_configured and gem.base_url == "" and gem.model == "gemini-2.5-flash"


def test_the_registry_uses_the_provider_rule_and_reports_the_choice(monkeypatch):
    c = registry.REGISTRY["ollama"]
    assert registry.is_configured(c, {"provider": "gemini", "api_key": "g"})
    assert not registry.is_configured(c, {"provider": "gemini"})
    assert registry.is_configured(c, {"provider": "ollama", "base_url": "http://localhost:11434"})
    catalog = mp.public_catalog()
    assert [p["id"] for p in catalog] == ["ollama", "openai", "azure_openai", "gemini"]
    assert catalog[2]["fields"]["model"]["label"] == "Deployment name" and catalog[3]["capabilities"]["json_mode"] is True


# ── clients ──────────────────────────────────────────────────────────────────

def test_openai_compatible_clients_point_at_v1_and_never_retry_themselves():
    ollama = mp.chat_client(mp.profile({"provider": "ollama", "base_url": "https://ollama.com", "api_key": "k", "model": "m"}))
    assert str(ollama.base_url) == "https://ollama.com/v1/" and ollama.max_retries == 0
    openai = mp.chat_client(mp.profile({"provider": "openai", "api_key": "sk", "base_url": "https://proxy.example/v1"}))
    assert str(openai.base_url) == "https://proxy.example/v1/" and openai.api_key == "sk"


def test_azure_uses_the_v1_endpoint_and_the_deployment_name_as_the_model():
    """MOD 02: endpoint kind and deployed identifier."""
    p = mp.profile({"provider": "azure_openai", "base_url": "https://acme.openai.azure.com/", "api_key": "k", "model": "gpt-4-1-prod"})
    client = mp.chat_client(p)
    assert str(client.base_url) == "https://acme.openai.azure.com/openai/v1/"
    assert p.model == "gpt-4-1-prod"  # what _call_openai_sync passes as model=
    assert mp.azure_v1_base("https://acme.openai.azure.com/openai/v1") == "https://acme.openai.azure.com/openai/v1/"
    assert mp.azure_v1_base("https://acme.openai.azure.com/openai") == "https://acme.openai.azure.com/openai/v1/"


class _FakeGenai:
    """Stands in for google-genai's client; records the request and answers with SDK-shaped objects."""

    def __init__(self, text="{\"ok\": true}", chunks=None):
        self.calls = []
        self._text = text
        self._chunks = chunks or ["{\"ok\"", ": true}"]
        self.models = SimpleNamespace(generate_content=self._generate, generate_content_stream=self._stream)

    def _generate(self, *, model, contents, config):
        self.calls.append(("generate", model, contents, config))
        return SimpleNamespace(text=self._text, usage_metadata=SimpleNamespace(prompt_token_count=12, candidates_token_count=5, thoughts_token_count=3))

    def _stream(self, *, model, contents, config):
        self.calls.append(("stream", model, contents, config))
        for i, c in enumerate(self._chunks):
            last = i == len(self._chunks) - 1
            yield SimpleNamespace(text=c, usage_metadata=SimpleNamespace(prompt_token_count=12, candidates_token_count=4, thoughts_token_count=0) if last else None)


def test_gemini_adapter_maps_messages_json_mode_usage_and_streaming():
    """MOD 03: the official SDK, driven through the same chat-completions shape every caller uses."""
    fake = _FakeGenai()
    chat = mp.GeminiChat(api_key="g", timeout=30, client=fake)
    resp = chat.chat.completions.create(
        model="gemini-2.5-flash",
        messages=[{"role": "system", "content": "You write JSON."}, {"role": "user", "content": "Go"}],
        response_format={"type": "json_object"},
        extra_body={"reasoning_effort": "low"},  # OpenAI-only, ignored
        timeout=20,
    )
    assert resp.choices[0].message.content == "{\"ok\": true}"
    assert (resp.usage.prompt_tokens, resp.usage.completion_tokens) == (12, 8)  # thoughts count as output
    kind, model, contents, config = fake.calls[0]
    assert kind == "generate" and model == "gemini-2.5-flash"
    assert config.system_instruction == "You write JSON." and config.response_mime_type == "application/json"
    assert config.http_options.timeout == 20_000
    assert [(c.role, c.parts[0].text) for c in contents] == [("user", "Go")]

    chunks = list(chat.chat.completions.create(model="gemini-2.5-flash", messages=[{"role": "user", "content": "Go"}], stream=True, stream_options={"include_usage": True}, max_tokens=50, temperature=0.3))
    assert [c.choices[0].delta.content for c in chunks] == ["{\"ok\"", ": true}"]
    assert chunks[0].usage is None and chunks[-1].usage.completion_tokens == 4
    assert fake.calls[1][3].max_output_tokens == 50 and fake.calls[1][3].response_mime_type is None

    # A blocked answer has no text: the shared empty-answer path raises, nothing is invented.
    blocked = mp.GeminiChat(api_key="g", timeout=30, client=_FakeGenai(text=None))
    resp = blocked.chat.completions.create(model="m", messages=[{"role": "user", "content": "x"}])
    with pytest.raises(ai_service.AIResponseError):
        ai_service._message_text(resp.choices[0].message)


def test_quota_detection_covers_both_sdks():
    from google.genai import errors

    assert ai_service._is_quota_error(errors.ClientError(429, {"error": {"message": "quota"}}))
    assert not ai_service._is_quota_error(errors.ClientError(400, {"error": {"message": "bad"}}))
    assert mp.is_quota_error(SimpleNamespace(status_code=429)) and not mp.is_quota_error(SimpleNamespace(code=500))


def test_ai_service_calls_go_through_the_active_profile(monkeypatch):
    """A Gemini org and an Azure org get different clients and models from the same call."""
    seen = {}

    class _Client:
        def __init__(self, tag):
            self.tag = tag
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

        def _create(self, **kwargs):
            seen[self.tag] = kwargs["model"]
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="{}"))], usage=None)

    monkeypatch.setattr(mp, "chat_client", lambda p, timeout=None: _Client(p.provider))
    with patch.object(ai_service.connectors, "active", return_value={"provider": "gemini", "api_key": "g", "model": "gemini-2.5-pro"}):
        assert ai_service._call_openai_sync("hi") == ("{}", 0, 0)
    with patch.object(ai_service.connectors, "active", return_value={"provider": "azure_openai", "base_url": "https://r.openai.azure.com", "api_key": "k", "model": "dep-1"}):
        ai_service._call_openai_sync("hi")
    assert seen == {"gemini": "gemini-2.5-pro", "azure_openai": "dep-1"}


# ── checks ───────────────────────────────────────────────────────────────────

class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


def _client_answering(expect: dict):
    class _Client:
        seen = []

        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, **kwargs):
            _Client.seen.append((url, kwargs))
            for prefix, resp in expect.items():
                if url.startswith(prefix):
                    return resp
            return _Resp(404, {})

    return _Client


async def test_checks_use_each_vendors_model_list_and_name_missing_models():
    client = _client_answering({
        "https://api.openai.com/v1/models": _Resp(200, {"data": [{"id": "gpt-4.1-mini"}, {"id": "gpt-4.1"}]}),
        "https://generativelanguage.googleapis.com/v1beta/models": _Resp(200, {"models": [{"name": "models/gemini-2.5-flash"}]}),
        "https://acme.openai.azure.com/openai/v1/models": _Resp(200, {"data": [{"id": "gpt-4.1"}]}),
        "https://bad.example/v1/models": _Resp(401, {}),
    })
    with patch.object(mp.httpx, "AsyncClient", client):
        ok, msg = await mp.check(mp.profile({"provider": "openai", "api_key": "sk", "model": "gpt-4.1-mini"}))
        assert ok and "2 model(s)" in msg
        ok, msg = await mp.check(mp.profile({"provider": "gemini", "api_key": "g", "model": "gemini-9"}))
        assert ok and "'gemini-9' is not in the endpoint's model list" in msg
        ok, msg = await mp.check(mp.profile({"provider": "azure_openai", "base_url": "https://acme.openai.azure.com", "api_key": "k", "model": "dep"}))
        assert ok and "deployment 'dep'" in msg
        ok, msg = await mp.check(mp.profile({"provider": "openai", "api_key": "sk", "base_url": "https://bad.example"}))
        assert not ok and "rejected the key (401)" in msg
        ok, msg = await mp.check(mp.profile({"provider": "gemini"}))
        assert not ok and msg == "Gemini (Google AI) needs: API key."
    gemini_call = next(c for c in client.seen if "generativelanguage" in c[0])
    assert gemini_call[1]["headers"] == {"x-goog-api-key": "g"}
    azure_call = next(c for c in client.seen if "azure" in c[0])
    assert azure_call[1]["headers"] == {"api-key": "k"}


async def test_status_rows_show_the_chosen_provider(app_client, db, monkeypatch):
    from app.auth.session import create_session_cookie
    from app.services import organization_service

    org = await organization_service.create_organization(db, workos_org_id="o", name="o")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    await app_client.put("/api/orgs/current/connectors", json={"ollama": {"provider": "gemini", "api_key": "g", "model": "gemini-2.5-flash"}})
    rows = (await app_client.get("/api/orgs/current/connectors/status")).json()["connectors"]
    model = next(r for r in rows if r["id"] == "ollama")
    assert model["configured"] is True and model["provider"] == "gemini" and model["model"] == "gemini-2.5-flash"
    public = (await app_client.get("/api/orgs/current/connectors")).json()
    assert public["ollama"]["provider"] == "gemini" and public["ollama"]["api_key"]["configured"] is True
    catalog = (await app_client.get("/api/orgs/current/model-providers")).json()
    assert catalog["default"] == "ollama" and len(catalog["providers"]) == 4
