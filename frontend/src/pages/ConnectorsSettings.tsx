import { useEffect, useId, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ConnectorIcon, type ConnectorId } from "@/components/ConnectorIcon";
import { ErrorText } from "@/components/ErrorText";
import { StatusBadge } from "@/components/imcc/StatusBadge";
import { Eye, EyeOff, Loader2, Palette, Upload } from "lucide-react";
import { enablesLine } from "@/lib/connector-status";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/imcc/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAskDialog } from "@/components/ui/ask-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORG_THEME_QUERY_KEY } from "@/lib/design-pack";
import { ORG_CONNECTORS_QUERY_KEY } from "@/hooks/use-org-connectors";
import {
  CONNECTOR_STATUS_QUERY_KEY,
  DESIGN_PACKS_QUERY_KEY,
  api,
  type ConnectorStatus,
  type ConnectorsPublic,
  type DesignPack,
  type ModelProviderSpec,
  MODEL_PROVIDERS_QUERY_KEY,
} from "@/lib/api";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-error";

const fieldLabel = "text-xs font-medium text-ink-secondary";

function Section({
  id,
  title,
  configured,
  status,
  children,
}: {
  id: ConnectorId;
  title: string;
  /** Whether a credential is saved for this organization or supplied by the server. */
  configured: boolean;
  /** What the connector feeds and its last probe, from GET /orgs/current/connectors/status; absent when that call failed. */
  status?: ConnectorStatus;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: () => api.checkConnector(id),
    onError: (e) => toast.error(`${title} could not be checked`, { description: apiErrorMessage(e) }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CONNECTOR_STATUS_QUERY_KEY }),
  });
  const result = check.data ?? status?.last_check ?? null;
  const enables = status ? enablesLine(status) : "";
  return (
    <Panel padded={false}>
      <header className="flex h-11 items-center justify-between gap-3 border-b border-stroke-muted px-4">
        <span className="flex min-w-0 items-center gap-2.5">
          <ConnectorIcon id={id} size={16} className="text-ink" />
          <h2 className="truncate text-sm font-medium text-ink">{title}</h2>
        </span>
        <StatusBadge tone={configured ? "success" : "neutral"}>{configured ? "Connected" : "Not set"}</StatusBadge>
      </header>
      {status && (
        <div className="space-y-2 border-b border-stroke-muted px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[11px] text-ink-quaternary">
              {enables || "Enables: nothing yet"}
              {status.api_version && (
                <>
                  {" · "}
                  <span className="font-mono">API {status.api_version}</span>
                </>
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 text-xs"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              {check.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {check.isPending ? "Checking…" : "Check connection"}
            </Button>
          </div>
          {result && (
            <p className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-ink-secondary">
              <StatusBadge tone={result.ok ? "success" : "critical"}>{result.ok ? "Working" : "Failed"}</StatusBadge>
              <span className="min-w-0 flex-1 truncate" title={result.message}>{result.message}</span>
              <span className="shrink-0 text-[11px] text-ink-quaternary">{new Date(result.checked_at).toLocaleString()}</span>
            </p>
          )}
        </div>
      )}
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

/** The four colours a pack is previewed by (page, container, text, accent). Colours are data, so they are inline. */
function PackSwatches({ pack }: { pack: DesignPack }) {
  const entries: Array<[string, string]> = [
    ["Page", pack.swatches.page],
    ["Container", pack.swatches.container],
    ["Text", pack.swatches.text],
    ["Accent", pack.swatches.accent],
  ];
  return (
    <span className="flex shrink-0 overflow-hidden rounded border border-stroke-muted" aria-hidden="true">
      {entries.map(([label, colour]) => (
        <span key={label} title={`${label} ${colour}`} className="h-6 w-5" style={{ backgroundColor: colour }} />
      ))}
    </span>
  );
}

function PackRow({
  pack,
  busy,
  onMakeDefault,
  onDelete,
}: {
  pack: DesignPack;
  /** Which action is running for this pack, if any. */
  busy: "default" | "delete" | null;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <PackSwatches pack={pack} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{pack.name}</span>
          <span className="font-mono text-[11px] text-ink-quaternary">v{pack.version}</span>
          {pack.is_default && <StatusBadge tone="success">Default</StatusBadge>}
          <StatusBadge tone="neutral">{pack.source === "builtin" ? "Built in" : "Uploaded"}</StatusBadge>
        </p>
        <p className="truncate text-xs text-ink-tertiary">
          {pack.fonts.sans}
          {pack.fonts.display && pack.fonts.display !== pack.fonts.sans ? ` · ${pack.fonts.display}` : ""}
          {` · ${pack.mode === "dark" ? "Dark" : "Light"} by default`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!pack.is_default && (
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={busy !== null} onClick={onMakeDefault}>
            {busy === "default" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Make default
          </Button>
        )}
        {pack.source === "org" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-destructive hover:text-destructive"
            disabled={busy !== null}
            onClick={onDelete}
            aria-label={`Delete design pack ${pack.name}`}
          >
            {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Delete"}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Settings → Design System: the design packs new App Builder apps are created with.
 * The built-in Chronos pack is always there; an organization can upload its own as a
 * zip and make it the default. The default pack also styles Chakram itself
 * (components/OrgDesignPack.tsx), so the client sees one visual system end to end.
 */
function DesignSystemSection() {
  const queryClient = useQueryClient();
  const { dialog, confirm } = useAskDialog();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busyPack, setBusyPack] = useState<{ id: string; action: "default" | "delete" } | null>(null);

  const packsQuery = useQuery({ queryKey: DESIGN_PACKS_QUERY_KEY, queryFn: api.listDesignPacks });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ORG_THEME_QUERY_KEY }); // Chakram itself wears the default pack
    return queryClient.invalidateQueries({ queryKey: DESIGN_PACKS_QUERY_KEY });
  };

  const uploadMutation = useMutation({
    mutationFn: (pack: File) => api.uploadDesignPack(pack),
    onSuccess: (res) => {
      setWarnings(res.warnings ?? []);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success(`Design pack "${res.pack.name}" uploaded`, {
        description: res.pack.is_default ? "It is the default for new apps and for Chakram." : "Make it the default to use it for new apps and for Chakram.",
      });
      void invalidate();
    },
  });

  const defaultMutation = useMutation({
    mutationFn: (id: string) => api.setDefaultDesignPack(id),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error("The default design pack was not changed", { description: apiErrorMessage(e) }),
    onSettled: () => setBusyPack(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDesignPack(id),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error("The design pack was not deleted", { description: apiErrorMessage(e) }),
    onSettled: () => setBusyPack(null),
  });

  const makeDefault = (pack: DesignPack) => {
    setBusyPack({ id: pack.id, action: "default" });
    defaultMutation.mutate(pack.id);
  };

  const remove = async (pack: DesignPack) => {
    const ok = await confirm({
      title: `Delete "${pack.name}"?`,
      description: "Apps already created with this pack keep their copy of it. New apps can no longer be created with it.",
      confirmLabel: "Delete pack",
      destructive: true,
    });
    if (!ok) return;
    setBusyPack({ id: pack.id, action: "delete" });
    deleteMutation.mutate(pack.id);
  };

  const packs = packsQuery.data?.packs ?? [];

  return (
    <Panel padded={false}>
      <header className="flex h-11 items-center justify-between gap-3 border-b border-stroke-muted px-4">
        <span className="flex min-w-0 items-center gap-2.5">
          <Palette className="h-4 w-4 text-ink" aria-hidden="true" />
          <h2 className="truncate text-sm font-medium text-ink">Design System</h2>
        </span>
        {packsQuery.data && (
          <span className="truncate text-[11px] text-ink-quaternary">
            Chakram and new apps use {packs.find((p) => p.id === packsQuery.data.default_id)?.name ?? packsQuery.data.default_id}
          </span>
        )}
      </header>

      {packsQuery.isLoading ? (
        <div className="p-4">
          <EmptyState kind="loading">Loading design packs…</EmptyState>
        </div>
      ) : packsQuery.isError ? (
        <div className="p-4">
          <EmptyState kind="error">
            <ErrorText error={packsQuery.error} fallback="The design packs could not be loaded." />
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-stroke-muted">
          {packs.map((pack) => (
            <PackRow
              key={pack.id}
              pack={pack}
              busy={busyPack?.id === pack.id ? busyPack.action : null}
              onMakeDefault={() => makeDefault(pack)}
              onDelete={() => void remove(pack)}
            />
          ))}
        </ul>
      )}

      <div className="space-y-3 border-t border-stroke-muted p-4">
        <div className="space-y-1.5">
          <Label htmlFor={fileId} className={fieldLabel}>Upload a design pack</Label>
          <p className="text-xs text-ink-tertiary">
            A .zip (up to 1 MB) with pack.json and pack.css at its root or in one folder, plus an optional README.md and brand/logo.svg. The pack is checked before it is saved; new apps get its files under src/design/.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={fileInputRef}
              id={fileId}
              type="file"
              accept=".zip,application/zip"
              className="h-9 max-w-xs cursor-pointer text-xs file:mr-3 file:text-xs file:font-medium file:text-ink"
              disabled={uploadMutation.isPending}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setWarnings([]);
                uploadMutation.reset();
              }}
            />
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5"
              disabled={!file || uploadMutation.isPending}
              onClick={() => file && uploadMutation.mutate(file)}
            >
              {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload pack
            </Button>
          </div>
        </div>
        {uploadMutation.isError && (
          <p role="alert" className="whitespace-pre-line rounded-lg border border-stroke-muted bg-raised px-3 py-2 text-xs text-destructive">
            <ErrorText error={uploadMutation.error} fallback="The design pack could not be uploaded." />
          </p>
        )}
        {warnings.length > 0 && (
          <div className="rounded-lg border border-stroke-muted bg-raised px-3 py-2 text-xs text-ink-secondary">
            <p className="font-medium text-ink">Uploaded with warnings</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {dialog}
    </Panel>
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
    ollama: { provider: "ollama", base_url: "", api_key: "", model: "" },
    slack: { webhook_url: "" },
  });
  const providersQuery = useQuery({ queryKey: MODEL_PROVIDERS_QUERY_KEY, queryFn: api.getModelProviders, staleTime: 10 * 60 * 1000 });

  // What each connector feeds and its last probe. A failure just hides that line.
  const statusQuery = useQuery({
    queryKey: CONNECTOR_STATUS_QUERY_KEY,
    queryFn: api.getConnectorStatus,
    staleTime: 60 * 1000,
    retry: false,
  });
  const statusFor = (id: ConnectorStatus["id"]) => statusQuery.data?.find((s) => s.id === id);
  const refreshStatus = () => void queryClient.invalidateQueries({ queryKey: CONNECTOR_STATUS_QUERY_KEY });

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
            provider: String(res.ollama?.provider || "ollama"),
            base_url: String(res.ollama?.base_url || ""),
            model: String(res.ollama?.model || ""),
          },
          slack: { webhook_url: "" },
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
      }));
      refreshStatus();
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
      refreshStatus();
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
  const providerSpec = providersQuery.data?.providers.find((p) => p.id === draft.ollama.provider) ?? providersQuery.data?.providers[0];
  const modelConfigured = !!statusFor("ollama")?.configured || !!ollamaKey?.configured;
  const slackHook = data?.slack?.webhook_url as SecretField | undefined;

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
        description="The model provider (Ollama, OpenAI, Azure OpenAI or Gemini) and the GitHub, Jira, Vercel and Slack credentials for this organization. Leave a secret blank to keep the saved value, or use Clear to remove it. Where the server supplies a value, it is used when nothing is saved here."
        actions={saveButton}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section id="github" title="GitHub" configured={!!ghToken?.configured} status={statusFor("github")}>
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

        <Section id="ollama" title="Model provider" configured={modelConfigured} status={statusFor("ollama")}>
          <div className="space-y-1.5">
            <Label htmlFor="connector-field-provider" className={fieldLabel}>Provider</Label>
            <select
              id="connector-field-provider"
              value={draft.ollama.provider}
              onChange={(e) => setDraft({ ...draft, ollama: { ...draft.ollama, provider: e.target.value } })}
              className="h-10 w-full rounded-md border border-input bg-container px-3 text-sm text-ink"
            >
              {(providersQuery.data?.providers ?? [{ id: "ollama", name: "Ollama" } as ModelProviderSpec]).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {providerSpec && <p className="text-xs text-ink-quaternary">{providerSpec.api_version}</p>}
          </div>
          {providerSpec?.fields.base_url && (
            <div className="space-y-1.5">
              <Label htmlFor="connector-field-2" className={fieldLabel}>{providerSpec.fields.base_url.label}</Label>
              <Input
                id="connector-field-2"
                value={draft.ollama.base_url}
                onChange={(e) => setDraft({ ...draft, ollama: { ...draft.ollama, base_url: e.target.value } })}
                placeholder={providerSpec.fields.base_url.placeholder}
              />
            </div>
          )}
          <SecretInput
            label={providerSpec?.fields.api_key?.label ?? "API key"}
            name={`${providerSpec?.name ?? "Model"} API key`}
            onClear={() => void clearSaved("ollama", "api_key", `${providerSpec?.name ?? "Model"} API key`)}
            clearing={clearing === "ollama.api_key"}
            value={draft.ollama.api_key}
            configured={ollamaKey?.configured}
            masked={ollamaKey?.masked}
            source={ollamaKey?.source}
            onChange={(v) => setDraft({ ...draft, ollama: { ...draft.ollama, api_key: v } })}
          />
          <div className="space-y-1.5">
            <Label htmlFor="connector-field-3" className={fieldLabel}>{providerSpec?.fields.model?.label ?? "Model"}</Label>
            <Input
              id="connector-field-3"
              value={draft.ollama.model}
              onChange={(e) => setDraft({ ...draft, ollama: { ...draft.ollama, model: e.target.value } })}
              placeholder={providerSpec?.fields.model?.placeholder ?? "kimi-k3:cloud"}
            />
          </div>
        </Section>

        <Section id="jira" title="Jira" configured={!!jiraToken?.configured} status={statusFor("jira")}>
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

        <Section id="vercel" title="Vercel" configured={!!vercelToken?.configured} status={statusFor("vercel")}>
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

        <Section id="slack" title="Slack" configured={!!slackHook?.configured} status={statusFor("slack")}>
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
      </div>

      <div className="flex justify-end">{saveButton}</div>

      <DesignSystemSection />
    </PageShell>
  );
}
