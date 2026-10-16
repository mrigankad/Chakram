import { useEffect, useId, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ConnectorIcon, type ConnectorId } from "@/components/ConnectorIcon";
import { StatusBadge } from "@/components/imcc/StatusBadge";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/imcc/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { ORG_CONNECTORS_QUERY_KEY } from "@/hooks/use-org-connectors";
import { api, type ConnectorsPublic } from "@/lib/api";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-error";

const fieldLabel = "text-xs font-medium text-ink-secondary";

function Section({
  id,
  title,
  configured,
  children,
}: {
  id: ConnectorId;
  title: string;
  /** Whether a credential is saved for this organization or supplied by the server. */
  configured: boolean;
  children: React.ReactNode;
}) {
  return (
    <Panel padded={false}>
      <header className="flex h-11 items-center justify-between gap-3 border-b border-stroke-muted px-4">
        <span className="flex min-w-0 items-center gap-2.5">
          <ConnectorIcon id={id} size={16} className="text-ink" />
          <h2 className="truncate text-sm font-medium text-ink">{title}</h2>
        </span>
        <StatusBadge tone={configured ? "success" : "neutral"}>{configured ? "Connected" : "Not set"}</StatusBadge>
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </Panel>
  );
}

type SecretField = { configured?: boolean; masked?: string | null; source?: string };

