import { describe, expect, it } from "vitest";
import {
  allNavItems,
  allSearchablePages,
  configuredConnectors,
  findNavItemForPath,
  findPageForPath,
  findSectionForPath,
  getBreadcrumbForPath,
  getBreadcrumbs,
  hiddenPageMeta,
  platformSections,
  testSuiteItem,
  testSuiteTabs,
  visibleSections,
} from "./nav-config";

const PARKED = ["/ci-intelligence", "/sprint-intelligence", "/release-gate", "/incidents"];

function urls(sections: ReturnType<typeof visibleSections>): string[] {
  return sections.flatMap((s) => s.items.map((i) => i.url));
}

describe("visibleSections", () => {
  it("hides every parked page when nothing is configured", () => {
    const shown = urls(visibleSections(platformSections, new Set()));
    for (const url of PARKED) expect(shown).not.toContain(url);
    expect(shown).toContain("/deployments");
    expect(shown).toContain("/settings/connectors");
  });

  it("shows CI Health with a GitHub token only", () => {
    const shown = urls(visibleSections(platformSections, new Set(["github"])));
    expect(shown).toContain("/ci-intelligence");
    expect(shown).not.toContain("/sprint-intelligence");
    expect(shown).not.toContain("/release-gate");
    expect(shown).not.toContain("/incidents");
  });

  it("shows Sprint Health and Release Gate with Jira", () => {
    const shown = urls(visibleSections(platformSections, new Set(["jira"])));
    expect(shown).toContain("/sprint-intelligence");
    expect(shown).toContain("/release-gate");
    expect(shown).not.toContain("/ci-intelligence");
  });

  it("shows Incidents with Slack only", () => {
    expect(urls(visibleSections(platformSections, new Set(["slack"])))).toContain("/incidents");
    expect(urls(visibleSections(platformSections, new Set(["github", "jira"])))).not.toContain("/incidents");
  });

  it("keeps section order and unparked items, and does not mutate the input", () => {
    const before = platformSections.map((s) => s.items.length);
    const shown = visibleSections(platformSections, new Set());
    expect(shown.map((s) => s.id)).toEqual(platformSections.map((s) => s.id));
    expect(platformSections.map((s) => s.items.length)).toEqual(before);
    const release = shown.find((s) => s.id === "release")!;
    expect(release.items.map((i) => i.url)).toEqual(["/deployments", "/settings/connectors"]);
  });

  it("drops a section whose items are all parked", () => {
    const only = visibleSections(
      [{ ...platformSections[3], items: platformSections[3].items.filter((i) => i.requires) }],
      new Set(),
    );
    expect(only).toEqual([]);
  });
});

describe("configuredConnectors", () => {
  it("reads the configured flag of each connector's secret, whatever its source", () => {
    const set = configuredConnectors({
      github: { token: { configured: true, masked: "••••abcd", source: "env" } },
      jira: { token: { configured: false, masked: null, source: "none" }, domain: "" },
      slack: { webhook_url: { configured: true, masked: "••••wxyz", source: "org" } },
    });
    expect([...set].sort()).toEqual(["github", "slack"]);
  });

  it("treats a missing response as nothing configured", () => {
    expect(configuredConnectors(undefined).size).toBe(0);
    expect(configuredConnectors(null).size).toBe(0);
    expect(configuredConnectors({}).size).toBe(0);
  });
});

describe("breadcrumbs for hidden pages", () => {
  it("labels pages that left the sidebar with their section", () => {
    expect(getBreadcrumbForPath("/repo-baseline")).toEqual({ section: "Testing & Quality", page: "Test Baseline" });
    expect(getBreadcrumbForPath("/doc-tests")).toEqual({ section: "Testing & Quality", page: "Tests from Docs" });
    expect(getBreadcrumbForPath("/code-impact")).toEqual({ section: "Build & Code", page: "Code Impact" });
    expect(getBreadcrumbForPath("/requirements-intelligence")).toEqual({
      section: "Requirements & Planning",
      page: "Requirement Insights",
    });
    expect(getBreadcrumbForPath("/monitoring")).toEqual({ section: "Release & Ops", page: "Metric Anomalies" });
  });

  it("keeps the parked pages' labels whether or not they are shown", () => {
    expect(getBreadcrumbForPath("/release-gate")).toEqual({ section: "Release & Ops", page: "Release Gate" });
    expect(getBreadcrumbForPath("/sprint-intelligence")).toEqual({ section: "Release & Ops", page: "Sprint Health" });
  });

  it("builds the detail trail for a root cause analysis", () => {
    expect(getBreadcrumbs("/root-cause/abc123")).toEqual([
      { label: "Testing & Quality", href: "/generated-tests" },
      { label: "Root Cause Analysis", href: "/root-cause" },
      { label: "Analysis" },
    ]);
  });

  it("describes footer pages and falls back for unknown paths", () => {
    expect(getBreadcrumbForPath("/cost-tracker")).toEqual({ section: "Admin", page: "Usage & Cost" });
    expect(getBreadcrumbForPath("/profile")).toEqual({ section: "Account", page: "Profile" });
    expect(getBreadcrumbForPath("/no-such-page")).toEqual({ section: "Chakram", page: "No such page" });
    expect(getBreadcrumbs("/dashboard")).toEqual([{ label: "Overview" }, { label: "Dashboard" }]);
  });
});

describe("Test Suite tabs", () => {
  it("highlight the Test Suite sidebar item and open Testing & Quality", () => {
    for (const tab of testSuiteTabs) {
      expect(findNavItemForPath(tab.url)).toBe(testSuiteItem);
      expect(findSectionForPath(tab.url)).toBe("testing");
    }
    expect(findNavItemForPath("/root-cause/abc123")).toBe(testSuiteItem);
    expect(findSectionForPath("/self-healing/")).toBe("testing");
  });

  it("are not sidebar items themselves", () => {
    const sidebar = allNavItems.map((i) => i.url);
    for (const tab of testSuiteTabs.slice(1)) {
      expect(sidebar).not.toContain(tab.url);
      expect(hiddenPageMeta[tab.url]).toBeDefined();
    }
  });

  it("other hidden pages open their section without highlighting an item", () => {
    expect(findNavItemForPath("/code-impact")).toBeNull();
    expect(findSectionForPath("/code-impact")).toBe("build");
    expect(findPageForPath("/monitoring")?.title).toBe("Metric Anomalies");
  });
});

describe("allSearchablePages", () => {
  it("lists sidebar, footer and hidden pages once each", () => {
    const pages = allSearchablePages();
    const seen = pages.map((p) => p.url);
    expect(new Set(seen).size).toBe(seen.length);
    for (const url of Object.keys(hiddenPageMeta)) expect(seen).toContain(url);
    for (const url of PARKED) expect(seen).toContain(url);
    for (const url of ["/dashboard", "/pipeline", "/cost-tracker", "/profile", "/settings/connectors"]) {
      expect(seen).toContain(url);
    }
    expect(pages.find((p) => p.url === "/repo-baseline")?.section).toBe("Testing & Quality");
  });
});
