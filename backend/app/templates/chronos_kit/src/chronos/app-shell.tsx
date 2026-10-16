import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { SectionBoundary } from "./boundary";
import { cx } from "./cx";
import { Mark } from "./mark";
import { asArray, isRecord, toText } from "./safe";

export interface AppNavItem {
  /** Route path, e.g. "/claims". */
  to: string;
  label: string;
  /** Lucide icon name, e.g. "LayoutDashboard". Falls back to Circle. */
  icon?: string;
}

const THEME_KEY = "chronos-theme";

/** Unknown or non-string icon names fall back to Circle. */
function resolveIcon(name?: unknown): LucideIcon {
  if (typeof name !== "string" || !/^[A-Z]\w*$/.test(name)) return Icons.Circle;
  const registry = Icons as unknown as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(registry, name)) return Icons.Circle;
  const candidate = registry[name];
  if (typeof candidate === "object" || typeof candidate === "function") return candidate as LucideIcon;
  return Icons.Circle;
}

/** The user's saved choice, else the app's default mode set on <html> (data-theme="dark"). */
function readStoredDark(): boolean {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_KEY);
  } catch {
    stored = null;
  }
  if (stored === "dark" || stored === "light") return stored === "dark";
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
}

function storeTheme(dark: boolean) {
  try {
    window.localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch {
    /* private mode or blocked storage: the toggle still works for this page */
  }
}

/** Puck behind a nav icon. Active uses the action colour; the icon inherits text colour. */
function puckClass(active: boolean) {
  return [
    "flex size-9 shrink-0 items-center justify-center rounded-full transition-[background-color,color] duration-[180ms] ease-out",
    active
      ? "bg-action-primary text-on-color"
      : "bg-action text-tertiary group-hover:bg-raised-2 group-hover:text-secondary",
  ].join(" ");
}

/**
 * Chronos application frame: a sidebar on the left (expanded, collapsed rail,
 * or a drawer below lg) and a top bar that names the current page. Light is
 * the default theme; the toggle sets data-theme="dark" on <html>.
 *
 * Must render inside a react-router-dom <BrowserRouter>.
 */
export function AppShell({
  appName,
  logoMark,
  logoSrc,
  nav,
  children,
  className,
}: {
  appName: string;
  /** Mark id for the logo tile (served from /marks/<id>.png). */
  logoMark?: string;
  /** Image URL for the logo tile (a design pack's brand/logo.svg); wins over logoMark. */
  logoSrc?: string;
  nav: AppNavItem[];
  children: ReactNode;
  className?: string;
}) {
  const { pathname } = useLocation();
  const label = toText(appName) || "App";
  // Items without a string `to` are skipped; a missing label falls back to the route.
  const navItems = asArray<unknown>(nav)
    .filter(isRecord)
    .filter((item) => typeof item.to === "string" && item.to !== "")
    .map((item) => ({
      to: item.to as string,
      label: toText(item.label) || (item.to as string),
      icon: typeof item.icon === "string" ? item.icon : undefined,
    }));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(true);
  const [dark, setDark] = useState<boolean>(() => readStoredDark());

  // Apply the theme before paint, and on every change.
  useLayoutEffect(() => {
    if (dark) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
  }, [dark]);

  // Close the mobile drawer when the route changes (covers browser back/forward).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const showLabels = railExpanded || drawerOpen;
  const current = navItems
    .filter((item) => pathname === item.to || (item.to !== "/" && pathname.startsWith(`${item.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];

  function toggleTheme() {
    setDark((value) => {
      const next = !value;
      storeTheme(next);
      return next;
    });
  }

  return (
    <div className={cx("chronos-app flex h-screen w-full overflow-hidden bg-page", className)}>
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      ) : null}

      <aside
        aria-label="Primary"
        className={[
          "fixed inset-y-0 left-0 z-50 flex h-full shrink-0 flex-col border-r border-muted bg-container",
          "transition-[width,transform] duration-200 ease-out lg:relative lg:z-30 lg:translate-x-0",
          showLabels ? "w-[var(--shell-sidebar-width,252px)]" : "w-[68px]",
          drawerOpen
            ? "translate-x-0"
            : "-translate-x-full pointer-events-none lg:pointer-events-auto lg:translate-x-0",
        ].join(" ")}
      >
        <div
          className={[
            "flex h-14 shrink-0 items-center border-b border-muted",
            showLabels ? "gap-2.5 px-4" : "justify-center",
          ].join(" ")}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-action-primary font-display text-body-sm text-on-color">
              {logoSrc ? (
                <img src={logoSrc} alt="" className="size-8 rounded-[10px] object-contain" />
              ) : logoMark ? (
                <Mark id={logoMark} size={32} className="size-8 rounded-[10px]" />
              ) : (
                label.charAt(0).toUpperCase()
              )}
            </span>
            {showLabels ? (
              <span className="truncate font-display text-body-md text-primary">{label}</span>
            ) : null}
          </span>
        </div>

        <nav
          aria-label="Main navigation"
          className={[
            "min-h-0 flex-1 py-3",
            showLabels ? "overflow-y-auto overflow-x-hidden px-3" : "overflow-visible px-[14px]",
          ].join(" ")}
        >
          <ul className="flex flex-col gap-1.5">
            {navItems.map((item, index) => {
              const Icon = resolveIcon(item.icon);
              return (
                <li key={`${item.to}:${index}`}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    title={showLabels ? undefined : item.label}
                    aria-label={showLabels ? undefined : item.label}
                    onClick={() => setDrawerOpen(false)}
                    className={[
                      "group relative flex items-center rounded-full outline-none transition-colors duration-[180ms] ease-out focus-visible:ring-2 focus-visible:ring-active",
                      showLabels ? "w-full gap-3 pr-3" : "justify-center",
                    ].join(" ")}
                  >
                    {({ isActive }) => (
                      <>
                        <span className={puckClass(isActive)}>
                          <Icon size={17} strokeWidth={1.75} aria-hidden />
                        </span>
                        {showLabels ? (
                          <span
                            className={[
                              "truncate text-label-sm transition-colors duration-[180ms]",
                              isActive ? "text-primary" : "text-tertiary group-hover:text-secondary",
                            ].join(" ")}
                          >
                            {item.label}
                          </span>
                        ) : null}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div
          className={[
            "flex shrink-0 flex-col gap-1.5 border-t border-muted py-3",
            showLabels ? "px-3" : "px-[14px]",
          ].join(" ")}
        >
          <button
            type="button"
            onClick={() => setRailExpanded((value) => !value)}
            title={showLabels ? undefined : "Expand sidebar"}
            aria-label={railExpanded ? "Collapse sidebar" : "Expand sidebar"}
            className={[
              "group relative hidden items-center rounded-full outline-none transition-colors duration-[180ms] ease-out focus-visible:ring-2 focus-visible:ring-active lg:flex",
              showLabels ? "w-full gap-3 pr-3" : "justify-center",
            ].join(" ")}
          >
            <span className={puckClass(false)}>
              {railExpanded ? (
                <Icons.PanelLeftClose size={17} strokeWidth={1.75} aria-hidden />
              ) : (
                <Icons.PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden />
              )}
            </span>
            {showLabels ? (
              <span className="truncate text-label-sm text-tertiary group-hover:text-secondary">
                Collapse sidebar
              </span>
            ) : null}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-muted bg-page px-4 sm:gap-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="flex size-8 items-center justify-center rounded-full bg-action text-tertiary outline-none transition-colors duration-[180ms] hover:bg-raised-2 hover:text-secondary focus-visible:ring-2 focus-visible:ring-active lg:hidden"
            >
              <Icons.Menu size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <h1 className="truncate font-display text-display-lg text-primary">
              {current?.label ?? label}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
              title={dark ? "Switch to light theme" : "Switch to dark theme"}
              className="flex size-8 items-center justify-center rounded-full border border-muted bg-action text-tertiary outline-none transition-colors duration-[180ms] hover:border-default hover:bg-raised-2 hover:text-secondary focus-visible:ring-2 focus-visible:ring-active"
            >
              {dark ? (
                <Icons.SunMedium size={15} strokeWidth={1.75} aria-hidden />
              ) : (
                <Icons.Moon size={15} strokeWidth={1.75} aria-hidden />
              )}
            </button>
          </div>
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overflow-x-hidden bg-page">
          <SectionBoundary label="Page">{children}</SectionBoundary>
        </main>
      </div>
    </div>
  );
}
