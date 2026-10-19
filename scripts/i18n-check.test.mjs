/**
 * Self-tests for scripts/i18n-check.mjs (plan T11).
 *
 * Every case builds a throwaway tree under the OS temp dir — never the repo:
 *   <root>/locales/{fa,en}.json, <root>/src/**, <root>/allow.json
 * and runs the checker against it. Cleanup is registered per test.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { checkI18n } from "./i18n-check.mjs";

const CHECKER_PATH = fileURLToPath(new URL("./i18n-check.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "avalab-i18n-check-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "locales"), { recursive: true });
  return {
    writeLocale(locale, data) {
      writeFileSync(join(root, "locales", `${locale}.json`), JSON.stringify(data, null, 2));
    },
    writeRawLocale(locale, text) {
      writeFileSync(join(root, "locales", `${locale}.json`), text);
    },
    writeSource(relativePath, contents) {
      const filePath = join(root, "src", relativePath);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, contents);
    },
    writeAllowlist(entries) {
      writeFileSync(join(root, "allow.json"), JSON.stringify(entries));
    },
    check() {
      return checkI18n({
        root,
        localesDir: "locales",
        sourcesGlob: "src/**/*.{ts,tsx}",
        dynamicAllowlistPath: "allow.json",
      });
    },
    runCli() {
      return spawnSync(
        process.execPath,
        [
          CHECKER_PATH,
          "--root",
          root,
          "--locales-dir",
          "locales",
          "--sources-glob",
          "src/**/*.{ts,tsx}",
          "--allowlist",
          "allow.json",
        ],
        { encoding: "utf8" },
      );
    },
  };
}

test("clean tree passes (nested sources, double-quoted literals)", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", { app: { title: "آوالب" } });
  fixture.writeLocale("en", { app: { title: "AvaLab" } });
  fixture.writeAllowlist([]);
  fixture.writeSource("App.tsx", `const label = t("app.title");\n`);
  fixture.writeSource("components/ui/Nested.ts", `export const name = t("app.title");\n`);
  assert.deepEqual(fixture.check(), []);
});

test("single-quoted t('key') literal counts as usage", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", { app: { title: "آوالب" } });
  fixture.writeLocale("en", { app: { title: "AvaLab" } });
  fixture.writeAllowlist([]);
  fixture.writeSource("App.tsx", `const label = t('app.title');\n`);
  assert.deepEqual(fixture.check(), []);
});

test("parity gap fails with parity-gap and unused findings", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", { app: { title: "آوالب", extra: "زائد" } });
  fixture.writeLocale("en", { app: { title: "AvaLab" } });
  fixture.writeAllowlist([]);
  fixture.writeSource("App.tsx", `const label = t("app.title");\n`);
  assert.deepEqual(fixture.check(), [
    { file: "locales/en.json", key: "app.extra", reason: "parity-gap" },
    { file: "locales/fa.json", key: "app.extra", reason: "unused" },
  ]);
});

test("literal key missing from both locales fails", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", { app: { title: "آوالب" } });
  fixture.writeLocale("en", { app: { title: "AvaLab" } });
  fixture.writeAllowlist([]);
  fixture.writeSource("App.tsx", `const a = t("app.title");\nconst b = t("app.missing");\n`);
  assert.deepEqual(fixture.check(), [
    { file: "src/App.tsx", key: "app.missing", reason: "missing-in-locales" },
  ]);
});

test("unused key in both locales fails", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", { app: { title: "آوالب", stale: "کهنه" } });
  fixture.writeLocale("en", { app: { title: "AvaLab", stale: "stale" } });
  fixture.writeAllowlist([]);
  fixture.writeSource("App.tsx", `const label = t("app.title");\n`);
  assert.deepEqual(fixture.check(), [
    { file: "locales/fa.json", key: "app.stale", reason: "unused" },
  ]);
});

test("unused key under an allowlisted namespace prefix passes", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", { app: { title: "آوالب", health: { loading: "…", ok: "…" } } });
  fixture.writeLocale("en", { app: { title: "AvaLab", health: { loading: "…", ok: "…" } } });
  fixture.writeAllowlist(["app.health"]);
  fixture.writeSource("App.tsx", `const label = t("app.title");\n`);
  assert.deepEqual(fixture.check(), []);
});

test("key present in both locales and used in code passes (brief's en-literal case, parity reading)", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", { app: { title: "آوالب" } });
  fixture.writeLocale("en", { app: { title: "AvaLab" } });
  fixture.writeAllowlist([]);
  fixture.writeSource("App.tsx", `const label = t("app.title");\n`);
  assert.deepEqual(fixture.check(), []);
});

test("key present only in en.json fails parity even when used in code", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", {});
  fixture.writeLocale("en", { app: { title: "AvaLab" } });
  fixture.writeAllowlist([]);
  fixture.writeSource("App.tsx", `const label = t("app.title");\n`);
  assert.deepEqual(fixture.check(), [
    { file: "locales/fa.json", key: "app.title", reason: "parity-gap" },
    { file: "src/App.tsx", key: "app.title", reason: "missing-in-fa" },
  ]);
});

test("dynamic t(variable) is not a literal usage: fails as unused unless allowlisted", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", { app: { health: { loading: "…" } } });
  fixture.writeLocale("en", { app: { health: { loading: "…" } } });
  fixture.writeAllowlist([]);
  fixture.writeSource(
    "Health.tsx",
    `const labelKey = "app.health.loading";\nreturn t(labelKey);\n`,
  );
  assert.deepEqual(fixture.check(), [
    { file: "locales/fa.json", key: "app.health.loading", reason: "unused" },
  ]);
  fixture.writeAllowlist(["app.health.loading"]);
  assert.deepEqual(fixture.check(), []);
});

test("malformed locale JSON throws with a clear message", (t) => {
  const fixture = createFixture(t);
  fixture.writeRawLocale("fa", "{ not valid json");
  fixture.writeLocale("en", {});
  fixture.writeAllowlist([]);
  assert.throws(() => fixture.check(), /i18n-check: failed to parse locale file .*fa\.json/);
});

test("CLI exits 0 with an OK line on a clean tree", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", { app: { title: "آوالب" } });
  fixture.writeLocale("en", { app: { title: "AvaLab" } });
  fixture.writeAllowlist([]);
  fixture.writeSource("App.tsx", `const label = t("app.title");\n`);
  const result = fixture.runCli();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /i18n-check: OK/);
});

test("CLI exits 1 and prints one finding per line when the tree fails", (t) => {
  const fixture = createFixture(t);
  fixture.writeLocale("fa", { app: { title: "آوالب", stale: "کهنه" } });
  fixture.writeLocale("en", { app: { title: "AvaLab", stale: "stale" } });
  fixture.writeAllowlist([]);
  fixture.writeSource("App.tsx", `const label = t("app.title");\n`);
  const result = fixture.runCli();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /locales\/fa\.json: app\.stale: unused/);
  assert.match(result.stderr, /i18n-check: 1 finding/);
});

test("CLI exits 2 on unusable input (malformed locale)", (t) => {
  const fixture = createFixture(t);
  fixture.writeRawLocale("fa", "{ not valid json");
  fixture.writeLocale("en", {});
  fixture.writeAllowlist([]);
  const result = fixture.runCli();
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /i18n-check: failed to parse locale file .*fa\.json/);
});
