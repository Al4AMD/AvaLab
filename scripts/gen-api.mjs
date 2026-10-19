#!/usr/bin/env node
/**
 * Regenerate the API artifacts of record:
 *   1. apps/api/openapi.json        (exported from the FastAPI app)
 *   2. apps/web/src/api/schema.d.ts (openapi-typescript output)
 *
 * Invoked as `pnpm gen:api` from anywhere; every path resolves against the
 * repo root. Exits non-zero when either step fails. `uv run --directory`
 * changes the child process cwd, so absolute paths are passed to both tools.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const openapiJsonPath = resolve(repoRoot, "apps/api/openapi.json");
const schemaOutPath = resolve(repoRoot, "apps/web/src/api/schema.d.ts");

function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) {
    console.error(`gen:api: ${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`gen:api: ${label} exited with status ${result.status}`);
    process.exit(1);
  }
}

run("export_openapi", "uv", [
  "run",
  "--directory",
  "apps/api",
  "python",
  "-m",
  "avalab_api.export_openapi",
  "--out",
  openapiJsonPath,
]);

run("openapi-typescript", "pnpm", [
  "--filter",
  "@avalab/web",
  "exec",
  "openapi-typescript",
  openapiJsonPath,
  "-o",
  schemaOutPath,
]);

console.log(`gen:api: wrote ${openapiJsonPath} and ${schemaOutPath}`);
