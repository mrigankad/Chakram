import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Mark } from "@/components/Mark";
import { SECTION_MARKS, type NavSectionId } from "@/lib/marks";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { ChevronRight, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Settings, SunMedium, User } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { useOrgConnectors } from "@/hooks/use-org-connectors";
import { BRAND_NAME, LOGO_ICON_SRC } from "@/lib/brand";
import {
  configuredConnectors,
  costTrackerItem,
  dashboardItem,
  findNavItemForPath,
  findSectionForPath,
  pipelineItem,
  platformSections,
  visibleSections,
  type NavIcon,
  type NavItem,
  type NavSection,
} from "@/lib/nav-config";
import { cn } from "@/lib/utils";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-stroke-active";
const caption = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";

/** Circular icon holder shared by every rail control; the active one is filled. */
function Puck({ icon, active = false }: { icon: NavIcon; active?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-action text-ink-tertiary group-hover/item:bg-raised-2 group-hover/item:text-ink-secondary",
      )}
    >
      <AppIcon icon={icon} size={17} strokeWidth={1.75} />
    </span>
  );
}

function itemLabelClass(active: boolean) {
  return cn(
    "min-w-0 flex-1 truncate text-left text-[13px] font-medium transition-colors duration-200",
    active ? "text-ink" : "text-ink-tertiary group-hover/item:text-ink-secondary",
  );
}

function RailItem({
  icon,
  label,
  expanded,
  active = false,
  to,
  onClick,
  trailing,
  ...aria
}: {
  icon: NavIcon;
  label: string;
  expanded: boolean;
  active?: boolean;
  to?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  "aria-expanded"?: boolean;
}) {
  const className = cn(
    "group/item flex items-center rounded-full",
    focusRing,
    expanded ? "w-full gap-3 pr-2" : "justify-center",
  );
  const content = (
    <>
      <Puck icon={icon} active={active} />
      {expanded && <span className={itemLabelClass(active)}>{label}</span>}
      {expanded && trailing}
    </>
  );
  const shared = { title: expanded ? undefined : label, "aria-label": label, className };

  return to ? (
    <Link to={to} onClick={onClick} aria-current={active ? "page" : undefined} {...shared}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} {...aria} {...shared}>
      {content}
    </button>
  );
}

