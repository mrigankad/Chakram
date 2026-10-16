/**
 * Chakram wears the organization's design pack.
 *
 * `GET /orgs/current/design-pack` returns the pack's custom properties by mode. They use
 * the same names as Chakram's own tokens (styles/imcc-tokens.css) and the Chronos kit in
 * generated apps, so applying them on `:root` and `.dark` restyles Chakram the way the
 * pack restyles the apps it builds. Nothing is applied for the built-in Chronos pack
 * beyond its fonts and radius, which are Chakram's defaults anyway.
 */

export interface OrgTheme {
  id: string;
  name: string;
  mode: "light" | "dark";
  /** Google Fonts stylesheets the pack's fonts need. */
  fonts: string[];
  /** Custom property name (without `--`) → value, for the light document. */
  light: Record<string, string>;
  /** Overrides for `.dark`. */
  dark: Record<string, string>;
}

export const ORG_THEME_QUERY_KEY = ["org", "design-pack"] as const;
export const STYLE_ID = "org-design-pack";
const FONT_ATTR = "data-org-design-pack-font";

const NAME = /^[a-zA-Z0-9-]+$/;
/** A value may not close the declaration or the block it sits in. */
const VALUE = /^[^;{}<>]*$/;

function declarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .filter(([name, value]) => NAME.test(name) && VALUE.test(value))
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");
}

/** The stylesheet text for a theme: `:root { … }` for light, `.dark { … }` for dark. Empty when the pack sets nothing. */
export function packStyleSheet(theme: Pick<OrgTheme, "light" | "dark">): string {
  const light = declarations(theme.light);
  const dark = declarations(theme.dark);
  const blocks: string[] = [];
  if (light) blocks.push(`:root {\n${light}\n}`);
  if (dark) blocks.push(`:root.dark,\n.dark {\n${dark}\n}`);
  return blocks.join("\n\n");
}

function isGoogleFont(url: string): boolean {
  return url.startsWith("https://fonts.googleapis.com/");
}

/** Puts the theme on the document (idempotent); `null` removes it. */
export function applyOrgTheme(theme: OrgTheme | null, doc: Document = document): void {
  const head = doc.head;
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  const css = theme ? packStyleSheet(theme) : "";
  if (css) {
    if (!style) {
      style = doc.createElement("style");
      style.id = STYLE_ID;
      head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
    style.setAttribute("data-pack", theme!.id);
  } else if (style) {
    style.remove();
  }

  const wanted = theme ? theme.fonts.filter(isGoogleFont) : [];
  const present = Array.from(head.querySelectorAll<HTMLLinkElement>(`link[${FONT_ATTR}]`));
  for (const link of present) {
    if (!wanted.includes(link.href)) link.remove();
  }
  for (const url of wanted) {
    if (present.some((link) => link.href === url)) continue;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.setAttribute(FONT_ATTR, "");
    head.appendChild(link);
  }
}
