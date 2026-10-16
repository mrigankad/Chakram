/**
 * The order the App Builder preview concatenates a workspace's stylesheets in.
 *
 * The kit's tokens come first, a design pack's overrides (`src/design/pack.css`)
 * right after them, every other stylesheet in the order given, and the Design
 * tab's overrides (`src/design.css`) last so they win over the pack.
 *
 * The preview runtime (`components/ai-ide/preview-runtime.js`) is plain JS that
 * is inlined into the sandboxed iframe, so it cannot import this module: it holds
 * its own copy, `orderStylesheets`, and `preview-css-order.test.ts` checks that
 * the two agree. Change both together.
 */

export const TOKENS_CSS = "src/chronos/tokens.css";
export const PACK_CSS = "src/design/pack.css";
export const DESIGN_CSS = "src/design.css";

function rank(path: string): number {
  if (path === TOKENS_CSS) return 0;
  if (path === PACK_CSS) return 1;
  if (path === DESIGN_CSS) return 3;
  return 2;
}

/** The `.css` paths among `paths`, in the order the preview loads them. */
export function orderStylesheets(paths: readonly string[]): string[] {
  return paths
    .map((path, index) => ({ path, index }))
    .filter(({ path }) => path.endsWith(".css"))
    .sort((a, b) => rank(a.path) - rank(b.path) || a.index - b.index)
    .map(({ path }) => path);
}
