import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.tsx";
import { AuthProvider } from "./context/AuthContext";
import { RepoProvider } from "./context/RepoContext";
import { ThemeProvider } from "./components/ThemeProvider";
import { OrgDesignPack } from "./components/OrgDesignPack";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx will not change on a second try (and a retry against a GitHub-backed
      // endpoint spends rate limit); only retry once for network and 5xx failures.
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,
      // Switching back to the tab used to refetch every mounted query at once.
      // Pages that need fresh data poll or expose a Refresh action.
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <OrgDesignPack />
        <RepoProvider>
          <App />
        </RepoProvider>
        <Toaster />
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>,
);
