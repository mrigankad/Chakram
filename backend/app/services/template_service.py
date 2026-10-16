"""
Template service fetches project templates from MongoDB.

The in-code template is a complete, buildable Vite + React + TypeScript + Tailwind
project. A template stored in MongoDB (collection `Templates`) overrides files of
the same path; files it does not define are filled in from the default so a
generated app always builds and deploys.
"""
import json
import logging
from typing import Dict
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import settings
from app.engines import kit

logger = logging.getLogger(__name__)

MONGO_URI = settings.MONGODB_URI
DB_NAME = settings.MONGODB_DB
COLLECTION_NAME = "Templates"
PROJECT_NAME = "REACT"
VERSION = "v1"

_template_client: AsyncIOMotorClient | None = None


def _get_template_db() -> AsyncIOMotorDatabase:
    global _template_client
    if _template_client is None:
        _template_client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return _template_client[DB_NAME]


# Packages the planner and generator prompts promise to generated code. The
# versions here are also what the in-app preview loads, so the preview and a
# real `npm install` see the same libraries.
TEMPLATE_DEPENDENCIES: Dict[str, str] = {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.30.1",
    "recharts": "^2.15.0",
    "lucide-react": "^0.462.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "framer-motion": "^11.15.0",
    "@tanstack/react-query": "^5.62.0",
    "date-fns": "^3.6.0",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-dropdown-menu": "^2.1.4",
    "@radix-ui/react-tabs": "^1.1.2",
    "@radix-ui/react-tooltip": "^1.1.6",
}

_PACKAGE_JSON_BASE: Dict[str, object] = {
    "name": "ai-generated-app",
    "private": True,
    "version": "0.1.0",
    "type": "module",
    "scripts": {"dev": "vite", "build": "vite build", "preview": "vite preview"},
    "dependencies": TEMPLATE_DEPENDENCIES,
    "devDependencies": {
        "@types/react": "^18.3.12",
        "@types/react-dom": "^18.3.1",
        "@vitejs/plugin-react": "^4.3.1",
        "tailwindcss": "^3.4.17",
        "autoprefixer": "^10.4.21",
        "postcss": "^8.5.6",
        "vite": "^5.4.19",
        "typescript": "^5.8.3",
    },
}

_BASE_TEMPLATE: Dict[str, str] = {
    "index.html": """\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Generated App</title>
    <!-- DESIGN_FONTS_START -->
    <!-- DESIGN_FONTS_END -->
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
""",
    "src/App.tsx": """\
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

// AUTO_IMPORTS_START
// AUTO_IMPORTS_END

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* AUTO_ROUTES_START */}
        {/* AUTO_ROUTES_END */}
        <Route
          path="*"
          element={
            <div className="flex items-center justify-center min-h-screen bg-gray-950 text-white">
              <div className="text-center space-y-3">
                <h1 className="text-4xl font-bold tracking-tight">Your App</h1>
                <p className="text-gray-400">Pages appear here as they are generated.</p>
              </div>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
""",
    "src/main.tsx": """\
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
""",
    "src/index.css": """\
@tailwind base;
@tailwind components;
@tailwind utilities;
""",
    "src/lib/utils.ts": """\
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
""",
    "src/vite-env.d.ts": """\
/// <reference types="vite/client" />
""",
    "vite.config.ts": """\
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
""",
    "tsconfig.json": """\
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": false,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
""",
    "tailwind.config.js": """\
import { readFileSync } from 'node:fs';

// design.json is written by the App Builder's design editor (colours, fonts, radius).
let design = {};
try {
  design = JSON.parse(readFileSync(new URL('./design.json', import.meta.url), 'utf8'));
} catch {
  design = {};
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: design?.tailwind?.theme?.extend ?? {},
  },
  plugins: [],
};
""",
    "design.json": """\
{
  "version": 1,
  "preset": "custom",
  "palette": {},
  "fonts": { "sans": "System", "display": "System" },
  "radius": 1,
  "tailwind": { "darkMode": "class", "theme": { "extend": {} } },
  "fontLinks": []
}
""",
    "postcss.config.js": """\
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
""",
    "vercel.json": """\
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
""",
    ".gitignore": """\
node_modules
dist
.env
.env.*
*.log
.DS_Store
""",
    # package.json is rendered from TEMPLATE_DEPENDENCIES below so the prompt,
    # the preview's pinned versions and the installed packages cannot drift.
}
_BASE_TEMPLATE["package.json"] = json.dumps(_PACKAGE_JSON_BASE, indent=2) + "\n"