function SecretInput({
  label,
  name,
  value,
  configured,
  masked,
  source,
  onChange,
  onClear,
  clearing,
}: {
  label: string;
  /** Spoken name for the show/hide and clear buttons, e.g. "GitHub token". */
  name: string;
  value: string;
  configured?: boolean;
  masked?: string | null;
  source?: string;
  onChange: (v: string) => void;
  /** Removes the value saved for this organization. Offered only when there is one. */
  onClear?: () => void;
  clearing?: boolean;
}) {
  const [show, setShow] = useState(false);
  const id = useId();
  const savedHere = configured && source === "org";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className={fieldLabel}>{label}</Label>
        <span className="flex min-w-0 items-center gap-2 text-[11px] text-ink-quaternary">
          <span className="truncate">
            {configured ? (
              <>
                {savedHere ? "Saved for this organization" : "From the server environment"}{" "}
                <span className="font-mono">{masked || ""}</span>
              </>
            ) : (
              "Not set"
            )}
          </span>
          {savedHere && onClear && (
            <button
              type="button"
              onClick={onClear}
              disabled={clearing}
              aria-label={`Clear saved ${name}`}
              className="shrink-0 rounded text-[11px] font-medium text-ink-secondary underline underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {clearing ? "Clearing…" : "Clear"}
            </button>
          )}
        </span>
      </div>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          placeholder={configured ? "Leave blank to keep existing" : "Paste secret"}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10"
          autoComplete="off"
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-quaternary transition-colors hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setShow((s) => !s)}
          aria-label={`${show ? "Hide" : "Show"} ${name}`}
          aria-pressed={show}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function ConnectorsSettings() {
  const queryClient = useQueryClient();
  const [data, setData] = useState<ConnectorsPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({
    github: { token: "", repo_id: "" },
    jira: { domain: "", email: "", token: "" },
    vercel: { token: "", team_id: "", project_id: "", project_name: "" },
    ollama: { base_url: "", api_key: "", model: "" },
    slack: { webhook_url: "" },
    datadog: { api_key: "", app_key: "" },
  });

  useEffect(() => {
    void api
      .getConnectors()
      .then((res) => {
        setData(res);
        setDraft({
          github: { token: "", repo_id: String(res.github?.repo_id || "") },
          jira: {
            token: "",
            domain: String(res.jira?.domain || ""),
            email: String(res.jira?.email || ""),
          },
          vercel: {
            token: "",
            team_id: String(res.vercel?.team_id || ""),
            project_id: String(res.vercel?.project_id || ""),
            project_name: String(res.vercel?.project_name || ""),
          },
          ollama: {
            api_key: "",
            base_url: String(res.ollama?.base_url || ""),
            model: String(res.ollama?.model || ""),
          },
          slack: { webhook_url: "" },
          datadog: { api_key: "", app_key: "" },
        });
      })
      .catch((e) => {
        setLoadError(apiErrorMessage(e, "The connector settings could not be loaded."));
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.putConnectors(draft);
      setData(next);
      // The sidebar lists parked pages from this same view.
      queryClient.setQueryData(ORG_CONNECTORS_QUERY_KEY, next);
      setDraft((d) => ({
        ...d,
        github: { ...d.github, token: "" },
        jira: { ...d.jira, token: "" },
        vercel: { ...d.vercel, token: "" },
        ollama: { ...d.ollama, api_key: "" },
        slack: { webhook_url: "" },
        datadog: { api_key: "", app_key: "" },
      }));
      toast.success("Connectors saved", { description: "Changes apply to this organization immediately." });
    } catch (e) {
      toast.error("The connectors were not saved", { description: apiErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  /** Removes one value saved for this organization; the status badge follows the response. */
  const clearSaved = async (connector: string, field: string, name: string) => {
    const key = `${connector}.${field}`;
    setClearing(key);
    try {
      const next = await api.putConnectors({ clear: { [connector]: [field] } });
      setData(next);
      queryClient.setQueryData(ORG_CONNECTORS_QUERY_KEY, next);
      setDraft((d) => ({ ...d, [connector]: { ...d[connector], [field]: "" } }));
      toast.success(`Saved ${name} cleared`);
    } catch (e) {
      toast.error(`The ${name} was not cleared`, { description: apiErrorMessage(e) });
    } finally {
      setClearing(null);
    }
  };

  if (loadError) {
    return (
      <PageShell>
        <PageHeader title="Connectors" description="Credentials for the integrations this organization uses." />
        <Panel>
          <EmptyState kind="error">{loadError}</EmptyState>
        </Panel>
      </PageShell>
    );
  }

  if (loading) {
    return (
      <PageShell>
        <Panel>
          <EmptyState kind="loading">Loading connectors…</EmptyState>
        </Panel>
      </PageShell>
    );
  }

  const ghToken = data?.github?.token as SecretField | undefined;
  const jiraToken = data?.jira?.token as SecretField | undefined;
  const vercelToken = data?.vercel?.token as SecretField | undefined;
  const ollamaKey = data?.ollama?.api_key as SecretField | undefined;
  const slackHook = data?.slack?.webhook_url as SecretField | undefined;
  const ddKey = data?.datadog?.api_key as SecretField | undefined;
  const ddApp = data?.datadog?.app_key as SecretField | undefined;

  const saveButton = (
    <Button onClick={() => void save()} disabled={saving} className="gap-2">
      {saving && <Loader2 className="h-4 w-4 animate-spin" />}
      Save connectors
    </Button>
  );

  return (
    <PageShell>
      <PageHeader
        title="Connectors"
        description="Credentials for GitHub, Jira, Vercel, Ollama, Slack and Datadog for this organization. Leave a secret blank to keep the saved value, or use Clear to remove it. Where the server supplies a value, it is used when nothing is saved here."
        actions={saveButton}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section id="github" title="GitHub" configured={!!ghToken?.configured}>
          <SecretInput
            label="Token"
            name="GitHub token"
            onClear={() => void clearSaved("github", "token", "GitHub token")}
            clearing={clearing === "github.token"}
            value={draft.github.token}
            configured={ghToken?.configured}
            masked={ghToken?.masked}
            source={ghToken?.source}
            onChange={(v) => setDraft({ ...draft, github: { ...draft.github, token: v } })}
          />
          <div className="space-y-1.5">
            <Label htmlFor="connector-field-1" className={fieldLabel}>Default repo id</Label>
            <Input
              id="connector-field-1"
              value={draft.github.repo_id}
              onChange={(e) => setDraft({ ...draft, github: { ...draft.github, repo_id: e.target.value } })}
              placeholder="owner/repo"
            />
          </div>
        </Section>

        <Section id="ollama" title="Ollama" configured={!!ollamaKey?.configured}>
          <div className="space-y-1.5">
            <Label htmlFor="connector-field-2" className={fieldLabel}>Base URL</Label>
            <Input
              id="connector-field-2"
              value={draft.ollama.base_url}
              onChange={(e) => setDraft({ ...draft, ollama: { ...draft.ollama, base_url: e.target.value } })}
              placeholder="https://ollama.com"
            />
          </div>
          <SecretInput
            label="API key"
            name="Ollama API key"
            onClear={() => void clearSaved("ollama", "api_key", "Ollama API key")}
            clearing={clearing === "ollama.api_key"}
            value={draft.ollama.api_key}
            configured={ollamaKey?.configured}
            masked={ollamaKey?.masked}
            source={ollamaKey?.source}
            onChange={(v) => setDraft({ ...draft, ollama: { ...draft.ollama, api_key: v } })}
          />
          <div className="space-y-1.5">
            <Label htmlFor="connector-field-3" className={fieldLabel}>Model</Label>
            <Input
              id="connector-field-3"
              value={draft.ollama.model}
              onChange={(e) => setDraft({ ...draft, ollama: { ...draft.ollama, model: e.target.value } })}
              placeholder="kimi-k3:cloud"
            />
          </div>
        </Section>

        <Section id="jira" title="Jira" configured={!!jiraToken?.configured}>
          <div className="space-y-1.5">
            <Label htmlFor="connector-field-4" className={fieldLabel}>Domain</Label>
            <Input
              id="connector-field-4"
              value={draft.jira.domain}
              onChange={(e) => setDraft({ ...draft, jira: { ...draft.jira, domain: e.target.value } })}
              placeholder="your-org.atlassian.net"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="connector-field-5" className={fieldLabel}>Email</Label>
            <Input
              id="connector-field-5"
              value={draft.jira.email}
              onChange={(e) => setDraft({ ...draft, jira: { ...draft.jira, email: e.target.value } })}
            />
          </div>
          <SecretInput
            label="API token"
            name="Jira API token"
            onClear={() => void clearSaved("jira", "token", "Jira API token")}
            clearing={clearing === "jira.token"}
            value={draft.jira.token}
            configured={jiraToken?.configured}
            masked={jiraToken?.masked}
            source={jiraToken?.source}
            onChange={(v) => setDraft({ ...draft, jira: { ...draft.jira, token: v } })}
          />
        </Section>

        <Section id="vercel" title="Vercel" configured={!!vercelToken?.configured}>
          <SecretInput
            label="Token"
            name="Vercel token"
            onClear={() => void clearSaved("vercel", "token", "Vercel token")}
            clearing={clearing === "vercel.token"}
            value={draft.vercel.token}
            configured={vercelToken?.configured}
            masked={vercelToken?.masked}
            source={vercelToken?.source}
            onChange={(v) => setDraft({ ...draft, vercel: { ...draft.vercel, token: v } })}
          />
          <div className="space-y-1.5">
            <Label htmlFor="connector-field-6" className={fieldLabel}>Team ID</Label>
            <Input
              id="connector-field-6"
              value={draft.vercel.team_id}
              onChange={(e) => setDraft({ ...draft, vercel: { ...draft.vercel, team_id: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="connector-field-7" className={fieldLabel}>Project ID</Label>
            <Input
              id="connector-field-7"
              value={draft.vercel.project_id}
              onChange={(e) => setDraft({ ...draft, vercel: { ...draft.vercel, project_id: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="connector-field-8" className={fieldLabel}>Project name</Label>
            <Input
              id="connector-field-8"
              value={draft.vercel.project_name}
              onChange={(e) => setDraft({ ...draft, vercel: { ...draft.vercel, project_name: e.target.value } })}
            />
          </div>
        </Section>

        <Section id="slack" title="Slack" configured={!!slackHook?.configured}>
          <SecretInput
            label="Webhook URL"
            name="Slack webhook URL"
            onClear={() => void clearSaved("slack", "webhook_url", "Slack webhook URL")}
            clearing={clearing === "slack.webhook_url"}
            value={draft.slack.webhook_url}
            configured={slackHook?.configured}
            masked={slackHook?.masked}
            source={slackHook?.source}
            onChange={(v) => setDraft({ ...draft, slack: { webhook_url: v } })}
          />
        </Section>

        <Section id="datadog" title="Datadog" configured={!!ddKey?.configured}>
          <SecretInput
            label="API key"
            name="Datadog API key"
            onClear={() => void clearSaved("datadog", "api_key", "Datadog API key")}
            clearing={clearing === "datadog.api_key"}
            value={draft.datadog.api_key}
            configured={ddKey?.configured}
            masked={ddKey?.masked}
            source={ddKey?.source}
            onChange={(v) => setDraft({ ...draft, datadog: { ...draft.datadog, api_key: v } })}
          />
          <SecretInput
            label="App key"
            name="Datadog app key"
            onClear={() => void clearSaved("datadog", "app_key", "Datadog app key")}
            clearing={clearing === "datadog.app_key"}
            value={draft.datadog.app_key}
            configured={ddApp?.configured}
            masked={ddApp?.masked}
            source={ddApp?.source}
            onChange={(v) => setDraft({ ...draft, datadog: { ...draft.datadog, app_key: v } })}
          />
        </Section>
      </div>

      <div className="flex justify-end">{saveButton}</div>
    </PageShell>
  );
}
