import { Suspense, useCallback, useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ChevronRight, Menu, Search } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { EmptyState } from "@/components/EmptyState";
import { GlobalSearch, useGlobalSearchHotkey } from "@/components/GlobalSearch";
import { cn } from "@/lib/utils";
import { getBreadcrumbs } from "@/lib/nav-config";
import { BRAND_NAME } from "@/lib/brand";

const RAIL_KEY = "aidlc.sidebar.expanded";

function readRailPreference(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) !== "false";
  } catch {
    return true;
  }
}

const FULL_BLEED_ROUTES = [
  "/workspace",
  "/ai-ide",
  "/prd",
  "/code-impact",
  "/doc-tests",
];

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export default function DashboardLayout() {
  const location = useLocation();
  const isFullBleed = FULL_BLEED_ROUTES.some((route) => location.pathname.startsWith(route));
  const crumbs = getBreadcrumbs(location.pathname);
  const current = crumbs[crumbs.length - 1].label;
  const trail = crumbs.slice(0, -1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(readRailPreference);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useGlobalSearchHotkey(openSearch);

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, String(railExpanded));
    } catch {
      /* the rail still works; it just will not be remembered */
    }
  }, [railExpanded]);

  // The mobile drawer closes with Escape and whenever the route changes.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // The browser tab names the page, so several open tabs can be told apart.
  useEffect(() => {
    document.title = `${current} · ${BRAND_NAME}`;
  }, [current]);

  const shortcutLabel = isMacPlatform() ? "⌘K" : "Ctrl K";

  return (
    <>
      {/* The shell owns the viewport height so each page scrolls inside <main>;
          full-bleed pages (editors, graph canvases) size their own panes within it. */}
      <div className="flex h-svh w-full overflow-hidden bg-page">
        {mobileNavOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          />
        )}
        <AppSidebar
          expanded={railExpanded}
          onToggleExpanded={() => setRailExpanded((v) => !v)}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-stroke-muted bg-container px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-ink-tertiary transition-colors hover:bg-raised-2 hover:text-ink-secondary lg:hidden"
              >
                <Menu size={16} strokeWidth={1.75} aria-hidden />
              </button>
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
                <ol className="hidden shrink-0 items-center gap-1.5 sm:flex">
                  {trail.map((crumb) => (
                    <li key={crumb.label} className="flex items-center gap-1.5">
                      {crumb.href ? (
                        <Link
                          to={crumb.href}
                          className="rounded-sm font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary outline-none transition-colors hover:text-ink-secondary focus-visible:ring-2 focus-visible:ring-stroke-active"
                        >
                          {crumb.label}
                        </Link>
                      ) : (
                        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
                          {crumb.label}
                        </span>
                      )}
                      <ChevronRight size={12} aria-hidden className="shrink-0 text-ink-quaternary" />
                    </li>
                  ))}
                </ol>
                <h1 aria-current="page" className="truncate font-display text-lg font-normal text-ink">
                  {current}
                </h1>
              </nav>
            </div>

            <button
              type="button"
              onClick={openSearch}
              aria-label={`Search ${BRAND_NAME}`}
              className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-stroke-muted bg-action px-3 text-xs font-medium text-ink-tertiary transition-colors hover:border-stroke hover:bg-raised-2 hover:text-ink-secondary"
            >
              <Search size={13} strokeWidth={1.75} aria-hidden />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded border border-stroke-muted px-1 font-sans text-[11px] text-ink-quaternary sm:inline">
                {shortcutLabel}
              </kbd>
            </button>
          </header>

          <main className={cn("min-h-0 min-w-0 flex-1 overflow-auto bg-page", !isFullBleed && "p-4 sm:p-5")}>
            <Suspense fallback={<EmptyState kind="loading">Loading…</EmptyState>}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