# ── Chronos kit variant ──────────────────────────────────────────────────────
# With the kit, App.tsx wraps every route in the kit's AppShell; the generator
# fills the NAV, APP_NAME, imports and routes markers from the plan.
_KIT_APP_TSX = """\
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell, EmptyState } from './chronos';

// AUTO_IMPORTS_START
// AUTO_IMPORTS_END

type NavItem = { to: string; label: string; icon?: string };

// AUTO_NAV_START
const NAV: NavItem[] = [];
// AUTO_NAV_END

const APP_NAME = 'Your App'; // AUTO_APP_NAME

export default function App() {
  return (
    <BrowserRouter>
      <AppShell appName={APP_NAME} nav={NAV}>
        <Routes>
          {/* AUTO_ROUTES_START */}
          {/* AUTO_ROUTES_END */}
          <Route
            path="*"
            element={<EmptyState title="This page is being generated" detail="It appears here as soon as it is written." />}
          />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
"""

_KIT_INDEX_CSS = """\
@import './chronos/tokens.css';
@import './design.css';

@tailwind base;
@tailwind components;
@tailwind utilities;
"""

# Same merge as the live preview: the kit's theme, then the design editor's overrides.
_KIT_TAILWIND_CONFIG = """\
import { readFileSync } from 'node:fs';

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
  } catch {
    return {};
  }
}

function mergeDeep(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const key of Object.keys(b)) out[key] = mergeDeep(out[key], b[key]);
  return out;
}

const kitTheme = readJson('./src/chronos/theme.json');
// design.json is written by the App Builder's design editor (colours, fonts, radius).
const design = readJson('./design.json');

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: mergeDeep(kitTheme, design?.tailwind?.theme?.extend ?? {}),
  },
  plugins: [],
};
"""


def _base() -> Dict[str, str]:
    """The default template, with the Chronos kit when it is installed."""
    files = dict(_BASE_TEMPLATE)
    kit_files = kit.kit_files()
    if not kit_files:
        return files
    files.update(kit_files)
    files["src/App.tsx"] = _KIT_APP_TSX
    files["src/index.css"] = _KIT_INDEX_CSS
    files["tailwind.config.js"] = _KIT_TAILWIND_CONFIG
    # Theme overrides written by the design editor; loaded after the kit's tokens.
    files["src/design.css"] = "/* Theme overrides from the App Builder's Design tab. Empty means the Chronos defaults. */\n"
    return files


async def get_template(project_name: str = PROJECT_NAME, version: str = VERSION) -> Dict[str, str]:
    """
    Fetch template files from MongoDB.

    Args:
        project_name: Project type (e.g., "REACT")
        version: Template version (e.g., "v1")

    Returns:
        Dict mapping file paths to their contents. A stored template overrides
        the default file by file; the default supplies anything it leaves out.
        Falls back to the default template if the DB is unavailable or the
        template is not found.
    """
    try:
        db = _get_template_db()
        collection = db[COLLECTION_NAME]

        template_doc = await collection.find_one({
            "project_name": project_name,
            "version": version
        })

        if not template_doc:
            logger.warning(f"[Template] No template found for {project_name} {version}, using default")
            return _base()

        files: Dict[str, str] = {}

        if "files" in template_doc and isinstance(template_doc["files"], list):
            for file_entry in template_doc["files"]:
                path = file_entry.get("path")
                content = file_entry.get("content")
                if path and content:
                    files[path] = content

        if not files:
            logger.warning(f"[Template] Template {project_name} {version} has no files, using default")
            return _base()

        logger.info(f"[Template] Loaded template {project_name} {version} with {len(files)} files")
        return {**_base(), **files}

    except Exception as e:
        logger.error(f"[Template] Failed to fetch template from MongoDB: {e}")
        return _base()


def get_default_template() -> Dict[str, str]:
    """Return the in-memory default template."""
    return _base()
