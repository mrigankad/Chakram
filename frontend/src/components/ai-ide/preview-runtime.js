/*
 * Chakram App Builder preview runtime.
 *
 * Runs inside the sandboxed preview iframe (opaque origin: no cookies, no
 * storage, no access to the Chakram page). The parent posts the workspace
 * files; this script compiles the TypeScript/TSX in the browser, resolves
 * npm packages from esm.sh, mounts src/App.tsx and reports build state,
 * runtime errors, console output and the current route back to the parent.
 *
 * Plain JavaScript on purpose: the file is inlined into the iframe document
 * as text (see AiIdePreview.tsx), so it is never bundled or type-checked.
 */
(function () {
  "use strict";

  var SOURCE = "chakram-preview";
  var ESM = "https://esm.sh/";
  var REACT_VERSION = "18.3.1";
  var REACT_DEPS = "deps=react@" + REACT_VERSION + ",react-dom@" + REACT_VERSION;
  // Keep in step with TEMPLATE_DEPENDENCIES in backend/app/services/template_service.py
  // so the preview runs the same library versions a real `npm install` would.
  var PINNED = {
    "react": REACT_VERSION,
    "react-dom": REACT_VERSION,
    "react-router-dom": "6.30.1",
    "recharts": "2.15.0",
    "lucide-react": "0.462.0",
    "clsx": "2.1.1",
    "tailwind-merge": "2.6.0",
    "framer-motion": "11.15.0",
    "@tanstack/react-query": "5.62.0",
    "date-fns": "3.6.0",
    "@radix-ui/react-dialog": "1.1.4",
    "@radix-ui/react-dropdown-menu": "2.1.4",
    "@radix-ui/react-tabs": "1.1.2",
    "@radix-ui/react-tooltip": "1.1.6",
  };
  var LOCAL_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

  function post(message) {
    message.source = SOURCE;
    try {
      window.parent.postMessage(message, "*");
    } catch (_err) {
      /* the parent is gone */
    }
  }

  // ── Storage shims ────────────────────────────────────────────────────────
  // An opaque origin has no storage; generated apps often expect it, so give
  // them an in-memory one that lives as long as the preview.
  function memoryStorage() {
    var data = Object.create(null);
    return {
      get length() {
        return Object.keys(data).length;
      },
      key: function (i) {
        return Object.keys(data)[i] || null;
      },
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
      },
      setItem: function (k, v) {
        data[String(k)] = String(v);
      },
      removeItem: function (k) {
        delete data[k];
      },
      clear: function () {
        data = Object.create(null);
      },
    };
  }
  ["localStorage", "sessionStorage"].forEach(function (name) {
    var ok = false;
    try {
      ok = !!window[name];
    } catch (_err) {
      ok = false;
    }
    if (!ok) {
      try {
        Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
      } catch (_err) {
        /* leave as is */
      }
    }
  });

  // ── Console and error capture ────────────────────────────────────────────
  var urlToPath = Object.create(null);

  function describe(value) {
    if (value instanceof Error) return value.stack || value.message || String(value);
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch (_err) {
      return String(value);
    }
  }

  // A module's blob URL as it appears in stack traces, without the :line:column suffix.
  var BLOB_URL = /blob:(?:null|[a-z]+:\/\/[^\/\s]+)\/[0-9a-f-]{36}/g;

  function mapUrls(text) {
    return String(text || "").replace(BLOB_URL, function (url) {
      return urlToPath[url] || url;
    });
  }

  function pathFromText(text) {
    var found = String(text || "").match(BLOB_URL) || [];
    for (var i = 0; i < found.length; i += 1) {
      if (urlToPath[found[i]] && urlToPath[found[i]] !== "react-router-dom") return urlToPath[found[i]];
    }
    return null;
  }

  ["log", "info", "warn", "error", "debug"].forEach(function (level) {
    var original = console[level] ? console[level].bind(console) : function () {};
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      try {
        post({
          type: "console",
          level: level,
          text: mapUrls(args.map(describe).join(" ")).slice(0, 4000),
        });
      } catch (_err) {
        /* never let reporting break the app */
      }
      original.apply(console, args);
    };
  });

  window.addEventListener("error", function (event) {
    var error = event.error;
    var text = error ? describe(error) : event.message;
    post({
      type: "error",
      stage: "runtime",
      message: mapUrls(text).slice(0, 4000),
      path: pathFromText(error && error.stack ? error.stack : event.filename),
    });
  });
  window.addEventListener("unhandledrejection", function (event) {
    var text = describe(event.reason);
    post({
      type: "error",
      stage: "runtime",
      message: mapUrls(text).slice(0, 4000),
      path: pathFromText(event.reason && event.reason.stack),
    });
  });

  // ── Module resolution ────────────────────────────────────────────────────
  function dirname(path) {
    var i = path.lastIndexOf("/");
    return i <= 0 ? "" : path.slice(0, i);
  }

  function normalize(path) {
    var parts = path.split("/");
    var out = [];
    for (var i = 0; i < parts.length; i += 1) {
      var p = parts[i];
      if (!p || p === ".") continue;
      if (p === "..") out.pop();
      else out.push(p);
    }
    return out.join("/");
  }

  function isLocal(spec) {
    return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") || spec.startsWith("@/");
  }

  /** Workspace path a local import points at, before extension lookup. */
  function localTarget(from, spec) {
    if (spec.startsWith("@/")) return normalize("src/" + spec.slice(2));
    if (spec.startsWith("/")) return normalize(spec.slice(1));
    return normalize(dirname(from) + "/" + spec);
  }

  function lookup(files, target) {
    var candidates = [target];
    LOCAL_EXTENSIONS.forEach(function (ext) {
      candidates.push(target + ext);
    });
    LOCAL_EXTENSIONS.forEach(function (ext) {
      candidates.push(target + "/index" + ext);
    });
    for (var i = 0; i < candidates.length; i += 1) {
      if (Object.prototype.hasOwnProperty.call(files, candidates[i])) return candidates[i];
    }
    return null;
  }

  function packageName(spec) {
    var parts = spec.split("/");
    return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  }

  function esmUrl(spec) {
    var name = packageName(spec);
    var subpath = spec.slice(name.length);
    var version = PINNED[name];
    var base = ESM + name + (version ? "@" + version : "") + subpath;
    if (name === "react") return base;
    if (name === "react-dom") return base + "?deps=react@" + REACT_VERSION;
    return base + "?" + REACT_DEPS;
  }

  function packageUrl(spec) {
    if (spec === "react-router-dom") return routerShimUrl();
    if (spec === "react/jsx-dev-runtime") return jsxDevShimUrl();
    return esmUrl(spec);
  }

  var _jsxDevShimUrl = null;

  function jsxDevShimUrl() {
    if (_jsxDevShimUrl) return _jsxDevShimUrl;
    var code = [
      'import { jsx, Fragment } from "' + esmUrl("react/jsx-runtime") + '";',
      "export { Fragment };",
      "export function jsxDEV(type, props, key, isStatic, source) {",
      "  if (source && source.fileName) {",
      "    var at = source.fileName + ':' + source.lineNumber;",
      "    if (typeof type === 'string') {",
      "      props = Object.assign({}, props, { 'data-csrc': at });",
      "    } else if (type !== Fragment && source.fileName.indexOf('src/chronos/') !== 0) {",
      "      props = Object.assign({}, props, { __cuse: at });",
      "    }",
      "  }",
      "  return jsx(type, props, key);",
      "}",
    ].join("\n");
    _jsxDevShimUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    urlToPath[_jsxDevShimUrl] = "react-router-dom";
    return _jsxDevShimUrl;
  }

  // ── Router shim ──────────────────────────────────────────────────────────
  // A sandboxed document cannot change its own URL, not even the hash, so the
  // app's BrowserRouter/HashRouter become a MemoryRouter that reports its
  // location to the parent and takes navigation requests from it. The shim
  // re-exports the real react-router-dom, so both share one instance.
  var currentRoute = "/";
  var navigateFn = null;
  var _routerShimUrl = null;

  function routerShimUrl() {
    if (_routerShimUrl) return _routerShimUrl;
    var code = [
      'import React, { useEffect } from "' + esmUrl("react") + '";',
      'import * as RRD from "' + esmUrl("react-router-dom") + '";',
      'export * from "' + esmUrl("react-router-dom") + '";',
      "var MemoryRouter = RRD.MemoryRouter, useLocation = RRD.useLocation, useNavigate = RRD.useNavigate, createMemoryRouter = RRD.createMemoryRouter;",
      "function Reporter() {",
      "  var location = useLocation();",
      "  var navigate = useNavigate();",
      "  useEffect(function () { window.__previewRoute(location.pathname + location.search + location.hash); }, [location]);",
      "  useEffect(function () { window.__previewNavigate = function (to) { navigate(to); }; return function () { window.__previewNavigate = null; }; }, [navigate]);",
      "  return null;",
      "}",
      "export function BrowserRouter(props) {",
      "  return React.createElement(MemoryRouter, { initialEntries: [window.__previewInitialRoute()], basename: props.basename, future: props.future }, React.createElement(Reporter), props.children);",
      "}",
      "export var HashRouter = BrowserRouter;",
      "export function createBrowserRouter(routes, opts) {",
      "  var router = createMemoryRouter(routes, Object.assign({}, opts || {}, { initialEntries: [window.__previewInitialRoute()] }));",
      "  router.subscribe(function (state) { window.__previewRoute(state.location.pathname + state.location.search + state.location.hash); });",
      "  window.__previewNavigate = function (to) { router.navigate(to); };",
      "  window.__previewRoute(router.state.location.pathname);",
      "  return router;",
      "}",
      "export var createHashRouter = createBrowserRouter;",
    ].join("\n");
    _routerShimUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    urlToPath[_routerShimUrl] = "react-router-dom";
    return _routerShimUrl;
  }

  window.__previewInitialRoute = function () {
    return currentRoute || "/";
  };
  window.__previewRoute = function (path) {
    var next = path || "/";
    if (next === currentRoute) return;
    currentRoute = next;
    post({ type: "route", path: next });
  };

  // ── Compiler ─────────────────────────────────────────────────────────────
  var compiler = null;

  function loadCompiler() {
    if (compiler) return compiler;
    compiler = Promise.all([
      import(ESM + "sucrase@3.35.0"),
      import(ESM + "es-module-lexer@1.6.0"),
    ]).then(function (mods) {
      var sucrase = mods[0];
      var lexer = mods[1];
      return lexer.init.then(function () {
        return { transform: sucrase.transform, parse: lexer.parse };
      });
    });
    compiler.catch(function () {
      compiler = null;
    });
    return compiler;
  }

  var transformCache = Object.create(null); // path -> { source, code, imports }

  // Vite's env object for the app; the parent supplies VITE_MARKS_BASE (where the 3D icons are served).
  var previewEnv = { MODE: "development", DEV: true, PROD: false, BASE_URL: "/" };

  function prepareSource(path, source) {
    var out = source;
    // Vite's env object does not exist here.
    // Any spelling of Vite's env object, including the TypeScript cast `(import.meta as any).env`.
    var envLiteral = "(" + JSON.stringify(previewEnv) + ")";
    out = out.replace(/\(\s*import\.meta\s+as\s+[A-Za-z_$][\w$<>,\s]*\)\s*\.\s*env\b/g, envLiteral);
    out = out.replace(/\bimport\.meta\.env\b/g, envLiteral);
    return out;
  }

  function transformFile(tools, path, source) {
    var cached = transformCache[path];
    if (cached && cached.source === source) return cached;
    var prepared = prepareSource(path, source);
    var code;
    try {
      code = tools.transform(prepared, {
        transforms: path.endsWith(".ts") ? ["typescript"] : ["typescript", "jsx"],
        jsxRuntime: "automatic",
        // Dev output passes each element's source line to jsxDEV; the shim below turns it
        // into a data-csrc attribute so a click in the preview maps back to the code.
        production: false,
        filePath: path,
        disableESTransforms: true,
      }).code;
    } catch (err) {
      var e = new Error((err && err.message ? err.message : String(err)));
      e.path = path;
      e.stage = "compile";
      throw e;
    }
    var imports;
    try {
      imports = tools.parse(code)[0];
    } catch (err) {
      var e2 = new Error("Could not read the imports of " + path + ": " + (err && err.message ? err.message : String(err)));
      e2.path = path;
      e2.stage = "compile";
      throw e2;
    }
    var entry = { source: source, code: code, imports: imports };
    transformCache[path] = entry;
    return entry;
  }

  /** Names a pending module is imported with, so its stand-in exports them. */
  function importedNames(files, pendingPath) {
    var names = { default: false, named: [] };
    var re = /import\s+([^'";]+?)\s+from\s*['"]([^'"]+)['"]/g;
    Object.keys(files).forEach(function (path) {
      var source = files[path];
      if (typeof source !== "string") return;
      var match;
      re.lastIndex = 0;
      while ((match = re.exec(source))) {
        if (!isLocal(match[2])) continue;
        if (lookup({ [pendingPath]: "" }, localTarget(path, match[2])) !== pendingPath) continue;
        var clause = match[1].replace(/\btype\s+/g, "").trim();
        var braces = /\{([^}]*)\}/.exec(clause);
        if (braces) {
          braces[1].split(",").forEach(function (part) {
            var name = part.trim().split(/\s+as\s+/)[0].trim();
            if (name && /^[A-Za-z_$][\w$]*$/.test(name) && names.named.indexOf(name) < 0) names.named.push(name);
          });
          clause = clause.replace(braces[0], "");
        }
        clause = clause.replace(/\*\s+as\s+\w+/, "").replace(/,/g, "").trim();
        if (clause) names.default = true;
      }
    });
    return names;
  }

  function stubModule(files, path) {
    var names = importedNames(files, path);
    var label = path.split("/").pop().replace(/\.[jt]sx?$/, "");
    var lines = [
      'import React from "' + packageUrl("react") + '";',
      "function placeholder(name) {",
      "  var Component = function () {",
      '    return React.createElement("div", { "data-preview-pending": name, style: { padding: "16px", margin: "8px 0", border: "1px dashed rgba(148,163,184,0.6)", borderRadius: "8px", color: "#94a3b8", fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: "13px" } }, "Generating " + name + "\\u2026");',
      "  };",
      "  Component.displayName = name;",
      "  return Component;",
      "}",
      'export default placeholder("' + label + '");',
    ];
    names.named.forEach(function (name) {
      if (name === "default") return;
      lines.push("export const " + name + ' = placeholder("' + name + '");');
    });
    return lines.join("\n");
  }

  function svgDataUrl(source) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(String(source == null ? "" : source));
  }

  // ── Stylesheets ──────────────────────────────────────────────────────────
  var TOKENS_CSS = "src/chronos/tokens.css";
  var PACK_CSS = "src/design/pack.css";
  var DESIGN_CSS = "src/design.css";

  /**
   * The order the workspace's stylesheets are concatenated in: the kit's tokens, then
   * the design pack's overrides, then every other stylesheet as given, and the Design
   * tab's overrides (src/design.css) last so they win. Mirrored by
   * src/lib/preview-css-order.ts; keep the two in step.
   */
  function orderStylesheets(paths) {
    function rank(p) {
      if (p === TOKENS_CSS) return 0;
      if (p === PACK_CSS) return 1;
      if (p === DESIGN_CSS) return 3;
      return 2;
    }
    var indexed = [];
    for (var i = 0; i < paths.length; i += 1) {
      if (paths[i].endsWith(".css")) indexed.push({ path: paths[i], index: i });
    }
    indexed.sort(function (a, b) {
      return rank(a.path) - rank(b.path) || a.index - b.index;
    });
    var out = [];
    for (var j = 0; j < indexed.length; j += 1) out.push(indexed[j].path);
    return out;
  }

  // ── Build ────────────────────────────────────────────────────────────────
  function build(tools, files, pending) {
    var pendingSet = Object.create(null);
    (pending || []).forEach(function (p) {
      pendingSet[p] = true;
    });
    var urls = Object.create(null); // path -> blob url
    var visiting = Object.create(null);
    var createdUrls = [];
    var moduleCount = 0;

    function emit(path, code) {
      var url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      urls[path] = url;
      urlToPath[url] = path;
      createdUrls.push(url);
      moduleCount += 1;
      return url;
    }

    function compile(path, chain) {
      if (urls[path]) return urls[path];
      if (visiting[path]) {
        var cycle = chain.slice(chain.indexOf(path)).concat(path).join(" -> ");
        var err = new Error("Circular import is not supported in the preview: " + cycle);
        err.path = path;
        err.stage = "compile";
        throw err;
      }
      if (pendingSet[path]) return emit(path, stubModule(files, path));
      var source = files[path];
      if (!path.endsWith(".ts") && !path.endsWith(".tsx") && !path.endsWith(".js") && !path.endsWith(".jsx")) {
        if (path.endsWith(".json")) return emit(path, "export default " + source + ";");
        if (path.endsWith(".css")) return emit(path, "export {};");
        // An SVG (a design pack's logo) imports as a data URL, as Vite would serve it.
        if (path.endsWith(".svg")) return emit(path, "export default " + JSON.stringify(svgDataUrl(source)) + ";");
        var e = new Error("The preview cannot import " + path + " (only TS, TSX, JS, JSX, JSON, CSS and SVG files)");
        e.path = path;
        e.stage = "compile";
        throw e;
      }
      visiting[path] = true;
      var entry = transformFile(tools, path, source);
      var code = entry.code;
      var pieces = [];
      var cursor = 0;
      entry.imports.forEach(function (imp) {
        if (imp.d === -2 || !imp.n) return; // import.meta or a dynamic import with a computed specifier
        var spec = imp.n;
        var replacement;
        if (isLocal(spec)) {
          // Vite's `?url` suffix (e.g. `logo.svg?url`) asks for the asset's URL, which is what a data URL is.
          var target = localTarget(path, spec.replace(/\?url$/, ""));
          var resolved = lookup(files, target);
          if (!resolved) {
            // Planned files are known before they exist; stand in for them until they land.
            var pendingMatch = lookup(pendingSet, target);
            if (pendingMatch) resolved = pendingMatch;
          }
          if (!resolved) {
            var missing = new Error("Cannot find module '" + spec + "' imported by " + path);
            missing.path = path;
            missing.stage = "compile";
            throw missing;
          }
          replacement = compile(resolved, chain.concat(path));
        } else {
          replacement = packageUrl(spec);
        }
        // A dynamic import's specifier span includes its quotes; a static one's does not.
        var raw = code.slice(imp.s, imp.e);
        var quoted = raw.charAt(0) === '"' || raw.charAt(0) === "'" || raw.charAt(0) === "`";
        pieces.push(code.slice(cursor, imp.s), quoted ? JSON.stringify(replacement) : replacement);
        cursor = imp.e;
      });
      pieces.push(code.slice(cursor));
      delete visiting[path];
      return emit(path, pieces.join(""));
    }

    var entryPath = lookup(files, "src/App") || lookup(pendingSet, "src/App");
    if (!entryPath) {
      var noEntry = new Error("The workspace has no src/App.tsx to render");
      noEntry.stage = "compile";
      throw noEntry;
    }
    var entryUrl = compile(entryPath, []);
    return { entryUrl: entryUrl, createdUrls: createdUrls, moduleCount: moduleCount, entryPath: entryPath };
  }

  var appliedDesign = null;
  // The app's default colour mode (design.json) and an optional preview-only override.
  var designMode = "light";
  var previewMode = null;

  function applyMode() {
    var mode = previewMode || designMode;
    if (mode === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }

  function setFontLinks(urls) {
    var wanted = {};
    urls.forEach(function (u) {
      if (typeof u === "string" && u.indexOf("https://fonts.googleapis.com/") === 0) wanted[u] = true;
    });
    Array.prototype.slice.call(document.querySelectorAll("link[data-preview-font]")).forEach(function (el) {
      if (!wanted[el.href]) el.remove();
      else delete wanted[el.href];
    });
    Object.keys(wanted).forEach(function (u) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = u;
      link.setAttribute("data-preview-font", "");
      document.head.appendChild(link);
    });
  }

  /** design.json: the same Tailwind theme the project's tailwind.config.js reads. */
  function mergeDeep(a, b) {
    if (!b || typeof b !== "object" || Array.isArray(b)) return b === undefined ? a : b;
    var out = Object.assign({}, a && typeof a === "object" && !Array.isArray(a) ? a : {});
    Object.keys(b).forEach(function (k) {
      out[k] = mergeDeep(out[k], b[k]);
    });
    return out;
  }

  function applyDesign(files) {
    var kitRaw = files["src/chronos/theme.json"] || "";
    var raw = files["design.json"] || "";
    var key = kitRaw + "\u0000" + raw;
    if (key === appliedDesign) return false;
    appliedDesign = key;
    var kit = {};
    try {
      kit = kitRaw ? JSON.parse(kitRaw) : {};
    } catch (_err) {
      kit = {};
    }
    var design = null;
    try {
      design = raw ? JSON.parse(raw) : null;
    } catch (_err) {
      design = null;
    }
    var tw = design && design.tailwind && typeof design.tailwind === "object" ? design.tailwind : {};
    // Same merge as the project's tailwind.config.js: the Chronos kit theme, then the design editor's overrides.
    var config = { darkMode: "class", theme: { extend: mergeDeep(kit, (tw.theme && tw.theme.extend) || {}) } };
    try {
      window.tailwind = window.tailwind || {};
      window.tailwind.config = config;
    } catch (_err) {
      /* the CDN may not be ready yet; it reads tailwind.config when it is */
    }
    setFontLinks((design && Array.isArray(design.fontLinks)) ? design.fontLinks : []);
    designMode = design && design.theme && design.theme.mode === "dark" ? "dark" : "light";
    applyMode();
    return true;
  }

  function applyStyles(files) {
    var designChanged = applyDesign(files);
    var imports = [];
    // Tokens, then the design pack, then the rest, then the Design tab's overrides.
    var css = orderStylesheets(Object.keys(files))
      .map(function (p) {
        return String(files[p])
          .replace(/@tailwind\s+[a-z]+\s*;/g, "")
          // Only `@import url(...)` is lifted out (Google Fonts become a <link>); an
          // `@font-face` whose src is a data: URL or a fonts.gstatic.com file stays in the sheet.
          .replace(/@import\s+url\((['"]?)([^'")]+)\1\)\s*;?/g, function (_m, _q, url) {
            imports.push(url);
            return "";
          })
          // Local stylesheet imports (e.g. the kit's tokens.css) are already part of this
          // concatenation; the Tailwind CDN cannot resolve them.
          .replace(/@import\s+(['"])[^'"]+\1\s*;?/g, "");
      })
      .join("\n");
    imports.forEach(function (u) {
      if (u.indexOf("https://fonts.googleapis.com/") === 0 && !document.querySelector('link[href="' + u + '"]')) {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = u;
        document.head.appendChild(link);
      }
    });
    if (designChanged) css += "\n/* design " + Date.now() + " */";
    var el = document.getElementById("workspace-styles");
    if (!el) {
      el = document.createElement("style");
      el.id = "workspace-styles";
      el.type = "text/tailwindcss";
      document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }

  // ── Mounting ─────────────────────────────────────────────────────────────
  var reactMods = null;
  var currentRoot = null;
  var previousUrls = [];
  var buildSeq = 0;

  function loadReact() {
    if (reactMods) return reactMods;
    reactMods = Promise.all([import(packageUrl("react")), import(packageUrl("react-dom/client"))]).then(function (m) {
      return { React: m[0].default || m[0], ReactDOMClient: m[1] };
    });
    reactMods.catch(function () {
      reactMods = null;
    });
    return reactMods;
  }

  function makeBoundary(React) {
    function Boundary(props) {
      React.Component.call(this, props);
      this.state = { error: null };
    }
    Boundary.prototype = Object.create(React.Component.prototype);
    Boundary.prototype.constructor = Boundary;
    Boundary.getDerivedStateFromError = function (error) {
      return { error: error };
    };
    Boundary.prototype.componentDidCatch = function (error, info) {
      post({
        type: "error",
        stage: "render",
        message: mapUrls(describe(error) + (info && info.componentStack ? "\n" + info.componentStack : "")).slice(0, 4000),
        path: pathFromText(error && error.stack),
      });
    };
    Boundary.prototype.render = function () {
      if (this.state.error) {
        return React.createElement(
          "div",
          { style: { padding: "24px", fontFamily: "ui-monospace, monospace", fontSize: "12px", color: "#fca5a5", whiteSpace: "pre-wrap", background: "#0a0a0a", minHeight: "100%" } },
          "The app crashed while rendering.\n\n" + mapUrls(describe(this.state.error)),
        );
      }
      return this.props.children;
    };
    return Boundary;
  }

  async function run(files, pending, nonce) {
    var seq = (buildSeq += 1);
    var started = performance.now();
    post({ type: "building", nonce: nonce });
    var tools;
    try {
      tools = await loadCompiler();
    } catch (err) {
      post({
        type: "error",
        stage: "runtime-load",
        message: "The preview compiler could not be loaded from esm.sh (" + describe(err) + "). Check that this browser can reach https://esm.sh.",
        nonce: nonce,
      });
      return;
    }
    if (seq !== buildSeq) return;

    var result;
    try {
      applyStyles(files);
      result = build(tools, files, pending);
    } catch (err) {
      post({ type: "error", stage: err.stage || "compile", message: describe(err.message || err), path: err.path || null, nonce: nonce });
      return;
    }

    var mods, appModule;
    try {
      mods = await loadReact();
      appModule = await import(result.entryUrl);
    } catch (err) {
      if (seq === buildSeq) {
        post({
          type: "error",
          stage: "import",
          message: mapUrls(describe(err)).slice(0, 4000),
          path: pathFromText(err && err.stack) || result.entryPath,
          nonce: nonce,
        });
      }
      return;
    }
    if (seq !== buildSeq) return;

    var App = appModule.default;
    if (typeof App !== "function" && !(App && typeof App === "object")) {
      post({ type: "error", stage: "import", message: "src/App.tsx has no default export component", path: result.entryPath, nonce: nonce });
      return;
    }

    var React = mods.React;
    var container = document.getElementById("root");
    if (currentRoot) {
      try {
        currentRoot.unmount();
      } catch (_err) {
        /* a crashed tree may refuse to unmount */
      }
      currentRoot = null;
    }
    container.innerHTML = "";
    previousUrls.forEach(function (u) {
      URL.revokeObjectURL(u);
    });
    previousUrls = result.createdUrls;

    var Boundary = makeBoundary(React);
    try {
      currentRoot = mods.ReactDOMClient.createRoot(container);
      currentRoot.render(React.createElement(Boundary, null, React.createElement(App)));
    } catch (err) {
      post({ type: "error", stage: "render", message: mapUrls(describe(err)).slice(0, 4000), path: pathFromText(err && err.stack), nonce: nonce });
      return;
    }
    post({ type: "built", nonce: nonce, modules: result.moduleCount, ms: Math.round(performance.now() - started), route: currentRoute });
  }

  // ── Inspector (visual editing) ──────────────────────────────────────────
  var inspecting = false;
  var hoverEl = null;
  var selectedEl = null;
  var editingEl = null;
  var boxes = null;

  function ensureBoxes() {
    if (boxes) return boxes;
    function box(color, style) {
      var b = document.createElement("div");
      b.setAttribute("data-preview-ui", "");
      b.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;display:none;border-radius:3px;" +
        "border:" + style + " " + color + ";";
      document.documentElement.appendChild(b);
      return b;
    }
    var label = document.createElement("div");
    label.setAttribute("data-preview-ui", "");
    label.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483647;display:none;background:#2563eb;color:#fff;" +
      "font:600 10px/16px ui-sans-serif,system-ui,sans-serif;padding:0 6px;border-radius:3px;white-space:nowrap;";
    boxes = { hover: box("#60a5fa", "1px dashed"), selected: box("#2563eb", "2px solid"), label: label };
    document.documentElement.appendChild(label);
    return boxes;
  }

  function sourceOf(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      if (node.hasAttribute && node.hasAttribute("data-csrc")) return node;
      node = node.parentElement;
    }
    return null;
  }

  function ownText(el) {
    if (!el.childNodes.length) return null;
    for (var i = 0; i < el.childNodes.length; i += 1) {
      if (el.childNodes[i].nodeType !== 3) return null;
    }
    var text = el.textContent || "";
    return text.trim() ? text : null;
  }

  function placeBox(b, el) {
    if (!el || !el.isConnected) {
      b.style.display = "none";
      return null;
    }
    var r = el.getBoundingClientRect();
    b.style.display = "block";
    b.style.left = r.left + "px";
    b.style.top = r.top + "px";
    b.style.width = r.width + "px";
    b.style.height = r.height + "px";
    return r;
  }

  function paint() {
    if (!boxes) return;
    placeBox(boxes.hover, inspecting && hoverEl !== selectedEl ? hoverEl : null);
    var r = placeBox(boxes.selected, selectedEl);
    if (r && selectedEl) {
      boxes.label.style.display = "block";
      boxes.label.textContent = selectedEl.tagName.toLowerCase() + (ownText(selectedEl) ? "  ·  double-click to edit text" : "");
      boxes.label.style.left = Math.max(0, r.left) + "px";
      boxes.label.style.top = Math.max(0, r.top - 18) + "px";
    } else {
      boxes.label.style.display = "none";
    }
  }

  (function loop() {
    if (inspecting || selectedEl) paint();
    requestAnimationFrame(loop);
  })();

  function splitSrc(src) {
    var cut = (src || "").lastIndexOf(":");
    return cut > 0 ? { file: src.slice(0, cut), line: Number(src.slice(cut + 1)) } : { file: src || "", line: 0 };
  }

  function fiberOf(el) {
    for (var key in el) {
      if (key.indexOf("__reactFiber$") === 0) return el[key];
    }
    return null;
  }

  /** The nearest component above el that was used from an app file (outside the kit). */
  function usageOf(el) {
    var fiber = fiberOf(el);
    var guard = 0;
    while (fiber && guard < 400) {
      guard += 1;
      var props = fiber.memoizedProps;
      if (fiber.type && typeof fiber.type !== "string" && props && typeof props.__cuse === "string") {
        var t = fiber.type;
        var name = (t && (t.displayName || t.name)) || (t && t.render && (t.render.displayName || t.render.name)) || "Component";
        var at = splitSrc(props.__cuse);
        return { file: at.file, line: at.line, component: name };
      }
      fiber = fiber.return;
    }
    return null;
  }

  function markIdOf(el) {
    if (el.tagName !== "IMG") return null;
    var m = /\/([a-z0-9][a-z0-9-]*)\.png(?:$|\?)/.exec(el.getAttribute("src") || "");
    return m ? m[1] : null;
  }

  function describeEl(el) {
    var src = el.getAttribute("data-csrc") || "";
    var at = splitSrc(src);
    var styles = getComputedStyle(el);
    var inKit = at.file.indexOf("src/chronos/") === 0;
    var path = [];
    var node = el.parentElement;
    while (node && path.length < 6) {
      if (node.hasAttribute && node.hasAttribute("data-csrc")) path.push(node.tagName.toLowerCase());
      node = node.parentElement;
    }
    return {
      file: at.file,
      line: at.line,
      tag: el.tagName.toLowerCase(),
      className: el.getAttribute("class") || "",
      text: ownText(el),
      // Same JSX line rendered several times (a list item, a shared component): an edit changes all of them.
      instances: document.querySelectorAll('[data-csrc="' + src + '"]').length,
      usage: inKit ? usageOf(el) : null,
      markId: markIdOf(el),
      ancestors: path,
      style: {
        color: styles.color,
        background: styles.backgroundColor,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight,
        padding: styles.padding,
        borderRadius: styles.borderRadius,
        width: Math.round(el.getBoundingClientRect().width),
        height: Math.round(el.getBoundingClientRect().height),
      },
    };
  }

  function select(el) {
    selectedEl = el;
    ensureBoxes();
    paint();
    if (el) post(Object.assign({ type: "select" }, describeEl(el)));
    else post({ type: "select", file: null });
  }

  function finishTextEdit(commit) {
    var el = editingEl;
    if (!el) return;
    editingEl = null;
    var oldText = el.getAttribute("data-preview-old") || "";
    el.removeAttribute("data-preview-old");
    el.removeAttribute("contenteditable");
    var newText = el.innerText.replace(/\n+$/, "");
    if (!commit) {
      el.textContent = oldText;
      return;
    }
    if (newText !== oldText) post(Object.assign({ type: "text-edit", oldText: oldText, newText: newText }, describeEl(el)));
  }

  function startTextEdit(el) {
    if (ownText(el) === null) return;
    editingEl = el;
    el.setAttribute("data-preview-old", el.textContent || "");
    el.setAttribute("contenteditable", "plaintext-only");
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function isUi(target) {
    return target && target.closest && target.closest("[data-preview-ui]");
  }

  document.addEventListener("mousemove", function (e) {
    if (!inspecting || editingEl) return;
    var el = sourceOf(e.target);
    if (el !== hoverEl) {
      hoverEl = el;
      ensureBoxes();
    }
  }, true);

  ["click", "mousedown", "mouseup", "pointerdown", "submit", "auxclick"].forEach(function (name) {
    document.addEventListener(name, function (e) {
      if (!inspecting || isUi(e.target)) return;
      if (editingEl && editingEl.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (name === "click") {
        if (editingEl) finishTextEdit(true);
        select(sourceOf(e.target));
      }
    }, true);
  });

  document.addEventListener("dblclick", function (e) {
    if (!inspecting) return;
    e.preventDefault();
    e.stopPropagation();
    var el = sourceOf(e.target);
    if (el) {
      select(el);
      startTextEdit(el);
    }
  }, true);

  document.addEventListener("keydown", function (e) {
    if (!editingEl) {
      if (inspecting && e.key === "Escape") select(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finishTextEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishTextEdit(false);
    }
  }, true);

  document.addEventListener("focusout", function (e) {
    if (editingEl && e.target === editingEl) finishTextEdit(true);
  }, true);

  /** After a rebuild, find the element again by its source line and tag. */
  function reselect(info) {
    if (!info || !info.file) return;
    var candidates = document.querySelectorAll('[data-csrc="' + info.file + ":" + info.line + '"]');
    var match = null;
    var fallback = null;
    var wantUse = info.usage && info.usage.file ? info.usage.file + ":" + info.usage.line : null;
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i].tagName.toLowerCase() !== info.tag) continue;
      if (!fallback) fallback = candidates[i];
      // Kit components render every instance from the same line: tell them apart by where they are used.
      if (!wantUse) {
        match = candidates[i];
        break;
      }
      var use = usageOf(candidates[i]);
      if (use && use.file + ":" + use.line === wantUse) {
        match = candidates[i];
        break;
      }
    }
    match = match || (wantUse ? null : fallback);
    selectedEl = match;
    if (match) post(Object.assign({ type: "select" }, describeEl(match)));
  }

  // ── Parent protocol ──────────────────────────────────────────────────────
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.target !== SOURCE) return;
    if (data.type === "inspect") {
      inspecting = !!data.on;
      ensureBoxes();
      document.documentElement.style.cursor = inspecting ? "crosshair" : "";
      // Decorative elements (e.g. the kit's 3D icons) use pointer-events:none; while selecting,
      // everything that came from the app's code must be clickable.
      var pe = document.getElementById("preview-inspect-style");
      if (inspecting && !pe) {
        pe = document.createElement("style");
        pe.id = "preview-inspect-style";
        pe.setAttribute("data-preview-ui", "");
        pe.textContent = "[data-csrc]{pointer-events:auto !important}";
        document.head.appendChild(pe);
      } else if (!inspecting && pe) {
        pe.remove();
      }
      if (!inspecting) {
        if (editingEl) finishTextEdit(true);
        hoverEl = null;
        select(null);
      }
      paint();
      return;
    }
    if (data.type === "preview-mode") {
      previewMode = data.mode === "dark" || data.mode === "light" ? data.mode : null;
      applyMode();
      return;
    }
    if (data.type === "select-parent") {
      if (selectedEl && selectedEl.parentElement) {
        var parent = sourceOf(selectedEl.parentElement);
        if (parent && parent !== document.documentElement) select(parent);
      }
      return;
    }
    if (data.type === "select-clear") {
      select(null);
      return;
    }
    if (data.type === "reselect") {
      setTimeout(function () {
        reselect(data.info);
      }, 60);
      return;
    }
    if (data.type === "update") {
      if (data.env && typeof data.env === "object") {
        var nextEnv = Object.assign({}, previewEnv, data.env);
        if (JSON.stringify(nextEnv) !== JSON.stringify(previewEnv)) {
          previewEnv = nextEnv;
          transformCache = Object.create(null);
        }
      }
      run(data.files || {}, data.pending || [], data.nonce);
    } else if (data.type === "navigate") {
      var path = String(data.path || "/");
      if (!path.startsWith("/")) path = "/" + path;
      if (typeof window.__previewNavigate === "function") {
        window.__previewNavigate(path);
      } else {
        // No router mounted (yet): remember the route for the next mount.
        currentRoute = path;
        post({ type: "route", path: path });
      }
    }
  });

  post({ type: "ready" });
})();
