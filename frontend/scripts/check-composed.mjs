// Type-checks the composer's golden app (backend/tests/golden/composed_app) against the
// real Chronos kit with this project's TypeScript, so a composer or kit change that
// breaks a composed page fails CI even though the API container has no Node.
import { cpSync, mkdtempSync, writeFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const repo = resolve(frontend, "..");
const kit = join(repo, "backend", "app", "templates", "chronos_kit", "src", "chronos");
const golden = join(repo, "backend", "tests", "golden", "composed_app");

if (!existsSync(golden)) {
  console.error(`No golden app at ${golden}; run the backend tests first (tests/test_composer.py writes it).`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "chakram-composed-"));
try {
  cpSync(kit, join(work, "src", "chronos"), { recursive: true });
  cpSync(golden, work, { recursive: true });
  writeFileSync(join(work, "src", "vite-env.d.ts"), '/// <reference types="vite/client" />\n');
  writeFileSync(
    join(work, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noUnusedLocals: true,
          types: ["vite/client"],
        },
        include: ["src"],
      },
      null,
      2,
    ),
  );
  symlinkSync(join(frontend, "node_modules"), join(work, "node_modules"), "dir");
  const tsc = join(frontend, "node_modules", ".bin", "tsc");
  const result = spawnSync(tsc, ["-p", join(work, "tsconfig.json")], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("Composed app does not type-check against the kit.");
    process.exit(result.status ?? 1);
  }
  console.log("Composed golden app type-checks against the Chronos kit.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
