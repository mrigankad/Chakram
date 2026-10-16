import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { applyOrgTheme, ORG_THEME_QUERY_KEY } from "@/lib/design-pack";

/**
 * Applies the signed-in organization's default design pack to Chakram itself
 * (`lib/design-pack.ts`). Renders nothing. Removed again on sign-out so the login
 * page is always Chronos.
 */
export function OrgDesignPack() {
  const { isAuthenticated } = useAuth();
  const theme = useQuery({
    queryKey: ORG_THEME_QUERY_KEY,
    queryFn: api.getOrgDesignPack,
    enabled: isAuthenticated,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  useEffect(() => {
    applyOrgTheme(isAuthenticated && theme.data ? theme.data : null);
  }, [isAuthenticated, theme.data]);
  return null;
}
