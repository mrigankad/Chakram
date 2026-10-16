import { describe, expect, it } from "vitest";
import { applyOrgTheme, packStyleSheet, STYLE_ID, type OrgTheme } from "./design-pack";

const acme: OrgTheme = {
  id: "acme",
  name: "Acme Industrial",
  mode: "light",
  fonts: ["https://fonts.googleapis.com/css2?family=Inter&display=swap", "https://evil.example/x.css"],
  light: { "font-sans": "'Inter', system-ui, sans-serif", "action-primary-default": "#c8102e", "radius-lg": "4px" },
  dark: { "surface-page-background": "#121212" },
};

describe("packStyleSheet", () => {
  it("writes the light block on :root and the dark block on .dark", () => {
    const css = packStyleSheet(acme);
    expect(css).toBe(
      ":root {\n  --font-sans: 'Inter', system-ui, sans-serif;\n  --action-primary-default: #c8102e;\n  --radius-lg: 4px;\n}\n\n" +
        ":root.dark,\n.dark {\n  --surface-page-background: #121212;\n}",
    );
  });

  it("is empty for a pack that sets nothing and drops values that could escape the block", () => {
    expect(packStyleSheet({ light: {}, dark: {} })).toBe("");
    expect(packStyleSheet({ light: { "text-primary": "#000; } body { display: none", "bad name": "#fff", ok: "red" }, dark: {} })).toBe(
      ":root {\n  --ok: red;\n}",
    );
  });
});

describe("applyOrgTheme", () => {
  it("adds, replaces and removes the style and only Google Fonts links", () => {
    applyOrgTheme(acme);
    const style = document.getElementById(STYLE_ID)!;
    expect(style.textContent).toContain("--action-primary-default: #c8102e;");
    expect(style.getAttribute("data-pack")).toBe("acme");
    const links = () => Array.from(document.head.querySelectorAll("link[data-org-design-pack-font]")).map((l) => (l as HTMLLinkElement).href);
    expect(links()).toEqual(["https://fonts.googleapis.com/css2?family=Inter&display=swap"]);

    applyOrgTheme({ ...acme, id: "acme2", fonts: [], light: { "radius-lg": "12px" }, dark: {} });
    expect(document.getElementById(STYLE_ID)!.textContent).toBe(":root {\n  --radius-lg: 12px;\n}");
    expect(links()).toEqual([]);

    applyOrgTheme(null);
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });
});
