import type { StatusTone } from "@/components/imcc/StatusBadge";

/**
 * Badge tone for a project stage status, a deployment state or a gate verdict
 * (GET /projects/{id} `stages.*.status`, `deployments[].state`, GET …/gate `verdict`).
 * Unknown values are neutral so a new backend status never renders as a warning.
 */
export function stageTone(status: string | null | undefined): StatusTone {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "neutral";
  if (["passed", "ready", "done", "go", "ok", "healthy"].includes(s)) return "success";
  if (["running", "queued", "building", "generating", "initializing", "in progress"].includes(s)) return "info";
  if (["failed", "error", "no_go", "no-go", "canceled", "cancelled"].includes(s)) return "critical";
  if (["caution", "conditional", "degraded"].includes(s)) return "warning";
  return "neutral";
}

/** "Not evaluated" / "No go" / "Ready": a status as the badge prints it. */
export function stageLabel(status: string | null | undefined): string {
  const s = (status ?? "").trim();
  if (!s) return "Not evaluated";
  const words = s.replace(/[_-]+/g, " ").toLowerCase();
  if (words === "n/a") return "n/a";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "0%", "87%", or "—" when the run has no checkable cases. */
export function formatPassRate(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  const pct = rate <= 1 ? rate * 100 : rate;
  return `${Math.round(pct)}%`;
}

/** "just now", "5m ago", "3h ago", "2d ago" or the date for older timestamps; "" for an invalid one. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, now.getTime() - t);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The host of a URL for compact display; the raw string when it does not parse. */
export function displayUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.host + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}
