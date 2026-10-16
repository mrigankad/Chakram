// Type-checks the API kit of the composer's golden app (backend/tests/golden/composed_app/api)
// with its own pinned dependencies, so a kit template change that does not compile fails CI.
import { cpSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const api = join(repo, "backend", "tests", "golden", "composed_app", "api");
if (!existsSync(api)) {
  console.error(`No golden API kit at ${api}; run the backend tests first.`);
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), "chakram-api-kit-"));
try {
  cpSync(api, work, { recursive: true });
  const install = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: work, stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status ?? 1);
  const check = spawnSync("npm", ["run", "typecheck"], { cwd: work, stdio: "inherit" });
  if (check.status !== 0) {
    console.error("API kit does not type-check.");
    process.exit(check.status ?? 1);
  }
  console.log("API kit type-checks with its pinned dependencies.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