/** Leaves hang off one vertical spine; the last leaf closes it with a corner. */
function TreeLeaves({ items, activeUrl, onNavigate }: { items: NavItem[]; activeUrl?: string; onNavigate?: () => void }) {
  return (
    <div className="relative ml-[18px] mt-0.5 overflow-hidden">
      <span aria-hidden className="pointer-events-none absolute bottom-4 left-0 top-0 w-px bg-stroke-muted" />
      <ul className="flex flex-col">
        {items.map((item, index) => {
          const active = item.url === activeUrl;
          const last = index === items.length - 1;
          return (
            <li key={item.url}>
              <Link
                to={item.url}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group/leaf relative flex items-center gap-2 rounded-lg py-1.5 pl-3 pr-2 transition-colors duration-200",
                  focusRing,
                  active ? "bg-action text-ink" : "text-ink-tertiary hover:bg-action hover:text-ink-secondary",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute -left-px",
                    last
                      ? "top-0 h-1/2 w-2.5 rounded-bl-[3px] border-b border-l border-stroke-muted"
                      : "top-1/2 h-px w-2.5 bg-stroke-muted",
                  )}
                />
                <AppIcon
                  icon={item.icon}
                  size={14}
                  strokeWidth={1.75}
                  className={active ? "text-ink-secondary" : "text-ink-quaternary group-hover/leaf:text-ink-tertiary"}
                />
                <span className="truncate text-[13px] font-medium">{item.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SectionGroup({
  section,
  expanded,
  open,
  activeUrl,
  onToggle,
  onNavigate,
}: {
  section: NavSection;
  expanded: boolean;
  open: boolean;
  activeUrl?: string;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const childActive = section.items.some((item) => item.url === activeUrl);

  return (
    <li className={expanded ? "relative" : "group/flyout relative"}>
      <RailItem
        icon={section.icon}
        label={section.label}
        expanded={expanded}
        active={childActive}
        onClick={onToggle}
        aria-expanded={expanded && open}
        trailing={
          <AppIcon
            icon={ChevronRight}
            size={14}
            strokeWidth={1.75}
            className={cn("text-ink-quaternary transition-transform duration-200", open && "rotate-90")}
          />
        }
      />
      {expanded && open && <TreeLeaves items={section.items} activeUrl={activeUrl} onNavigate={onNavigate} />}
      {!expanded && (
        // Collapsed rail: the section's pages stay one hover away.
        <div className="pointer-events-none invisible absolute left-full top-0 z-50 pl-2 opacity-0 transition-[opacity,visibility] duration-200 group-focus-within/flyout:pointer-events-auto group-focus-within/flyout:visible group-focus-within/flyout:opacity-100 group-hover/flyout:pointer-events-auto group-hover/flyout:visible group-hover/flyout:opacity-100">
          <div className="max-h-[min(80vh,560px)] w-[228px] overflow-y-auto rounded-xl border border-stroke-muted bg-container py-2 pr-2 shadow-lg">
            <p className={cn(caption, "flex items-center gap-2 px-3 pb-1")}>
              {SECTION_MARKS[section.id as NavSectionId] && (
                <Mark id={SECTION_MARKS[section.id as NavSectionId]!} size={24} />
              )}
              {section.label}
            </p>
            <TreeLeaves items={section.items} activeUrl={activeUrl} onNavigate={onNavigate} />
          </div>
        </div>
      )}
    </li>
  );
}

const signOutButton =
  "flex size-8 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-raised-2 hover:text-ink";

/**
 * The signed-in user and the sign-out control, kept together: the name opens the
 * profile, the icon beside it signs out. On the collapsed rail the same pair
 * appears in a flyout from the account puck.
 */
function AccountRow({
  name,
  detail,
  expanded,
  active,
  onNavigate,
  onSignOut,
}: {
  name: string;
  detail?: string;
  expanded: boolean;
  active: boolean;
  onNavigate?: () => void;
  onSignOut: () => void;
}) {
  const identity = (
    <span className="min-w-0 flex-1 text-left">
      <span className={cn("block truncate text-[13px] font-medium", active ? "text-ink" : "text-ink-secondary")}>{name}</span>
      {detail && <span className="block truncate text-[11px] text-ink-quaternary">{detail}</span>}
    </span>
  );
  const signOut = (
    <button type="button" onClick={onSignOut} title="Sign out" aria-label="Sign out" className={cn(signOutButton, focusRing)}>
      <LogOut size={16} aria-hidden />
    </button>
  );

  if (expanded) {
    return (
      <div className="flex items-center gap-1">
        <Link
          to="/profile"
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          aria-label={`${name}, open profile`}
          className={cn("group/item flex min-w-0 flex-1 items-center gap-3 rounded-full pr-2", focusRing)}
        >
          <Puck icon={User} active={active} />
          {identity}
        </Link>
        {signOut}
      </div>
    );
  }

  return (
    <div className="group/flyout relative">
      <Link
        to="/profile"
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={`${name}, open profile`}
        className={cn("group/item flex items-center justify-center rounded-full", focusRing)}
      >
        <Puck icon={User} active={active} />
      </Link>
      <div className="pointer-events-none invisible absolute bottom-0 left-full z-50 pl-2 opacity-0 transition-[opacity,visibility] duration-200 group-focus-within/flyout:pointer-events-auto group-focus-within/flyout:visible group-focus-within/flyout:opacity-100 group-hover/flyout:pointer-events-auto group-hover/flyout:visible group-hover/flyout:opacity-100">
        <div className="flex w-[228px] items-center gap-2 rounded-xl border border-stroke-muted bg-container py-2 pl-3 pr-2 shadow-lg">
          {identity}
          {signOut}
        </div>
      </div>
    </div>
  );
}

/**
 * Primary navigation in the Chronos rail language: a 68px column of pucks that
 * expands into an accordion tree. `mobileOpen` shows it as a drawer below lg.
 */
export function AppSidebar({
  expanded: railExpanded,
  onToggleExpanded,
  mobileOpen,
  onCloseMobile,
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  // undefined = follow the current page; null = the user closed everything.
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);

  const expanded = railExpanded || mobileOpen;
  const activeUrl = findNavItemForPath(location.pathname)?.url;
  const activeSectionId = findSectionForPath(location.pathname);
  const isDark = resolvedTheme === "dark";

  // Parked pages (CI Health, Sprint Health, Release Gate, Incidents) are listed
  // only when the connector that feeds them is configured; if the lookup fails,
  // none of them show.
  const { data: connectors } = useOrgConnectors();
  const sections = useMemo(
    () => visibleSections(platformSections, configuredConnectors(connectors)),
    [connectors],
  );

  // Accordion: only one section is open. Until the user picks one, it is the
  // section holding the current page; navigating to another section opens that one.
  const isOpen = (id: string) => (openId === undefined ? id === activeSectionId : id === openId);

  useEffect(() => {
    setOpenId(undefined);
  }, [activeSectionId]);

  const toggleSection = (id: string) => {
    if (!expanded) {
      onToggleExpanded();
      setOpenId(id);
      return;
    }
    setOpenId(isOpen(id) ? null : id);
  };

  const pad = expanded ? "px-3" : "px-[14px]";

  return (
    <aside
      aria-label="Primary"
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex h-svh shrink-0 flex-col border-r border-stroke-muted bg-container",
        "transition-[width,transform] duration-200 ease-out lg:sticky lg:top-0 lg:z-30 lg:translate-x-0",
        expanded ? "w-[252px]" : "w-[68px]",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center border-b border-stroke-muted", expanded ? "px-4" : "justify-center")}>
        <Link to="/dashboard" onClick={onCloseMobile} aria-label={`${BRAND_NAME} home`} className={cn("rounded-md", focusRing)}>
          {expanded ? (
            <BrandLogo className="h-7 w-auto" />
          ) : (
            <img src={LOGO_ICON_SRC} alt="" className="size-8 object-contain" />
          )}
        </Link>
      </div>

      <nav
        aria-label="Main navigation"
        className={cn("min-h-0 flex-1 py-3", pad, expanded ? "overflow-y-auto overflow-x-hidden" : "overflow-visible")}
      >
        <ul className="flex flex-col gap-1.5">
          {[dashboardItem, pipelineItem].map((item) => (
            <li key={item.url}>
              <RailItem
                icon={item.icon}
                label={item.title}
                to={item.url}
                expanded={expanded}
                active={item.url === activeUrl}
                onClick={onCloseMobile}
              />
            </li>
          ))}
          {sections.map((section) => (
            <SectionGroup
              key={section.id}
              section={section}
              expanded={expanded}
              open={isOpen(section.id)}
              activeUrl={activeUrl}
              onToggle={() => toggleSection(section.id)}
              onNavigate={onCloseMobile}
            />
          ))}
        </ul>
      </nav>

      <div className={cn("flex shrink-0 flex-col gap-1.5 border-t border-stroke-muted py-3", pad)}>
        <div className="hidden lg:contents">
          <RailItem
            icon={expanded ? PanelLeftClose : PanelLeftOpen}
            label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            expanded={expanded}
            onClick={onToggleExpanded}
          />
        </div>
        <RailItem
          icon={isDark ? SunMedium : Moon}
          label={isDark ? "Switch to light" : "Switch to dark"}
          expanded={expanded}
          onClick={() => setTheme(isDark ? "light" : "dark")}
        />
        <RailItem
          icon={Settings}
          label="Connectors"
          to="/settings/connectors"
          expanded={expanded}
          active={location.pathname === "/settings/connectors"}
          onClick={onCloseMobile}
        />
        <RailItem
          icon={costTrackerItem.icon}
          label={costTrackerItem.title}
          to={costTrackerItem.url}
          expanded={expanded}
          active={location.pathname === costTrackerItem.url}
          onClick={onCloseMobile}
        />
        <AccountRow
          name={user?.name || user?.email || "Account"}
          detail={user?.org_name || (user?.name ? user?.email : undefined)}
          expanded={expanded}
          active={location.pathname === "/profile"}
          onNavigate={onCloseMobile}
          onSignOut={() => void logout().then(() => navigate("/login"))}
        />
      </div>
    </aside>
  );
}
