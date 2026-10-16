import {
  Activity,
  AppWindow,
  ArrowUpDown,
  BrainCircuit,
  Bug,
  CalendarCheck,
  ClipboardCheck,
  Coins,
  Database,
  FileSearch,
  FileText,
  Filter,
  FolderCode,
  GitCompare,
  Layers,
  LayoutGrid,
  LineChart,
  Network,
  Rocket,
  ScanSearch,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  TestTube,
  TestTubes,
  TriangleAlert,
  User,
  Workflow,
  Wrench,
  ClipboardList,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";

export type NavIcon = LucideIcon;

/** Connectors a parked page can depend on (keys of GET /orgs/current/connectors). */
export type ConnectorKey = "github" | "jira" | "slack";

export type NavItem = {
  title: string;
  url: string;
  icon: NavIcon;
  hint?: string;
  /**
   * Parked page: listed only when any one of these connectors is configured,
   * whether the organization saved it or the platform environment provides it.
   */
  requires?: ConnectorKey[];
};

export type NavSection = {
  id: string;
  label: string;
  icon: NavIcon;
  items: NavItem[];
};

/** A page with the section label it is filed under, whether or not it is in the sidebar. */
export type PageMeta = NavItem & { section: string; sectionId?: string };

export const dashboardItem: NavItem = {
  title: "Dashboard",
  url: "/dashboard",
  icon: LayoutGrid,
};

export const pipelineItem: NavItem = {
  title: "SDLC Pipeline",
  url: "/pipeline",
  icon: Workflow,
  hint: "End-to-end delivery workflow",
};

/** Sidebar footer entry beside Profile; nothing else links to it. */
export const costTrackerItem: NavItem = {
  title: "Usage & Cost",
  url: "/cost-tracker",
  icon: Coins,
  hint: "AI calls and tokens by feature",
};

export const testSuiteItem: NavItem = {
  title: "Test Suite",
  url: "/generated-tests",
  icon: TestTube,
  hint: "Generated and managed test cases",
};

/**
 * The streamlined sidebar (docs/chakram/IMPLEMENTATION_PLAN.md section 1). Pages
 * that left the sidebar keep their routes and are described in `hiddenPageMeta`.
 */
export const platformSections: NavSection[] = [
  {
    id: "build",
    label: "Build & Code",
    icon: Layers,
    items: [
      { title: "App Studio", url: "/ai-ide", icon: Sparkles, hint: "Build an app from a description" },
      { title: "Code Workspace", url: "/workspace", icon: FolderCode, hint: "Editor, Git and assistant" },
      { title: "Code Review", url: "/code-review", icon: GitCompare, hint: "Inline pull request review" },
      { title: "Product Specs", url: "/prd", icon: FileText, hint: "Write a product requirements document" },
    ],
  },
  {
    id: "requirements",
    label: "Requirements & Planning",
    icon: ClipboardList,
    items: [
      { title: "Requirements", url: "/requirements", icon: ClipboardCheck, hint: "Capture and analyze requirements" },
      { title: "Test Data", url: "/synthetic-data", icon: Database, hint: "Generate test datasets" },
    ],
  },
  {
    id: "testing",
    label: "Testing & Quality",
    icon: FlaskConical,
    items: [
      testSuiteItem,
      { title: "Test Execution", url: "/test-execution", icon: TestTubes, hint: "Run test cases in a real browser" },
      { title: "Live Test Run", url: "/live-testing", icon: AppWindow, hint: "Watch a test run in a real browser" },
      { title: "Risk Ranking", url: "/prioritization", icon: ArrowUpDown, hint: "Ranked by failure history and severity" },
      { title: "Change Hotspots", url: "/defect-prediction", icon: Bug, hint: "Files ranked by churn and bug fixes" },
    ],
  },
  {
    id: "release",
    label: "Release & Ops",
    icon: Rocket,
    items: [
      { title: "Deployments", url: "/deployments", icon: Rocket, hint: "Vercel deploy tracking" },
      { title: "CI Health", url: "/ci-intelligence", icon: Server, hint: "Workflow run health", requires: ["github"] },
      {
        title: "Sprint Health",
        url: "/sprint-intelligence",
        icon: CalendarCheck,
        hint: "Sprint risk and delivery signals",
        requires: ["jira"],
      },
      { title: "Release Gate", url: "/release-gate", icon: ShieldCheck, hint: "Go / no-go decision", requires: ["jira"] },
      {
        title: "Incidents",
        url: "/incidents",
        icon: TriangleAlert,
        hint: "Incident response and postmortems",
        requires: ["slack"],
      },
      { title: "Connectors", url: "/settings/connectors", icon: Settings, hint: "GitHub, Vercel, Ollama, Jira keys" },
    ],
  },
];

/** Tabs rendered under the Test Suite header; each is its own route. */
export const testSuiteTabs: { label: string; url: string }[] = [
  { label: "Cases", url: testSuiteItem.url },
  { label: "Baseline", url: "/repo-baseline" },
  { label: "Selection", url: "/test-selection" },
  { label: "Root Cause", url: "/root-cause" },
  { label: "Repair", url: "/self-healing" },
  { label: "From Docs", url: "/doc-tests" },
];

/**
 * Pages that are routable but not sidebar items. They keep a title, icon and
 * section so breadcrumbs and global search still describe them.
 */
export const hiddenPageMeta: Record<string, PageMeta> = {
  "/code-impact": {
    title: "Code Impact",
    url: "/code-impact",
    icon: Network,
    hint: "Dependency graph and affected tests",
    section: "Build & Code",
    sectionId: "build",
  },
  "/requirements-intelligence": {
    title: "Requirement Insights",
    url: "/requirements-intelligence",
    icon: LineChart,
    hint: "Story quality and coverage insights",
    section: "Requirements & Planning",
    sectionId: "requirements",
  },
  "/repo-baseline": {
    title: "Test Baseline",
    url: "/repo-baseline",
    icon: ScanSearch,
    hint: "Playwright test scan",
    section: "Testing & Quality",
    sectionId: "testing",
  },
  "/test-selection": {
    title: "Test Selection",
    url: "/test-selection",
    icon: Filter,
    hint: "Change-based test selection",
    section: "Testing & Quality",
    sectionId: "testing",
  },
  "/root-cause": {
    title: "Root Cause Analysis",
    url: "/root-cause",
    icon: BrainCircuit,
    hint: "Failure diagnosis",
    section: "Testing & Quality",
    sectionId: "testing",
  },
  "/self-healing": {
    title: "Test Repair",
    url: "/self-healing",
    icon: Wrench,
    hint: "Live selector repair with approval",
    section: "Testing & Quality",
    sectionId: "testing",
  },
  "/doc-tests": {
    title: "Tests from Docs",
    url: "/doc-tests",
    icon: FileSearch,
    hint: "Docs → test scenarios",
    section: "Testing & Quality",
    sectionId: "testing",
  },
  "/monitoring": {
    title: "Metric Anomalies",
    url: "/monitoring",
    icon: Activity,
    hint: "Analyse a demo or pasted series",
    section: "Release & Ops",
    sectionId: "release",
  },
};

/** Pages reached from the sidebar footer or the account menu. */
const extraPageMeta: Record<string, PageMeta> = {
  "/profile": { title: "Profile", url: "/profile", icon: User, section: "Account" },
  "/settings/connectors": {
    title: "Connectors",
    url: "/settings/connectors",
    icon: Settings,
    hint: "GitHub, Vercel, Ollama, Jira keys",
    section: "Settings",
  },
  [costTrackerItem.url]: { ...costTrackerItem, section: "Admin" },
};

/** Every sidebar item, parked ones included. */
export const allNavItems: NavItem[] = [
  dashboardItem,
  pipelineItem,
  ...platformSections.flatMap((s) => s.items),
];

/**
 * Every page with its section label, for global search: the sidebar, the
 * footer, and pages that left the sidebar. One row per URL.
 */
export function allSearchablePages(): PageMeta[] {
  const rows: PageMeta[] = [
    { ...dashboardItem, section: "Overview", hint: "Platform overview" },
    { ...pipelineItem, section: "Pipeline" },
  ];
  for (const section of platformSections) {
    for (const item of section.items) {
      rows.push({ ...item, section: section.label, sectionId: section.id });
    }
  }
  rows.push(...Object.values(hiddenPageMeta));
  rows.push(...Object.values(extraPageMeta));
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

function matchesPath(url: string, pathname: string): boolean {
  return url === pathname || pathname.startsWith(`${url}/`);
}

/** Which connectors the org can use, from the public view of GET /orgs/current/connectors. */
export function configuredConnectors(
  connectors: Partial<Record<ConnectorKey, Record<string, unknown>>> | null | undefined,
): Set<ConnectorKey> {
  const configured = new Set<ConnectorKey>();
  if (!connectors) return configured;
  const isSet = (field: unknown) => !!(field as { configured?: boolean } | undefined)?.configured;
  if (isSet(connectors.github?.token)) configured.add("github");
  if (isSet(connectors.jira?.token)) configured.add("jira");
  if (isSet(connectors.slack?.webhook_url)) configured.add("slack");
  return configured;
}

/** Sections with parked items removed unless one of their connectors is configured. */
export function visibleSections(sections: NavSection[], configured: Set<string>): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.requires || item.requires.some((key) => configured.has(key))),
    }))
    .filter((section) => section.items.length > 0);
}

