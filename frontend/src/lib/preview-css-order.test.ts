import { describe, expect, it } from "vitest";
import runtimeSource from "@/components/ai-ide/preview-runtime.js?raw";
import { DESIGN_CSS, PACK_CSS, TOKENS_CSS, orderStylesheets } from "./preview-css-order";

/** The runtime's own `orderStylesheets`, lifted out of the inlined script so both copies can be compared. */
function runtimeOrderStylesheets(): (paths: string[]) => string[] {
  const start = runtimeSource.indexOf("function orderStylesheets(");
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let end = -1;
  for (let i = runtimeSource.indexOf("{", start); i < runtimeSource.length; i += 1) {
    const ch = runtimeSource[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  expect(end).toBeGreaterThan(start);
  const constants = `var TOKENS_CSS = ${JSON.stringify(TOKENS_CSS)}; var PACK_CSS = ${JSON.stringify(PACK_CSS)}; var DESIGN_CSS = ${JSON.stringify(DESIGN_CSS)};`;
  return new Function(`${constants}\n${runtimeSource.slice(start, end)}\nreturn orderStylesheets;`)() as (paths: string[]) => string[];
}

const FIXTURE = [
  "src/App.tsx",
  "src/design.css",
  "src/pages/Home.tsx",
  "src/styles/charts.css",
  "src/design/pack.css",
  "src/design/pack.json",
  "src/index.css",
  "src/chronos/tokens.css",
  "src/design/brand/logo.svg",
  "src/components/Table.css",
];

describe("orderStylesheets", () => {
  it("loads tokens, then the design pack, then the rest, then the Design tab's overrides", () => {
    expect(orderStylesheets(FIXTURE)).toEqual([
      "src/chronos/tokens.css",
      "src/design/pack.css",
      "src/styles/charts.css",
      "src/index.css",
      "src/components/Table.css",
      "src/design.css",
    ]);
  });

  it("keeps the given order among ordinary stylesheets and copes without a pack", () => {
    expect(orderStylesheets(["b.css", "src/design.css", "a.css", "src/chronos/tokens.css"])).toEqual([
      "src/chronos/tokens.css",
      "b.css",
      "a.css",
      "src/design.css",
    ]);
    expect(orderStylesheets(["src/App.tsx"])).toEqual([]);
  });

  it("matches the copy inside the preview runtime", () => {
    const fromRuntime = runtimeOrderStylesheets();
    expect(runtimeSource).toContain(`var TOKENS_CSS = ${JSON.stringify(TOKENS_CSS)};`);
    expect(runtimeSource).toContain(`var PACK_CSS = ${JSON.stringify(PACK_CSS)};`);
    expect(runtimeSource).toContain(`var DESIGN_CSS = ${JSON.stringify(DESIGN_CSS)};`);
    for (const paths of [FIXTURE, [...FIXTURE].reverse(), ["x.css"], [], ["src/design.css", "src/design/pack.css"]]) {
      expect(fromRuntime(paths)).toEqual(orderStylesheets(paths));
    }
  });
});
