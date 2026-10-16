import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import {
  Loader2,
  RefreshCw,
  Terminal,
  Bot,
  User,
  FolderTree,
  GitBranch,
  Search,
  Send,
  Github,
  Rocket,
  Upload,
  X,
  Globe,
  ExternalLink,
  ServerCrash,
  Columns2,
  Code2,
  Eye,
  Download,
  MessageSquare,
  Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { AiIdeProvider, pendingPreviewFiles, useAiIde } from "@/context/AiIdeContext";
import { AiFileTree } from "@/components/ai-ide/AiFileTree";
import { AiCodeEditor } from "@/components/ai-ide/AiCodeEditor";
import { useAiGenerationWS } from "@/hooks/useAiGenerationWS";
import { DESIGN_PACKS_QUERY_KEY, api, apiClient } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AiIdePreview } from "@/components/ai-ide/AiIdePreview";
import { DesignPanel, type SelectedElement } from "@/components/ai-ide/DesignPanel";
import type { StyleTarget } from "@/components/ai-ide/ElementInspector";
import { AppLibrary } from "@/components/ai-ide/AppLibrary";
import { applyTextEdit, findOpeningTag, readClassName, setClassName } from "@/lib/source-edit";
import { downloadWorkspaceZip } from "@/lib/ai-ide-download";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { apiErrorMessage } from "@/lib/api-error";
import { useAskDialog } from "@/components/ui/ask-dialog";

const RUNTIME_GITHUB_TOKEN_STORAGE_KEY = "ai-ide:github-token";
const AI_IDE_SESSION_KEY = "aidlc-ai-ide-session";

function persistAiIdeSession(workspaceId: string, idea: string) {
  try {
    localStorage.setItem(AI_IDE_SESSION_KEY, JSON.stringify({ workspaceId, idea }));
  } catch {
    /* ignore */
  }
}

function getRuntimeGithubToken(): string {
  const fromEnv = (import.meta as any)?.env?.VITE_GITHUB_TOKEN;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();

  try {
    const fromStorage = window.sessionStorage.getItem(RUNTIME_GITHUB_TOKEN_STORAGE_KEY);
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
  } catch {
    /* storage unavailable: no saved token */
  }

  return "";
}

function errorDetail(error: unknown): string {
  return apiErrorMessage(error);
}

