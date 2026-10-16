# Model providers

Chakram talks to one chat interface; the vendor behind it is chosen per organization in
Settings → Connectors → Model provider (`backend/app/services/model_providers.py`).

| Provider | How it is reached | Fields | API pinned |
| --- | --- | --- | --- |
| `ollama` (default) | OpenAI client at `<base_url>/v1` | base URL, key (any non-empty value locally), model | Ollama OpenAI-compatible `/v1` |
| `openai` | OpenAI client at the base URL (default `https://api.openai.com/v1`); any compatible service works | base URL, key, model | chat completions v1 |
| `azure_openai` | OpenAI client at `https://<resource>.openai.azure.com/openai/v1/`, the **deployment name** as the model, no dated `api-version` | resource endpoint, key, deployment | Azure OpenAI v1 |
| `gemini` | the official `google-genai` SDK behind `GeminiChat`, an adapter with the same `chat.completions.create` call and result shape | key, model | Gemini API `v1beta` |

Rules the module enforces, the same for every vendor:

- **One call path.** `ai_service._call_openai` and the App Studio stream ask `model_providers.profile()` for the org's profile and `chat_client()` for a client. Retries, the concurrency limit, JSON repair and usage logging stay in `ai_service`; a vendor adapter only maps the request and the answer.
- **The org's key wins.** The server's provider (`MODEL_PROVIDER`, `OLLAMA_*`) is shared; an organization that saves its own provider and key uses those (bring your own key). The `ollama` connector id is kept for stored data.
- **Capabilities are declared**, not assumed: `json_mode`, `system`, `stream`, `prefix_cache` per provider in `PROVIDERS`, shown by `GET /orgs/current/model-providers`.
- **Configured means the provider's own fields**: Ollama needs a base URL, OpenAI and Gemini a key, Azure endpoint, key and deployment.
- **Check connection** lists models with a read-only call (Ollama tags, OpenAI/Azure `models`, Gemini `models`) and warns when the configured model is not listed. Azure's list names base models, so the deployment is only proven by a real call.
- **Quota from either SDK** maps to the same 429 path (`status_code` on the OpenAI SDK, `code` on google-genai).
- **Usage rows** (`api_cost_logs`) carry `provider` and `model`.

What is verified here: profile resolution, client construction (endpoint, deployment, no self-retries), the Gemini adapter's mapping (system instruction, JSON mime type, usage including thoughts, streaming chunks, blocked answers), quota detection, checks and the Settings round trip (`backend/tests/test_model_providers.py`). Not verified here: a live call to Azure or Gemini; the checklist's MOD 01–03 rows stay at "unit" until an account is available.

Not in scope yet: Entra ID tokens for Azure, Vertex AI for Gemini, per-model cost rates, and provider-specific prompt caching.
