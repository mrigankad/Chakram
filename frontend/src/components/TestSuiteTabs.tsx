import { Link, useLocation } from "react-router-dom";
import { testSuiteTabs } from "@/lib/nav-config";
import { cn } from "@/lib/utils";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stroke-active";

/**
 * Tab row under the Test Suite page header. Each tab is its own route
 * (Cases, Baseline, Selection, Root Cause, Repair, From Docs); the current
 * one is read from the URL, so the pages stay independent.
 */
export function TestSuiteTabs({ className }: { className?: string }) {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Test Suite sections" className={cn("flex flex-wrap items-center gap-2", className)}>
      {testSuiteTabs.map((tab) => {
        const active = pathname === tab.url || pathname.startsWith(`${tab.url}/`);
        return (
          <Link
            key={tab.url}
            to={tab.url}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              focusRing,
              active
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-stroke-muted bg-container text-ink-secondary hover:bg-raised hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