function normalizeDeploymentUrl(url?: string | null): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}`;
}

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; tone: StatusTone } | null> = {
  idle: null,
  creating: { label: "Creating workspace", tone: "info" },
  planning: { label: "Planning", tone: "info" },
  generating: { label: "Generating code", tone: "info" },
  done: { label: "Ready", tone: "success" },
  error: { label: "Error", tone: "critical" },
};

// ── Idea Input (shown before workspace exists) ────────────────────────────────

function IdeaScreen({
  onBuild,
  onOpenApp,
  notice,
}: {
  /** `packId` is the design pack the app is created with; undefined leaves the choice to the server. */
  onBuild: (idea: string, packId?: string) => void;
  onOpenApp: (app: { workspace_id: string; idea: string | null; name: string | null }) => void;
  notice?: string | null;
}) {
  const [idea, setIdea] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [chosenPackId, setChosenPackId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { state } = useAiIde();
  const isLoading = state.status === "creating";
  // The design system the app starts from. When the list cannot be loaded the selector is
  // hidden and no pack is sent: the server then uses the organization's default.
  const packsQuery = useQuery({ queryKey: DESIGN_PACKS_QUERY_KEY, queryFn: api.listDesignPacks, retry: false });
  const packs = packsQuery.data?.packs ?? [];
  const selectedPackId =
    chosenPackId && packs.some((p) => p.id === chosenPackId) ? chosenPackId : packsQuery.data?.default_id;

  const handleSubmit = () => {
    if (!idea.trim() || isLoading) return;
    onBuild(idea.trim(), packsQuery.data ? selectedPackId : undefined);
  };

  const readPrdFile = async (file: File) => {
    const allowedExt = [".txt", ".md", ".markdown", ".json", ".yaml", ".yml"];
    const lowerName = file.name.toLowerCase();
    const isAllowed = allowedExt.some((ext) => lowerName.endsWith(ext));

    if (!isAllowed) {
      setUploadError("Unsupported file type. Upload .txt, .md, .markdown, .json, .yaml, or .yml");
      return;
    }

    const content = await file.text();
    const cleaned = content.trim();
    if (!cleaned) {
      setUploadError("The uploaded PRD file is empty.");
      return;
    }

    setIdea(cleaned);
    setUploadedFileName(file.name);
    setUploadError(null);
  };

  const onPickFile: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await readPrdFile(file);
    } catch {
      setUploadError("Failed to read file content. Please try again.");
    } finally {
      if (event.target) event.target.value = "";
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader
          title="App Studio"
          description="Describe the app you want, or upload a PRD. A React application is planned and generated from it, and you can then edit, preview, commit and deploy it."
        />

        {state.status === "error" && state.statusMessage && (
          <p role="alert" className="rounded-lg border border-stroke-muted bg-container px-4 py-3 text-sm text-destructive">
            Could not start the build: {state.statusMessage}
          </p>
        )}
        {notice && state.status !== "error" && (
          <p className="rounded-lg border border-stroke-muted bg-container px-4 py-3 text-sm text-ink-secondary">{notice}</p>
        )}

        <div className="rounded-lg border border-stroke-muted bg-container">
          <Textarea
            value={idea}
            onChange={(e) => {
              setIdea(e.target.value);
              if (uploadError) setUploadError(null);
            }}
placeholder="Describe the app to build: its pages, main features and data."
            className="min-h-[160px] resize-none rounded-none border-0 bg-transparent p-4 text-sm focus-visible:ring-0 placeholder:text-ink-quaternary"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
            }}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stroke-muted px-4 py-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.markdown,.json,.yaml,.yml"
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                >
                  <Upload className="h-4 w-4" />
                  Upload PRD
                </Button>
                {uploadedFileName && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 font-mono text-xs text-ink-secondary">
                    <span className="max-w-[180px] truncate">{uploadedFileName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedFileName(null);
                        setIdea("");
                        setUploadError(null);
                      }}
                      className="text-ink-tertiary hover:text-ink"
                      aria-label="Clear uploaded PRD"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
                {packsQuery.data && packs.length > 0 && (
                  <Select value={selectedPackId ?? ""} onValueChange={setChosenPackId} disabled={isLoading}>
                    <SelectTrigger className="h-8 w-auto min-w-[180px] gap-2 text-xs" aria-label="Design system">
                      <Palette className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" aria-hidden="true" />
                      <SelectValue placeholder="Design system" />
                    </SelectTrigger>
                    <SelectContent>
                      {packs.map((pack) => (
                        <SelectItem key={pack.id} value={pack.id} className="text-xs">
                          {pack.name}
                          {pack.id === packsQuery.data?.default_id ? " (default)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <span className="text-xs text-ink-tertiary">
                  <Kbd>{/Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘" : "Ctrl"}</Kbd> + <Kbd>Enter</Kbd> to build
                </span>
              </div>
              {uploadError && <span className="text-xs text-destructive">{uploadError}</span>}
            </div>

            <Button onClick={handleSubmit} disabled={!idea.trim() || isLoading} className="gap-2">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLoading ? "Creating workspace…" : "Build app"}
            </Button>
          </div>
        </div>

        {/* Example ideas */}
        <div className="space-y-2">
          <p className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
            Example prompts (select one to fill the box)
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              "A luxury dark-themed fintech dashboard for portfolio tracking",
              "An e-commerce product page with glassmorphism",
              "A high-performance DevOps monitoring console",
              "A genomic sequencing data visualizer app",
            ].map((ex) => (
              <button
                key={ex}
                onClick={() => setIdea(ex)}
                className="rounded-full border border-border px-3 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-raised"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <AppLibrary onOpen={onOpenApp} />
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 text-[10px] rounded-md bg-raised border border-stroke-muted text-ink">
      {children}
    </kbd>
  );
}

type LeftPaneKey = "explorer" | "git";

function ActivityRail({
  onSearchClick,
  activePane,
  onSelectPane,
}: {
  onSearchClick: () => void;
  activePane: LeftPaneKey;
  onSelectPane: (pane: LeftPaneKey) => void;
}) {
  const items: Array<{ icon: any; label: string; key: LeftPaneKey | "search"; onClick?: () => void }> = [
    { icon: FolderTree, label: "Explorer", key: "explorer", onClick: () => onSelectPane("explorer") },
    { icon: Search, label: "Search", key: "search", onClick: onSearchClick },
    { icon: GitBranch, label: "Source Control", key: "git", onClick: () => onSelectPane("git") },
  ];

  return (
    <div className="w-11 border-r border-border bg-raised flex flex-col items-center py-2 gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.key !== "search" && item.key === activePane;
        return (
          <button
            key={item.label}
            title={item.label}
            onClick={() => {
              item.onClick?.();
            }}
            className={cn(
              "h-8 w-8 rounded-md border flex items-center justify-center transition-colors",
              isActive
                ? "bg-raised border-stroke text-primary"
                : "bg-transparent border-transparent text-muted-foreground hover:text-ink hover:bg-raised"
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

function GitChangesPane() {
  const { state, setActiveFile } = useAiIde();
  const { fileStatuses } = state;

  const entries = Object.entries(fileStatuses)
    .filter(([, s]) => Boolean(s) && s !== "P")
    .map(([path, status]) => ({ path, status: status as Exclude<typeof status, null> }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const labelFor = (s: string) => (s === "A" ? "Added" : s === "M" ? "Modified" : "Updated");
  const badgeClass = (s: string) =>
    s === "A"
      ? "border-stroke-muted bg-raised text-positive"
      : s === "M"
        ? "border-stroke-muted bg-raised-2 text-warning"
        : "border-stroke-muted bg-raised text-info";

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-stroke-muted flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium">Changes</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{entries.length}</span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {entries.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              No changes yet.
            </div>
          ) : (
            entries.map((e) => (
              <button
                key={e.path}
                onClick={() => setActiveFile(e.path)}
                className="w-full text-left rounded-md px-2 py-1.5 hover:bg-raised transition-colors flex items-center gap-2"
                title="Open file"
              >
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-semibold", badgeClass(e.status))}>
                  {e.status}
                </span>
                <span className="text-xs truncate flex-1 min-w-0">{e.path}</span>
                <span className="text-[10px] text-muted-foreground flex-shrink-0">{labelFor(e.status)}</span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Telemetry + Chat panel ───────────────────────────────────────────────────

type DeployLogEvent = { id?: string; message?: string; timestamp?: number; level?: string };
type DeployStatus = { status: string; url?: string; domains?: string[] };
type DeploymentInfo = {
  deployedUrl: string | null;
  deployStatus: DeployStatus | null;
  deployLogs: DeployLogEvent[];
  repoUrl: string | null;
  stableDomain: string | null;
  /** A push or deploy request is in flight. */
  busy: boolean;
};
type ChatMessage = { role: "user" | "assistant"; message: string; failed?: boolean };
type CommandResult = { ok: boolean; reply: string };

function RightRail({
  idea,
  onDeploymentUpdate,
  onOpenPreview,
  redeployNonce,
}: {
  idea: string;
  onDeploymentUpdate: (payload: DeploymentInfo) => void;
  onOpenPreview: () => void;
  redeployNonce: number;
}) {
  const { state, dispatch, setActiveFile, reset } = useAiIde();
  const { generationLog, status, files, workspaceId, activeFile } = state;

  const logEndRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [manualConversation, setManualConversation] = useState<ChatMessage[]>([]);
  const [isChatBusy, setIsChatBusy] = useState(false);
  const isChatBusyRef = useRef(false);
  const [repoName, setRepoName] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const branchName = "main";
  const commitMessage = "chore: update App Builder workspace";
  const repoPrivate = true;
  const [isGitBusy, setIsGitBusy] = useState(false);
  const [isDeployBusy, setIsDeployBusy] = useState(false);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);
  const [deployLogs, setDeployLogs] = useState<DeployLogEvent[]>([]);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const [stableDomain, setStableDomain] = useState<string | null>(null); // domains[0] stable alias, allows iframes
  const pollRef = useRef<number | null>(null);
  const logPollRef = useRef<number | null>(null);
  const FINAL_DEPLOY_STATES = new Set(["READY", "ERROR", "CANCELED"]);
  const lastRedeployNonceRef = useRef(0);

  useEffect(() => {
    if (!workspaceId || repoName.trim()) return;
    const slug = idea
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40);
    const suffix = workspaceId.split("-")[0];
    const defaultRepo = (slug ? `${slug}-${suffix}` : `ai-ide-${suffix}`).slice(0, 80);
    setRepoName(defaultRepo);
  }, [workspaceId, idea, repoName]);

  useEffect(() => {
    if (githubToken.trim()) return;
    const token = getRuntimeGithubToken();
    if (token) setGithubToken(token);
  }, [githubToken]);

  // After a reload the repository this workspace pushes to comes from the server, so
  // Push & Deploy updates it instead of creating a second one.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    apiClient
      .get<{ repo_url?: string | null; repo_name?: string | null }>(`/ai-ide/workspace/${workspaceId}/repo`)
      .then((res) => {
        if (cancelled) return;
        if (res.data?.repo_url) setRepoUrl(res.data.repo_url);
        if (res.data?.repo_name) setRepoName(res.data.repo_name);
      })
      .catch(() => {
        /* no repository info: Push & Deploy will create one */
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const chatMessages = manualConversation;
  const activityEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [manualConversation.length]);

  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [generationLog.length]);

  const busy = isGitBusy || isDeployBusy;
  useEffect(() => {
    onDeploymentUpdate({ deployedUrl, deployStatus, deployLogs, repoUrl, stableDomain, busy });
  }, [deployedUrl, deployStatus, deployLogs, repoUrl, stableDomain, busy, onDeploymentUpdate]);

  /** `targetFile` overrides the active file, for requests that name the file (preview "Fix with AI"). */
  const runCommand = async (message: string, targetFile?: string): Promise<CommandResult> => {
    const input = message.trim();
    const lower = input.toLowerCase();
    const createFileMatch = input.match(/create\s+file\s+(.+)/i);
    if (createFileMatch?.[1]) {
      const filePath = createFileMatch[1].trim();
      let generatedContent: string | undefined;
      if (workspaceId) {
        const response = await apiClient.post<{ ok: boolean; path: string; content: string }>("/ai-ide/file/create", {
          workspace_id: workspaceId,
          path: filePath,
        });
        generatedContent = response.data?.content;
      }
      dispatch({ type: "ADD_FILE", path: filePath, content: generatedContent, markAs: "A", makeActive: true });
      dispatch({ type: "ADD_LOG", message: `Creating ${filePath}…` });
      return { ok: true, reply: `Created ${filePath}.` };
    }

    const createFolderMatch = input.match(/create\s+folder\s+(.+)/i);
    if (createFolderMatch?.[1]) {
      const folderPath = createFolderMatch[1].trim();
      dispatch({ type: "ADD_DIR", path: folderPath });
      dispatch({ type: "ADD_LOG", message: `Creating ${folderPath}…` });
      return { ok: true, reply: `Created folder ${folderPath}.` };
    }

    const renameMatch = input.match(/rename\s+(.+)\s+to\s+(.+)/i);
    if (renameMatch?.[1] && renameMatch?.[2]) {
      const fromPath = renameMatch[1].trim();
      const toPath = renameMatch[2].trim();
      if (workspaceId) {
        await apiClient.post("/ai-ide/file/rename", { workspace_id: workspaceId, from_path: fromPath, to_path: toPath });
      }
      dispatch({ type: "RENAME_PATH", fromPath, toPath });
      dispatch({ type: "ADD_LOG", message: `Updated ${fromPath} -> ${toPath}` });
      return { ok: true, reply: `Renamed ${fromPath} to ${toPath}.` };
    }

    const moveMatch = input.match(/move\s+(.+)\s+to\s+(.+)/i);
    if (moveMatch?.[1] && moveMatch?.[2]) {
      const fromPath = moveMatch[1].trim();
      const toPath = moveMatch[2].trim();
      if (workspaceId) {
        await apiClient.post("/ai-ide/file/move", { workspace_id: workspaceId, from_path: fromPath, to_path: toPath });
      }
      dispatch({ type: "MOVE_PATH", fromPath, toPath });
      dispatch({ type: "ADD_LOG", message: `Updated ${fromPath} -> ${toPath}` });
      return { ok: true, reply: `Moved ${fromPath} to ${toPath}.` };
    }

    const deleteMatch = input.match(/delete\s+(.+)/i);
    if (deleteMatch?.[1]) {
      const path = deleteMatch[1].trim();
      if (workspaceId) {
        await apiClient.post("/ai-ide/file/delete", { workspace_id: workspaceId, path });
      }
      dispatch({ type: "DELETE_PATH", path });
      dispatch({ type: "ADD_LOG", message: `Deleted ${path}` });
      return { ok: true, reply: `Deleted ${path}.` };
    }

    const openMatch = input.match(/open\s+(.+)/i);
    if (openMatch?.[1]) {
      const target = openMatch[1].trim();
      const match = state.filePaths.find((p) => p === target) ?? state.filePaths.find((p) => p.endsWith(`/${target}`));
      if (!match) return { ok: false, reply: `No file named ${target} in this workspace.` };
      setActiveFile(match);
      return { ok: true, reply: `Opened ${match}.` };
    }

    if (lower.startsWith("deploy") || lower.startsWith("init git")) {
      return {
        ok: true,
        reply: "Deployment is not started from chat. Open the Preview tab and use Push & Deploy: it creates a GitHub repository for the app (a token is asked for once) and deploys it to Vercel.",
      };
    }

    const editTarget = targetFile ?? activeFile;
    if (workspaceId && editTarget && files[editTarget]) {
      dispatch({ type: "ADD_LOG", message: `Editing ${editTarget} with AI…` });
      const suggestion = await api.suggestCode({
        workspace_id: workspaceId,
        file_path: editTarget,
        content: files[editTarget],
        instruction: input,
        history: [],
      });
      dispatch({ type: "UPDATE_FILE", path: editTarget, content: suggestion.modified });
      await apiClient.post("/ai-ide/file/update", {
        workspace_id: workspaceId,
        path: editTarget,
        content: suggestion.modified,
      });
      return {
        ok: true,
        reply: suggestion.diff_summary || suggestion.explanation || `Updated ${editTarget}.`,
      };
    }

    return {
      ok: false,
      reply: "Nothing was changed. Open a file and describe the edit, or use a command: create file <path>, create folder <path>, rename <a> to <b>, move <a> to <b>, delete <path>, open <path>.",
    };
  };

  const submitChat = async (userMessage: string, targetFile?: string) => {
    if (!userMessage.trim() || isChatBusyRef.current) return;
    isChatBusyRef.current = true;
    setManualConversation((prev) => [...prev, { role: "user", message: userMessage }]);
    setIsChatBusy(true);
    let result: CommandResult;
    try {
      result = await runCommand(userMessage, targetFile);
    } catch (error) {
      result = { ok: false, reply: `The request failed: ${errorDetail(error)}` };
    } finally {
      isChatBusyRef.current = false;
      setIsChatBusy(false);
    }
    setManualConversation((prev) => [...prev, { role: "assistant", message: result.reply, failed: !result.ok }]);
  };

  const sendChat = async () => {
    const userMessage = chatInput.trim();
    if (!userMessage || isChatBusy) return;
    setChatInput("");
    await submitChat(userMessage);
  };

  // The preview's "Fix with AI" sends the failing file and the error here.
  const submitChatRef = useRef(submitChat);
  submitChatRef.current = submitChat;
  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; instruction?: string }>).detail;
      if (!detail?.instruction) return;
      if (detail.path) setActiveFile(detail.path);
      void submitChatRef.current(detail.instruction, detail.path);
    };
    window.addEventListener("ai-ide-chat-request", onRequest);
    return () => window.removeEventListener("ai-ide-chat-request", onRequest);
  }, [setActiveFile]);

  const computeDefaultRepoName = () => {
    if (!workspaceId) return "";
    const slug = idea
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40);
    const suffix = workspaceId.split("-")[0];
    return (slug ? `${slug}-${suffix}` : `ai-ide-${suffix}`).slice(0, 80);
  };

  /** Returns true when the repository exists on GitHub and the push succeeded. */
  const initializeGitAndPush = async (opts?: { repoName?: string; githubToken?: string }): Promise<boolean> => {
    if (!workspaceId) return false;
    const token = (opts?.githubToken ?? githubToken).trim();
    const name = (opts?.repoName ?? repoName).trim();
    if (!name || !token) return false;
    setIsGitBusy(true);
    try {
      const response = await apiClient.post("/ai-ide/git/init-and-push", {
        workspace_id: workspaceId,
        github_token: token,
        repo_name: name,
        private: repoPrivate,
        branch: branchName,
      });
      setRepoUrl(response.data?.repo_url ?? null);
      dispatch({ type: "ADD_LOG", message: `✓ Repository initialized: ${String(response.data?.repo_url || "")}` });
      return true;
    } catch (error) {
      const detail = errorDetail(error);
      dispatch({ type: "ADD_LOG", message: `✗ Git initialization failed: ${detail}` });
      toast.error(`Could not create the GitHub repository: ${detail}`);
      return false;
    } finally {
      setIsGitBusy(false);
    }
  };

  useEffect(() => {
    if (!workspaceId) return;
    if (redeployNonce === lastRedeployNonceRef.current) return;
    lastRedeployNonceRef.current = redeployNonce;
    if (redeployNonce === 0) return;

    onOpenPreview();

    void (async () => {
      // No repository yet (no token when generation finished): create it first.
      if (!repoUrl) {
        let token = githubToken.trim();
        if (!token) {
          token = (await requestToken()) ?? "";
          if (!token) {
            toast.error("Deployment needs a GitHub token to create the repository. Nothing was deployed.");
            return;
          }
        }
        const name = repoName.trim() || computeDefaultRepoName();
        if (!repoName.trim() && name) setRepoName(name);
        const created = await initializeGitAndPush({ repoName: name, githubToken: token });
        if (!created) {
          setDeployStatus({ status: "ERROR" });
          return;
        }
        await deployWorkspace();
        return;
      }
      // The deployment builds from GitHub, so a failed push means there is nothing new to deploy.
      // The server forgets tokens on restart, so the push always carries one.
      let pushToken = githubToken.trim();
      if (!pushToken) {
        pushToken = (await requestToken()) ?? "";
        if (!pushToken) {
          toast.error("Pushing needs a GitHub token. Nothing was deployed.");
          return;
        }
      }
      const pushed = await commitAndPush(pushToken);
      if (!pushed) return;
      await deployWorkspace();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redeployNonce, workspaceId]);

  /** Returns true when the commit reached GitHub. */
  const commitAndPush = async (token: string): Promise<boolean> => {
    if (!workspaceId) return false;
    setIsGitBusy(true);
    try {
      const response = await apiClient.post<{ sha?: string; push_ok?: boolean; committed?: boolean }>(
        "/ai-ide/git/commit-and-push",
        {
          workspace_id: workspaceId,
          message: commitMessage,
          branch: branchName,
          github_token: token,
        },
      );
      if (response.data?.push_ok === false) {
        dispatch({ type: "ADD_LOG", message: "✗ GitHub did not accept the push" });
        toast.error("GitHub did not accept the push, so nothing was redeployed.");
        return false;
      }
      const sha = response.data?.sha || "";
      const what = response.data?.committed === false ? "Up to date on GitHub at" : "Pushed commit";
      dispatch({ type: "ADD_LOG", message: sha ? `✓ ${what} ${sha.slice(0, 7)}` : "✓ Pushed" });
      return true;
    } catch (error) {
      const detail = errorDetail(error);
      dispatch({ type: "ADD_LOG", message: `✗ Commit/push failed: ${detail}` });
      toast.error(`Commit and push failed, so nothing was redeployed: ${detail}`);
      return false;
    } finally {
      setIsGitBusy(false);
    }
  };

  const stopPolling = () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (logPollRef.current) { window.clearInterval(logPollRef.current); logPollRef.current = null; }
  };

  const deployWorkspace = async () => {
    if (!workspaceId) return;
    stopPolling();
    setIsDeployBusy(true);
    setDeployStatus({ status: "INITIALIZING" });
    setDeployLogs([]);
    setDeployedUrl(null);
    try {
      const response = await apiClient.post<{ deployment_id?: string; deploymentId?: string; status?: string; url?: string; domains?: string[] }>("/ai-ide/deploy", {
        workspace_id: workspaceId,
        branch: branchName,
        target: "production",
      });
      const deploymentId = response.data?.deployment_id ?? response.data?.deploymentId;
      const responseDomains: string[] = Array.isArray(response.data?.domains) ? response.data.domains : [];
      if (response.data?.status) {
        setDeployStatus({ status: response.data.status, url: response.data.url, domains: responseDomains });
      }
      // Prefer stable alias (domains[0]) over the deployment-specific URL aliases work in iframes
      const stableAlias = responseDomains[0] ? normalizeDeploymentUrl(responseDomains[0]) : null;
      const initialUrl =
        stableAlias ??
        normalizeDeploymentUrl(response.data?.url) ??
        normalizeDeploymentUrl(response.data?.domains?.[1]);
      if (stableAlias) setStableDomain(stableAlias);
      if (initialUrl) setDeployedUrl(initialUrl);
      if (!deploymentId) {
        setDeployStatus({ status: "ERROR" });
        dispatch({ type: "ADD_LOG", message: "✗ Deployment failed: the server returned no deployment id" });
        toast.error("Deployment could not be tracked: the server returned no deployment id.");
        return;
      }
      dispatch({ type: "ADD_LOG", message: `✓ Deployment triggered: ${deploymentId}` });

      {
        let statusFailures = 0;
        pollRef.current = window.setInterval(async () => {
          try {
            const statusRes = await apiClient.get<{ status: string; url?: string; domains?: string[] }>(`/deployments/${deploymentId}/status`);
            const polledDomains: string[] = Array.isArray(statusRes.data.domains) ? statusRes.data.domains : [];
            setDeployStatus({ status: statusRes.data.status, url: statusRes.data.url, domains: polledDomains });
            // Always prefer stable alias from domains[0]
            const polledStable = polledDomains[0] ? normalizeDeploymentUrl(polledDomains[0]) : null;
            const polledUrl = polledStable ?? normalizeDeploymentUrl(statusRes.data.url);
            if (polledStable) setStableDomain(polledStable);
            if (polledUrl) setDeployedUrl(polledUrl);
            statusFailures = 0;
            if (FINAL_DEPLOY_STATES.has(statusRes.data.status)) {
              stopPolling();
              if (statusRes.data.status === "READY") {
                dispatch({ type: "ADD_LOG", message: `✓ Deployment ready: ${polledStable ?? statusRes.data.url}` });
              } else {
                dispatch({ type: "ADD_LOG", message: `✗ Deployment ended with status ${statusRes.data.status}` });
              }
            }
          } catch (error) {
            // One failed poll is transient; several in a row means the status can no longer be read.
            statusFailures += 1;
            if (statusFailures >= 5) {
              stopPolling();
              setDeployStatus({ status: "UNKNOWN" });
              dispatch({ type: "ADD_LOG", message: `✗ Lost track of the deployment: ${errorDetail(error)}` });
            }
          }
        }, 5000);

        logPollRef.current = window.setInterval(async () => {
          try {
            const logsRes = await apiClient.get<{ events?: Array<{ id?: string; message?: string; timestamp?: number; level?: string }> }>(`/deployments/${deploymentId}/events?limit=50`);
            setDeployLogs(logsRes.data.events || []);
          } catch {
            /* log lines are best-effort; the status poll reports a lost connection */
          }
        }, 5000);
        const watchedPoll = pollRef.current;
        window.setTimeout(() => {
          // Only if this deployment is still the one being watched.
          if (pollRef.current !== watchedPoll) return;
          stopPolling();
          setDeployStatus({ status: "UNKNOWN" });
          dispatch({ type: "ADD_LOG", message: "✗ Stopped watching the deployment after 10 minutes without a final status" });
        }, 10 * 60 * 1000);
      }
    } catch (error) {
      const detail = errorDetail(error);
      setDeployStatus({ status: "ERROR" });
      dispatch({ type: "ADD_LOG", message: `✗ Deployment failed: ${detail}` });
      toast.error(`Deployment failed: ${detail}`);
    } finally {
      setIsDeployBusy(false);
    }
  };

  const { dialog: askDialog, askText } = useAskDialog();

  /** Asks for a GitHub token in an in-app dialog; resolves to the token, or null if cancelled. */
  const requestToken = async (): Promise<string | null> => {
    const next = await askText({
      title: "GitHub token",
      description:
        "Used to create a repository for this app and push to it, which deployment builds from. It is kept in this browser tab for this session only.",
      confirmLabel: "Save token",
      input: { label: "Personal access token (repo scope)", secret: true, placeholder: "ghp_…" },
    });
    if (!next) return null;
    let stored = true;
    try {
      // sessionStorage: the token does not outlive the browser session.
      window.sessionStorage.setItem(RUNTIME_GITHUB_TOKEN_STORAGE_KEY, next);
    } catch {
      stored = false;
    }
    setGithubToken(next);
    toast.success(
      stored
        ? "GitHub token saved for this browser session."
        : "GitHub token set for this session only; the browser refused to store it.",
    );
    return next;
  };
  const setTokenInteractively = () => void requestToken();

  return (
    <div className="h-full flex flex-col bg-raised text-ink">
      {askDialog}
      <div className="px-4 py-3 border-b border-border flex-shrink-0 flex items-center justify-between bg-raised">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Chat</span>
        </div>
        <div className="flex items-center gap-2">
          {!githubToken.trim() && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs px-2 gap-1 rounded-md"
              onClick={setTokenInteractively}
            >
              <Github className="h-3.5 w-3.5" />
              Set Token
            </Button>
          )}
          {(status === "done" || status === "error") && (
            <Button variant="outline" size="sm" className="h-6 text-xs px-2 gap-1 rounded-md" onClick={reset}>
              <RefreshCw className="h-3.5 w-3.5" />
              New Session
            </Button>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-b border-border">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Activity</span>
          {busy && (
            <span className="flex items-center gap-1.5 text-xs text-ink-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {isGitBusy ? "Pushing to GitHub…" : "Starting deployment…"}
            </span>
          )}
          <span className="ml-auto text-xs tabular-nums text-ink-tertiary">{generationLog.length}</span>
        </div>
        <div className="max-h-36 overflow-y-auto px-4 pb-2 font-mono text-[11px] leading-relaxed">
          {generationLog.length === 0 ? (
            <p className="py-2 font-sans text-xs text-ink-tertiary">Nothing has run yet.</p>
          ) : (
            generationLog.slice(-60).map((entry, i) => (
              <p
                key={`${i}-${entry}`}
                className={cn(
                  "break-words",
                  entry.startsWith("✗") || entry.startsWith("Failed:") || entry.startsWith("Error:")
                    ? "text-destructive"
                    : "text-ink-secondary",
                )}
              >
                {entry}
              </p>
            ))
          )}
          <div ref={activityEndRef} />
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-rows-[1fr_auto]">
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-3">
            {chatMessages.length === 0 && !isChatBusy && (
              <p className="px-1 py-6 text-center text-xs leading-relaxed text-ink-tertiary">
                Open a file and describe a change to edit it, or type a command: create file, create folder, rename,
                move, delete, open.
              </p>
            )}
            <>
              {chatMessages.map((msg, i) => (
                <div
                  key={`${msg.message}-${i}`}
                  className={cn(
                    "flex gap-2",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  {msg.role === "assistant" && (
                    <div className="h-6 w-6 rounded-full bg-raised flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-ink-tertiary" />
                    </div>
                  )}

                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-xs",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground ml-auto"
                        : msg.failed
                          ? "bg-container text-destructive"
                          : "bg-container text-ink"
                    )}
                  >
                    <pre className="whitespace-pre-wrap font-sans">{msg.message}</pre>
                  </div>

                  {msg.role === "user" && (
                    <div className="h-6 w-6 rounded-full bg-raised flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User className="h-3.5 w-3.5 text-ink-tertiary" />
                    </div>
                  )}
                </div>
              ))}
            </>
            {isChatBusy && (
              <p className="flex items-center gap-2 px-1 text-xs text-ink-tertiary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
              </p>
            )}

            <div ref={logEndRef} />
          </div>
        </ScrollArea>

        <div className="p-2 border-t border-stroke-muted flex-shrink-0">
          <div className="flex gap-2">
            <Textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder="Describe what to create/edit/open…"
              className="min-h-[60px] max-h-[120px] resize-none text-xs"
            />
            <Button
              size="sm"
              className="self-end h-9 w-9 p-0"
              type="button"
              onClick={sendChat}
              disabled={!chatInput.trim() || isChatBusy}
              aria-label="Send message"
            >
              {isChatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

type CenterView = "editor" | "split" | "preview";

function IdeLayout({ idea, restored }: { idea: string; restored: boolean }) {
  const { state, setActiveFile } = useAiIde();
  const { workspaceId, status, statusMessage, failedFiles, files } = state;
  const [previewMode, setPreviewMode] = useState<"local" | "vercel">("local");
  const isMobile = useIsMobile();
  const { startGeneration, attachToRun } = useAiGenerationWS(workspaceId);
  const startedRef = useRef(false);
  const attachedRef = useRef(false);
  // Code and the running app side by side while a run streams in; a restored
  // workspace opens on the app itself.
  const [centerView, setCenterView] = useState<CenterView>(() => (status === "done" ? "preview" : "split"));
  const pendingFiles = useMemo(() => pendingPreviewFiles(state), [state]);
  const generating = status === "creating" || status === "planning" || status === "generating";
  // ── Visual editing and design ─────────────────────────────────────────────
  const { dispatch } = useAiIde();
  const [rightTab, setRightTab] = useState<"chat" | "design">("chat");
  const [inspecting, setInspecting] = useState(false);
  const [selection, setSelection] = useState<SelectedElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const filesRef = useRef(files);
  filesRef.current = files;

  // Undo/redo for design-tool edits: each entry holds every touched file's before/after text.
  type HistoryEntry = Record<string, { before: string | undefined; after: string }>;
  const [history, setHistory] = useState<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });

  /** Write files the user changed through the design tools: state first, then the server. */
  const writeFiles = useCallback(
    async (changes: Record<string, string>) => {
      const entries = Object.entries(changes).filter(([path, content]) => filesRef.current[path] !== content);
      entries.forEach(([path, content]) => dispatch({ type: "UPDATE_FILE", path, content }));
      if (!workspaceId) return;
      await Promise.all(
        entries.map(([path, content]) =>
          apiClient.post("/ai-ide/file/update", { workspace_id: workspaceId, path, content }).catch((error) => {
            toast.error(`Could not save ${path}: ${errorDetail(error)}`, { id: `ai-ide-save-${path}` });
          }),
        ),
      );
    },
    [dispatch, workspaceId],
  );

  const applyFiles = useCallback(
    async (changes: Record<string, string>) => {
      const entry: HistoryEntry = {};
      Object.entries(changes).forEach(([path, after]) => {
        if (filesRef.current[path] !== after) entry[path] = { before: filesRef.current[path], after };
      });
      if (!Object.keys(entry).length) return;
      setHistory((h) => ({ past: [...h.past.slice(-49), entry], future: [] }));
      await writeFiles(changes);
    },
    [writeFiles],
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      const entry = h.past[h.past.length - 1];
      if (!entry) return h;
      const changes: Record<string, string> = {};
      Object.entries(entry).forEach(([path, { before }]) => {
        changes[path] = before ?? "";
      });
      void writeFiles(changes);
      return { past: h.past.slice(0, -1), future: [entry, ...h.future] };
    });
  }, [writeFiles]);

  const redo = useCallback(() => {
    setHistory((h) => {
      const entry = h.future[0];
      if (!entry) return h;
      const changes: Record<string, string> = {};
      Object.entries(entry).forEach(([path, { after }]) => {
        changes[path] = after;
      });
      void writeFiles(changes);
      return { past: [...h.past, entry], future: h.future.slice(1) };
    });
  }, [writeFiles]);

  // Ctrl+Z / Ctrl+Shift+Z undo design edits, except while typing in a field or the code editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.closest("input, textarea, select, [contenteditable], .monaco-editor"))) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /**
   * Where style edits for the selection go: the element's own JSX, or, for an element inside a
   * kit component, the component's use on the page (so a Panel on one page changes, not every Panel).
   */
  const styleTarget = useMemo<StyleTarget | null>(() => {
    if (!selection) return null;
    const own = selection.file.startsWith("src/chronos/") && selection.usage ? null : selection;
    const file = own ? own.file : selection.usage!.file;
    const line = own ? own.line : selection.usage!.line;
    const tagName = own ? own.tag : selection.usage!.component;
    const source = files[file];
    const tag = source ? findOpeningTag(source, line, tagName, own ? own.className : null) : null;
    if (!tag) return null;
    const info = readClassName(tag);
    const className = info.kind === "literal" ? (info as { value: string }).value : info.kind === "none" ? "" : null;
    return { file, line, tag: tagName, className, isInstance: !own };
  }, [selection, files]);

  const swapMark = useCallback(
    (sel: SelectedElement, newId: string) => {
      const oldId = sel.markId;
      if (!oldId || oldId === newId) return;
      // The id is a literal on the page that renders <Mark> (or in its data); edit it there.
      const file = sel.usage?.file ?? sel.file;
      const source = filesRef.current[file];
      const tag = source ? findOpeningTag(source, sel.usage?.line ?? sel.line, sel.usage?.component ?? "Mark", null) : null;
      const anchor = tag ?? { start: 0, end: 0, tag: "Mark", text: "" };
      const result = applyTextEdit(filesRef.current, file, anchor, oldId, newId);
      if (result.ok === false) {
        toast.error((result as { reason: string }).reason);
        return;
      }
      void applyFiles({ [result.path]: result.content });
      setSelection((cur) => (cur ? { ...cur, markId: newId } : cur));
    },
    [applyFiles],
  );

  const editText = useCallback(
    (sel: SelectedElement, oldText: string, newText: string) => {
      const source = filesRef.current[sel.file];
      const tag = source ? findOpeningTag(source, sel.line, sel.tag, sel.className) : null;
      if (!tag) {
        toast.error("Could not find that element in the code. Ask the AI to change it instead.");
        return;
      }
      const result = applyTextEdit(filesRef.current, sel.file, tag, oldText, newText);
      if (result.ok === false) {
        // This project compiles without strictNullChecks, so the union does not narrow on its own.
        toast.error((result as { reason: string }).reason);
        return;
      }
      void applyFiles({ [result.path]: result.content });
      setSelection((cur) => (cur && cur.file === sel.file && cur.line === sel.line ? { ...cur, text: newText } : cur));
    },
    [applyFiles],
  );

  const editClass = useCallback(
    (target: StyleTarget, newClass: string) => {
      const source = filesRef.current[target.file];
      const tag = source ? findOpeningTag(source, target.line, target.tag, target.isInstance ? null : target.className) : null;
      const next = tag && source ? setClassName(source, tag, newClass.trim().replace(/\s+/g, " ")) : null;
      if (!next) {
        toast.error("These classes are computed in code. Use Ask AI to restyle this element.");
        return;
      }
      void applyFiles({ [target.file]: next });
    },
    [applyFiles],
  );

  const askAiAboutElement = useCallback((sel: SelectedElement, instruction: string) => {
    const where = `the <${sel.tag}> element whose JSX starts on line ${sel.line}` +
      (sel.className ? ` (className "${sel.className.slice(0, 200)}")` : "") +
      (sel.text ? ` with the text "${sel.text.slice(0, 120)}"` : "");
    window.dispatchEvent(
      new CustomEvent("ai-ide-chat-request", {
        detail: { path: sel.file, instruction: `Change only ${where}: ${instruction}. Keep everything else in the file as it is.` },
      }),
    );
    setRightTab("chat");
  }, []);

  const download = async () => {
    if (!workspaceId) return;
    setDownloading(true);
    try {
      await downloadWorkspaceZip(workspaceId);
    } catch (error) {
      toast.error(`Download failed: ${errorDetail(error)}`);
    } finally {
      setDownloading(false);
    }
  };

  const toggleInspect = useCallback((on: boolean) => {
    setInspecting(on);
    if (on) {
      setRightTab("design");
      setPreviewMode("local");
      setCenterView((v) => (v === "editor" ? "split" : v));
    } else {
      setSelection(null);
    }
  }, []);

  // Automatic repair: once a build has finished, a file that fails to compile or render is sent
  // to the AI fixer once per distinct error (at most 4 per session), so the user rarely sees it.
  const autoFixedRef = useRef<Set<string>>(new Set());
  const statusRef = useRef(status);
  statusRef.current = status;
  const onBuildError = useCallback(
    (error: { path: string; message: string; stage: string }) => {
      if (statusRef.current !== "done") return;
      if (error.path.startsWith("src/chronos/")) return; // kit files are fixed by kit upgrades, not per app
      const key = `${error.path}\u0000${error.message.split("\n")[0].slice(0, 200)}`;
      if (autoFixedRef.current.has(key) || autoFixedRef.current.size >= 4) return;
      autoFixedRef.current.add(key);
      dispatch({ type: "ADD_LOG", message: `Auto-fixing ${error.path} (${error.stage} error)…` });
      toast.message(`Fixing ${error.path.split("/").pop()} automatically…`, { id: `autofix-${error.path}` });
      const instruction =
        `The app failed to ${error.stage === "compile" ? "compile" : error.stage === "import" ? "load" : "render"} ` +
        `because of this file. Fix the error so the page works; keep the rest of the file as it is. ` +
        `Use only components exported by '../chronos' and data the file already imports.\n\n${error.message.slice(0, 1500)}`;
      window.dispatchEvent(new CustomEvent("ai-ide-chat-request", { detail: { path: error.path, instruction } }));
    },
    [dispatch],
  );

  const requestFix = useCallback((path: string, message: string) => {
    const instruction = `Fix this error so the app renders. Keep the rest of the file as it is.\n\n${message.slice(0, 1500)}`;
    window.dispatchEvent(new CustomEvent("ai-ide-chat-request", { detail: { path, instruction } }));
  }, []);
  const [redeployNonce, setRedeployNonce] = useState(0);
  const [leftPane, setLeftPane] = useState<LeftPaneKey>("explorer");
  const navigate = useNavigate();
  const [creatingTests, setCreatingTests] = useState(false);
  const [deployInfo, setDeployInfo] = useState<DeploymentInfo>({
    deployedUrl: null,
    deployStatus: null,
    deployLogs: [],
    repoUrl: null,
    stableDomain: null,
    busy: false,
  });

  // Auto-start generation once workspaceId is ready and status is "planning"
  useEffect(() => {
    if (workspaceId && !startedRef.current && status === "planning") {
      startedRef.current = true;
      setCenterView(isMobile ? "preview" : "split");
      startGeneration(idea);
    }
  }, [workspaceId, status, idea, startGeneration, isMobile]);

  // A restored workspace may still be generating on the server (the page was
  // reloaded mid-run): follow that run instead of showing a half-built app as done.
  useEffect(() => {
    if (!restored || !workspaceId || attachedRef.current) return;
    attachedRef.current = true;
    attachToRun();
  }, [restored, workspaceId, attachToRun]);

  useEffect(() => {
    if (restored && status === "generating" && !isMobile) setCenterView("split");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const previewPane = (
    <div className="relative h-full min-h-0 flex-1">
      <AiIdePreview
        files={files}
        pending={pendingFiles}
        generating={generating}
        onOpenFile={(path) => {
          setActiveFile(path);
          if (centerView === "preview") setCenterView("split");
        }}
        onFixRequest={requestFix}
        inspecting={inspecting}
        onInspectChange={toggleInspect}
        selection={selection}
        onSelect={(sel) => {
          setSelection(sel);
          if (sel) {
            setRightTab("design");
            setActiveFile(sel.file);
          }
        }}
        onTextEdit={editText}
        onBuildError={onBuildError}
      />
    </div>
  );

  // Some files failed but the rest were written: the workspace is usable, the run is not complete.
  const partialFailure = status === "error" && failedFiles.length > 0;
  const badge: { label: string; tone: StatusTone } | null = partialFailure
    ? { label: "Generation incomplete", tone: "critical" }
    : STATUS_BADGE[status];
  const inProgress = status === "creating" || status === "planning" || status === "generating";
  const canRedeploy = (status === "done" || partialFailure) && !deployInfo.busy;
  const deployState = deployInfo.deployStatus?.status;
  const deployFailed = deployState === "ERROR" || deployState === "CANCELED" || deployState === "UNKNOWN";

  return (
    <div
      className="flex flex-col h-full bg-container"
    >
      <div className="h-11 border-b border-stroke-muted flex items-center px-4 gap-3 flex-shrink-0">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
          App Studio
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <span className="truncate max-w-[320px] text-xs text-ink-tertiary" title={idea}>{idea}</span>

          {inProgress && statusMessage && (
            <span className="hidden max-w-[260px] truncate text-xs text-ink-secondary md:inline" title={statusMessage}>
              {statusMessage}
            </span>
          )}
          {badge && <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => void download()}
            disabled={!workspaceId || downloading || inProgress}
            title={inProgress ? "Available once generation has finished" : "Download the project as a .zip"}
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download
          </Button>
        </div>
      </div>

      {status === "error" && (
        <div role="alert" className="flex-shrink-0 border-b border-stroke-muted bg-raised px-4 py-2.5">
          <p className="text-sm text-destructive">
            {partialFailure ? "Generation finished with errors: " : "Generation failed: "}
            {statusMessage || "no reason was reported."}
          </p>
          {failedFiles.length > 0 && (
            <>
              <p className="mt-1.5 text-xs text-ink-secondary">
                {failedFiles.length === 1 ? "This file was not generated" : "These files were not generated"} and
                {failedFiles.length === 1 ? " is" : " are"} missing from the workspace:
              </p>
              <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
                {failedFiles.map((f) => (
                  <li key={f.path} className="flex flex-wrap gap-x-2 text-xs">
                    <code className="font-mono text-ink">{f.path}</code>
                    {f.message && <span className="break-words text-ink-tertiary">{f.message}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction={isMobile ? "vertical" : "horizontal"} className="h-full">
          {/* Left: file tree container */}
          <ResizablePanel defaultSize={isMobile ? 28 : 18} minSize={12} maxSize={isMobile ? 44 : 28}>
            <div className="h-full border-r border-stroke-muted flex">
              <ActivityRail
                onSearchClick={() => window.dispatchEvent(new CustomEvent("ai-ide-focus-search"))}
                activePane={leftPane}
                onSelectPane={setLeftPane}
              />
              <div className="flex-1 min-w-0">
                {leftPane === "explorer" ? <AiFileTree /> : <GitChangesPane />}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Center: Monaco editor */}
          <ResizablePanel defaultSize={isMobile ? 42 : 56} minSize={22}>
            <div className="h-full">
              <div className="h-full flex flex-col">
                <div className="h-9 border-b border-stroke-muted bg-raised flex items-center px-2 gap-2 flex-shrink-0">
                  <div className="rounded-md border border-stroke-muted bg-container p-0.5 flex" role="tablist" aria-label="Center view">
                    {(
                      [
                        ["editor", Code2, "Code"],
                        ["split", Columns2, "Split"],
                        ["preview", Eye, "Preview"],
                      ] as Array<[CenterView, typeof Code2, string]>
                    )
                      .filter(([key]) => !(isMobile && key === "split"))
                      .map(([key, Icon, label]) => (
                        <button
                          key={key}
                          role="tab"
                          aria-selected={centerView === key}
                          className={cn(
                            "h-7 px-2.5 text-xs rounded transition-colors inline-flex items-center gap-1.5",
                            centerView === key ? "bg-raised text-ink" : "text-muted-foreground hover:text-ink"
                          )}
                          onClick={() => setCenterView(key)}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {label}
                        </button>
                      ))}
                  </div>
                  {centerView !== "editor" && (
                    <div className="rounded-md border border-stroke-muted bg-container p-0.5">
                      <button
                        className={cn(
                          "h-7 px-3 text-xs rounded transition-colors",
                          previewMode === "local" ? "bg-raised text-ink" : "text-muted-foreground hover:text-ink"
                        )}
                        onClick={() => setPreviewMode("local")}
                        title="Runs the workspace in the browser and updates as the code changes"
                      >
                        Live
                      </button>
                      <button
                        className={cn(
                          "h-7 px-3 text-xs rounded transition-colors",
                          previewMode === "vercel" ? "bg-raised text-ink" : "text-muted-foreground hover:text-ink"
                        )}
                        onClick={() => setPreviewMode("vercel")}
                        title="The app as deployed to Vercel from its GitHub repository"
                      >
                        Deployed
                      </button>
                    </div>
                  )}

                  {centerView !== "editor" && previewMode === "vercel" && (
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        variant="outline"
                        onClick={() => setRedeployNonce((n) => n + 1)}
                        disabled={!canRedeploy}
                        title={
                          deployInfo.busy
                            ? "A push or deployment is already running"
                            : !canRedeploy
                              ? "Available once generation has finished"
                              : deployInfo.repoUrl
                                ? "Commit the latest changes to the GitHub repository and deploy them"
                                : "Create a GitHub repository for this app, push it and deploy it to Vercel"
                        }
                      >
                        {deployInfo.busy ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Rocket className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        {deployInfo.busy ? "Working…" : deployInfo.repoUrl ? "Push & Redeploy" : "Push & Deploy"}
                      </Button>
                      {(deployInfo.stableDomain ?? normalizeDeploymentUrl(deployInfo.deployedUrl)) && (
                        <a
                          href={(deployInfo.stableDomain ?? normalizeDeploymentUrl(deployInfo.deployedUrl)) as string}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-medium max-w-[260px] truncate"
                        >
                          <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{deployInfo.stableDomain ?? normalizeDeploymentUrl(deployInfo.deployedUrl)}</span>
                          <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                        </a>
                      )}
                      {workspaceId && "app.spec.json" in files && (deployInfo.stableDomain ?? normalizeDeploymentUrl(deployInfo.deployedUrl)) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={creatingTests}
                          title="Derive acceptance cases from the app's spec and run them against the deployment"
                          onClick={async () => {
                            const target = (deployInfo.stableDomain ?? normalizeDeploymentUrl(deployInfo.deployedUrl)) as string;
                            setCreatingTests(true);
                            try {
                              const res = await apiClient.post<{ requirement_id: string; test_cases: number }>(
                                `/ai-ide/workspace/${workspaceId}/test-cases`,
                              );
                              toast.success(`${res.data.test_cases} test cases ready`);
                              navigate(`/test-execution?requirement=${encodeURIComponent(res.data.requirement_id)}&url=${encodeURIComponent(target)}`);
                            } catch (error) {
                              toast.error(errorDetail(error));
                            } finally {
                              setCreatingTests(false);
                            }
                          }}
                        >
                          {creatingTests ? "Preparing tests…" : "Test this app"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {centerView === "editor" ? (
                  <div className="flex-1 min-h-0">
                    <AiCodeEditor />
                  </div>
                ) : centerView === "split" && previewMode === "local" ? (
                  <div className="flex-1 min-h-0">
                    <ResizablePanelGroup direction="horizontal" className="h-full">
                      <ResizablePanel defaultSize={50} minSize={25}>
                        <div className="h-full min-h-0">
                          <AiCodeEditor />
                        </div>
                      </ResizablePanel>
                      <ResizableHandle />
                      <ResizablePanel defaultSize={50} minSize={25}>
                        <div className="h-full min-h-0 flex flex-col border-l border-stroke-muted">{previewPane}</div>
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  </div>
                ) : previewMode === "local" ? (
                  <div className="flex-1 min-h-0 flex flex-col">{previewPane}</div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col">
                    {/* Use stableDomain (domains[0] stable production alias) for iframe.
                        The deployment-specific URL (url field) blocks iframes; the alias allows it. */}
                    <div className="flex-1 relative min-h-0">
                      {deployInfo.deployStatus?.status === "READY" && deployInfo.stableDomain ? (
                        <iframe
                          key={deployInfo.stableDomain}
                          title="Live Preview"
                          src={deployInfo.stableDomain}
                          className="absolute inset-0 w-full h-full border-0 bg-container"
                          loading="lazy"
                          referrerPolicy="strict-origin-when-cross-origin"
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-6 bg-raised">
                          {deployFailed ? (
                            <ServerCrash className="h-5 w-5 text-destructive" />
                          ) : deployState || deployInfo.busy ? (
                            <Loader2 className="h-5 w-5 animate-spin text-ink-tertiary" />
                          ) : null}

                          <div className="text-center space-y-1">
                            <p className="text-sm font-semibold text-ink">
                              {deployState === "UNKNOWN"
                                ? "Deployment status unknown"
                                : deployFailed
                                  ? "Deployment failed"
                                  : deployState === "READY"
                                    ? "Deployed, but no embeddable URL was returned"
                                    : deployState
                                      ? `Deploying (${deployState})`
                                      : deployInfo.busy
                                        ? "Pushing to GitHub…"
                                        : "Not deployed yet"}
                            </p>
                            {!deployState && !deployInfo.busy && (
                              <p className="max-w-xs text-xs text-ink-tertiary">
                                The Live view runs the app right here. Push &amp; Deploy creates a GitHub repository
                                for it (you will be asked for a token once) and deploys it to Vercel.
                              </p>
                            )}
                            {deployFailed && (
                              <p className="max-w-xs text-xs text-ink-tertiary">See the activity and deploy logs for the reason.</p>
                            )}
                            {(deployInfo.stableDomain ?? deployInfo.deployedUrl) && (
                              <p className="text-xs text-muted-foreground font-mono break-all max-w-xs">
                                {deployInfo.stableDomain ?? deployInfo.deployedUrl}
                              </p>
                            )}
                          </div>

                          {(deployInfo.stableDomain ?? deployInfo.deployedUrl) && (
                            <a
                              href={(deployInfo.stableDomain ?? deployInfo.deployedUrl) as string}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-raised border border-stroke-muted text-primary hover:bg-raised transition-all"
                            >
                              <Globe className="h-4 w-4" />
                              {deployState === "READY" ? "Open deployment" : "Open while deploying"}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-stroke-muted bg-raised">
                      <div className="px-3 py-2 flex items-center gap-2 text-xs">
                        <span className="font-medium">Deploy logs</span>
                        {deployInfo.deployStatus && (
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full border",
                            deployInfo.deployStatus.status === "READY"
                              ? "border-stroke-muted bg-raised text-positive"
                              : deployInfo.deployStatus.status === "ERROR"
                                ? "border-stroke-muted bg-raised-2 text-destructive"
                                : "border-stroke-muted bg-raised text-warning"
                          )}>
                            {deployInfo.deployStatus.status}
                          </span>
                        )}
                        {deployInfo.repoUrl && (
                          <a
                            href={deployInfo.repoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
                          >
                            Repo <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      <ScrollArea className="h-40">
                        <div className="p-3 font-mono text-[11px] space-y-1">
                          {deployInfo.deployLogs.length === 0 && (
                            <p className="font-sans text-xs text-ink-tertiary">No deploy logs yet.</p>
                          )}
                          {deployInfo.deployLogs.slice(-120).map((log, idx) => {
                            const msg = String(log.message || "").trim();
                            const ts = log.timestamp
                              ? new Date(log.timestamp > 1000000000000 ? log.timestamp : log.timestamp * 1000).toLocaleTimeString()
                              : "";
                            const level = String(log.level || "info");
                            return (
                              <div key={idx} className="flex gap-2 text-muted-foreground">
                                <span className="w-[70px] flex-shrink-0 opacity-60">{ts || "--:--:--"}</span>
                                <span className={cn(
                                  "w-[52px] flex-shrink-0 uppercase",
                                  level.includes("error") ? "text-destructive" : level.includes("warn") ? "text-warning" : "text-muted-foreground"
                                )}>
                                  {level}
                                </span>
                                <span className="break-words text-ink">{msg || "(empty)"}</span>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Right: telemetry + chat */}
          <ResizablePanel defaultSize={isMobile ? 30 : 26} minSize={20} maxSize={isMobile ? 45 : 40}>
            <div className="flex h-full flex-col border-l border-stroke-muted">
              <div className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-stroke-muted bg-raised px-2" role="tablist" aria-label="Side panel">
                {(
                  [
                    ["chat", MessageSquare, "Chat"],
                    ["design", Palette, "Design"],
                  ] as const
                ).map(([key, Icon, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={rightTab === key}
                    onClick={() => setRightTab(key)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs transition-colors",
                      rightTab === key ? "bg-container text-ink" : "text-muted-foreground hover:text-ink",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
              {/* The chat stays mounted: it owns the push/deploy state and the AI edit queue. */}
              <div className={cn("min-h-0 flex-1", rightTab !== "chat" && "hidden")}>
                <RightRail
                  idea={idea}
                  onDeploymentUpdate={setDeployInfo}
                  onOpenPreview={() => {
                    setPreviewMode("vercel");
                    setCenterView("preview");
                  }}
                  redeployNonce={redeployNonce}
                />
              </div>
              {rightTab === "design" && (
                <div className="min-h-0 flex-1 bg-container">
                  <DesignPanel
                    files={files}
                    selection={selection}
                    styleTarget={styleTarget}
                    inspecting={inspecting}
                    onToggleInspect={() => toggleInspect(!inspecting)}
                    onClearSelection={() => {
                      setSelection(null);
                      window.dispatchEvent(new CustomEvent("ai-ide-preview-command", { detail: { type: "select-clear" } }));
                    }}
                    onSelectParent={() =>
                      window.dispatchEvent(new CustomEvent("ai-ide-preview-command", { detail: { type: "select-parent" } }))
                    }
                    onApplyFiles={(changes) => void applyFiles(changes)}
                    onEditText={(sel, newText) => editText(sel, sel.text ?? "", newText)}
                    onEditClass={editClass}
                    onSwapMark={swapMark}
                    onAskAi={askAiAboutElement}
                    canUndo={history.past.length > 0}
                    canRedo={history.future.length > 0}
                    onUndo={undo}
                    onRedo={redo}
                  />
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div className="h-7 border-t border-stroke-muted bg-raised px-3 text-[10px] flex items-center gap-4 text-muted-foreground">
        {deployInfo.repoUrl && (
          <div className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            <span>main</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <FolderTree className="h-3.5 w-3.5" />
          <span className="tabular-nums">{state.filePaths.length} files</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Terminal className="h-3.5 w-3.5" />
          <span>{partialFailure ? "Generation incomplete" : badge?.label ?? "Idle"}</span>
        </div>
      </div>
    </div>
  );
}

// ── Root orchestrator ─────────────────────────────────────────────────────────

function AiIdeInner() {
  const { state, dispatch } = useAiIde();
  const [currentIdea, setCurrentIdea] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(AI_IDE_SESSION_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { workspaceId?: string; idea?: string };
        if (!parsed.workspaceId) return;
        const filesRes = await apiClient.get<Record<string, string>>(
          `/ai-ide/workspace/${parsed.workspaceId}/files`,
        );
        if (cancelled) return;
        dispatch({ type: "SET_WORKSPACE", workspaceId: parsed.workspaceId, initialFiles: filesRes.data });
        dispatch({ type: "SET_STATUS", status: "done", message: "Restored previous workspace" });
        setCurrentIdea(parsed.idea || "Restored workspace");
        setRestored(true);
      } catch (err) {
        if (!cancelled) {
          setRestoreNotice(`The previous workspace could not be restored (${errorDetail(err)}). Start a new build below.`);
        }
        try {
          localStorage.removeItem(AI_IDE_SESSION_KEY);
        } catch {
          /* ignore */
        }
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const handleBuild = async (idea: string, packId?: string) => {
    dispatch({ type: "SET_STATUS", status: "creating", message: "Creating workspace…" });
    setRestoreNotice(null);
    setRestored(false);
    setCurrentIdea(idea);
    try {
      // Without a pack the server installs the organization's default design pack.
      const res = await apiClient.post<{ workspace_id: string; file_paths: string[]; pack_id?: string }>(
        "/ai-ide/workspace/create",
        packId ? { pack_id: packId } : undefined,
      );
      const { workspace_id, file_paths } = res.data;
      const filesRes = await apiClient.get<Record<string, string>>(`/ai-ide/workspace/${workspace_id}/files`);

      const initialFiles: Record<string, string> = { ...filesRes.data };
      file_paths.forEach((path) => {
        if (!(path in initialFiles)) initialFiles[path] = "";
      });

      dispatch({ type: "SET_WORKSPACE", workspaceId: workspace_id, initialFiles });
      dispatch({ type: "SET_STATUS", status: "planning", message: "Planning the app…" });
      persistAiIdeSession(workspace_id, idea);
    } catch (err) {
      dispatch({
        type: "SET_STATUS",
        status: "error",
        message: errorDetail(err),
      });
      setCurrentIdea(null);
    }
  };

  if (restoring) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Restoring workspace…
      </div>
    );
  }

  const openApp = async (app: { workspace_id: string; idea: string | null; name: string | null }) => {
    setRestoreNotice(null);
    try {
      const filesRes = await apiClient.get<Record<string, string>>(`/ai-ide/workspace/${app.workspace_id}/files`);
      const idea = app.idea || app.name || "Saved app";
      dispatch({ type: "RESET" });
      dispatch({ type: "SET_WORKSPACE", workspaceId: app.workspace_id, initialFiles: filesRes.data });
      dispatch({ type: "SET_STATUS", status: "done", message: "Opened saved app" });
      persistAiIdeSession(app.workspace_id, idea);
      setCurrentIdea(idea);
      // A build that is still running reconnects (IdeLayout attaches when restored is set).
      setRestored(true);
    } catch (err) {
      setRestoreNotice(`That app could not be opened (${errorDetail(err)}).`);
    }
  };

  if (!currentIdea || state.status === "idle" || state.status === "creating") {
    return <IdeaScreen onBuild={handleBuild} onOpenApp={(app) => void openApp(app)} notice={restoreNotice} />;
  }

  return <IdeLayout idea={currentIdea} restored={restored} />;
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function AiIde() {
  return (
    <AiIdeProvider>
      <div className="h-full w-full flex flex-col font-sans relative">
        <AiIdeInner />
      </div>
    </AiIdeProvider>
  );
}
