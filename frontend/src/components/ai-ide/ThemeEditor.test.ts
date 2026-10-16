import { describe, expect, it } from "vitest";
import { withDesignImport, withHtmlMode } from "./ThemeEditor";

describe("withDesignImport", () => {
  it("adds design.css right after the kit's tokens when there is no design pack", () => {
    const css = "@tailwind base;\n@import './chronos/tokens.css';\n@tailwind components;\n";
    expect(withDesignImport(css)).toBe(
      "@tailwind base;\n@import './chronos/tokens.css';\n@import './design.css';\n@tailwind components;\n",
    );
  });

  it("places design.css after the design pack, never between tokens and pack.css", () => {
    const css = "@import './chronos/tokens.css';\n@import './design/pack.css';\n@tailwind base;\n";
    expect(withDesignImport(css)).toBe(
      "@import './chronos/tokens.css';\n@import './design/pack.css';\n@import './design.css';\n@tailwind base;\n",
    );
    // Also when the pack is imported with double quotes or before the tokens line.
    const doubleQuoted = '@import "./chronos/tokens.css";\n@import "./design/pack.css";\n';
    expect(withDesignImport(doubleQuoted)).toBe(doubleQuoted + "@import './design.css';\n");
    const packFirst = "@import './design/pack.css';\n@import './chronos/tokens.css';\n";
    expect(withDesignImport(packFirst)).toBe(
      "@import './design/pack.css';\n@import './design.css';\n@import './chronos/tokens.css';\n",
    );
  });

  it("leaves an index.css that already imports design.css alone", () => {
    const css = "@import './chronos/tokens.css';\n@import './design/pack.css';\n@import './design.css';\n";
    expect(withDesignImport(css)).toBe(css);
  });

  it("prepends the import when neither tokens nor a pack are imported", () => {
    expect(withDesignImport("@tailwind base;\n")).toBe("@import './design.css';\n@tailwind base;\n");
  });
});

describe("withHtmlMode", () => {
  it("sets and clears data-theme on <html>", () => {
    expect(withHtmlMode('<html lang="en">', "dark")).toBe('<html lang="en" data-theme="dark">');
    expect(withHtmlMode('<html lang="en" data-theme="dark">', "light")).toBe('<html lang="en">');
  });
});
