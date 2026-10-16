import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const ORG_CONNECTORS_QUERY_KEY = ["org", "connectors"] as const;

/**
 * Public view of the organization's connectors (GET /orgs/current/connectors),
 * cached for five minutes. Callers treat a failure as "nothing configured".
 */
export function useOrgConnectors() {
  return useQuery({
    queryKey: ORG_CONNECTORS_QUERY_KEY,
    queryFn: api.getConnectors,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