/** The page a pathname belongs to, sidebar or not, with its section label. */
export function findPageForPath(pathname: string): PageMeta | null {
  const extra = extraPageMeta[pathname];
  if (extra) return extra;
  const hidden = Object.values(hiddenPageMeta).find((page) => matchesPath(page.url, pathname));
  if (hidden) return hidden;
  if (matchesPath(dashboardItem.url, pathname)) return { ...dashboardItem, section: "Overview" };
  if (matchesPath(pipelineItem.url, pathname)) return { ...pipelineItem, section: "Pipeline" };
  for (const section of platformSections) {
    const item = section.items.find((candidate) => matchesPath(candidate.url, pathname));
    if (item) return { ...item, section: section.label, sectionId: section.id };
  }
  return null;
}

/** Sidebar section that should be open for a pathname, hidden pages included. */
export function findSectionForPath(pathname: string): string | null {
  return findPageForPath(pathname)?.sectionId ?? null;
}

/**
 * Sidebar item to highlight for a pathname. Test Suite tab routes highlight
 * Test Suite; other hidden pages highlight nothing.
 */
export function findNavItemForPath(pathname: string): NavItem | null {
  if (testSuiteTabs.some((tab) => matchesPath(tab.url, pathname))) return testSuiteItem;
  return allNavItems.find((item) => matchesPath(item.url, pathname)) ?? null;
}

