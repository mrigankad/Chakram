import type { ConnectorStatus } from "@/lib/api";

/**
 * The caption under a connector's title on Settings → Connectors:
 * "Enables: CI Health · Code Review". Empty when nothing reads the connector.
 */
export function enablesLine(status: Pick<ConnectorStatus, "feeds">): string {
  const labels = status.feeds.map((feed) => feed.label.trim()).filter(Boolean);
  return labels.length ? `Enables: ${labels.join(" · ")}` : "";
}
