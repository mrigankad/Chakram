import { Plug, Slack } from "lucide-react";
import PATHS from "@/components/connector-paths";
import { cn } from "@/lib/utils";

export type ConnectorId = "github" | "jira" | "vercel" | "ollama" | "slack";

/**
 * Logo glyph for an integration, drawn in the current text colour so it works
 * in both themes. The marks belong to their owners and are used only to
 * identify the service being connected.
 */
export function ConnectorIcon({ id, size = 16, className }: { id: ConnectorId | string; size?: number; className?: string }) {
  if (id === "slack") return <Slack size={size} aria-hidden className={cn("shrink-0", className)} />;
  const path = PATHS[id as keyof typeof PATHS];
  if (!path) return <Plug size={size} aria-hidden className={cn("shrink-0", className)} />;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <path d={path} />
    </svg>
  );
}