export function getBreadcrumbForPath(pathname: string): { section: string; page: string } {
  const page = findPageForPath(pathname);
  if (!page) {
    const label = pathname.split("/").filter(Boolean).pop() ?? "Page";
    return {
      section: "Chakram",
      page: label.charAt(0).toUpperCase() + label.slice(1).replace(/-/g, " "),
    };
  }
  return { section: page.section, page: page.title };
}

export type Crumb = { label: string; href?: string };

/** Names for the segment after a page's own URL, e.g. /root-cause/<id>. */
const detailLabels: Record<string, string> = {
  "/root-cause": "Analysis",
};

/**
 * Trail for the top bar: section, page, and a detail level when the URL goes
 * deeper than the page. Only crumbs the user can actually navigate to get an
 * href; the last crumb is the current location.
 */
export function getBreadcrumbs(pathname: string): Crumb[] {
  const { section, page } = getBreadcrumbForPath(pathname);
  const item = findPageForPath(pathname);
  const sectionId = findSectionForPath(pathname);
  const sectionHome = platformSections.find((s) => s.id === sectionId)?.items[0]?.url;

  const crumbs: Crumb[] = [];
  if (pathname !== dashboardItem.url) {
    crumbs.push({ label: section, href: sectionHome && sectionHome !== item?.url ? sectionHome : undefined });
  } else {
    crumbs.push({ label: section });
  }

  const onDetail = !!item && pathname !== item.url && pathname.startsWith(`${item.url}/`);
  if (onDetail) {
    crumbs.push({ label: page, href: item.url });
    crumbs.push({ label: detailLabels[item.url] ?? "Details" });
  } else {
    crumbs.push({ label: page });
  }
  return crumbs;
}
