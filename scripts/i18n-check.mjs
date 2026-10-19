#!/usr/bin/env node
/**
 * i18n key checker for the web app (AGENTS.md §6, plan T11).
 *
 * Verifies that:
 *   1. `fa.json` and `en.json` carry exactly the same key set (nested
 *      objects flattened to dot paths, the form i18next uses at runtime);
 *   2. every literal `t("key")` / `t('key')` call under the sources glob
 *      resolves in both locale files;
 *   3. every locale key is either used by that literal scan or covered by
 *      a namespace prefix in the dynamic allowlist — the escape hatch for
 *      keys reached through `t(variable)` (e.g. a key chosen by a state
 *      machine), which a static scan cannot see.
 *
 * `checkI18n({root, localesDir, sourcesGlob, dynamicAllowlistPath})` returns
 * an array of `{file, key, reason}` findings (paths relative to `root`) and
 * never throws on findings. It throws only when an input is unusable:
 * missing/unreadable/malformed locale or allowlist file, or a sources glob
 * whose base directory does not exist (a silent zero-file scan would
 * false-green).
 *
 * CLI mode (when this module is the process entry point; optional flags
 * `--root`, `--locales-dir`, `--sources-glob`, `--allowlist`):
 * one finding per line, exit 1 on any finding, 0 when clean, 2 on a throw.
 *
 * Dependency-free on purpose: must run with bare `node` in any environment.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const LOCALES = ["fa", "en"];
const EXIT_FINDINGS = 1;
const EXIT_UNUSABLE = 2;

/** Literal `t("key")` / `t('key')` calls; `t(variable)` and `i18n.t(...)` are not scanned. */
const LITERAL_T_CALL = /(?<![\w$.])t\(\s*(["'])([^"'\\]+)\1/g;

export function checkI18n({ root = process.cwd(), localesDir, sourcesGlob, dynamicAllowlistPath }) {
  const rootDir = resolve(root);
  const allowlist = readAllowlist(resolve(rootDir, dynamicAllowlistPath));

  const keysByLocale = new Map();
  for (const locale of LOCALES) {
    const filePath = resolve(rootDir, localesDir, `${locale}.json`);
    const data = readJson(filePath, "locale");
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error(`i18n-check: locale file ${filePath} must contain a JSON object`);
    }
    keysByLocale.set(locale, new Set(flattenKeys(data)));
  }

  const findings = [];
  const faKeys = keysByLocale.get("fa");
  const enKeys = keysByLocale.get("en");

  for (const key of faKeys) {
    if (!enKeys.has(key)) {
      findings.push(toFinding(rootDir, resolve(rootDir, localesDir, "en.json"), key, "parity-gap"));
    }
  }
  for (const key of enKeys) {
    if (!faKeys.has(key)) {
      findings.push(toFinding(rootDir, resolve(rootDir, localesDir, "fa.json"), key, "parity-gap"));
    }
  }

  const literalKeys = new Set();
  for (const filePath of listSourceFiles(rootDir, sourcesGlob)) {
    for (const key of literalTKeys(readFileSync(filePath, "utf8"))) {
      literalKeys.add(key);
      const missingLocales = LOCALES.filter((locale) => !keysByLocale.get(locale).has(key));
      if (missingLocales.length > 0) {
        const reason =
          missingLocales.length === LOCALES.length
            ? "missing-in-locales"
            : `missing-in-${missingLocales[0]}`;
        findings.push(toFinding(rootDir, filePath, key, reason));
      }
    }
  }

  for (const key of new Set([...faKeys, ...enKeys])) {
    if (literalKeys.has(key) || isDynamicKey(key, allowlist)) {
      continue;
    }
    const localeFile = faKeys.has(key) ? "fa.json" : "en.json";
    findings.push(toFinding(rootDir, resolve(rootDir, localesDir, localeFile), key, "unused"));
  }

  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.key.localeCompare(b.key) ||
      a.reason.localeCompare(b.reason),
  );
  return findings;
}

function readJson(filePath, label) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`i18n-check: cannot read ${label} file ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`i18n-check: failed to parse ${label} file ${filePath}: ${error.message}`);
  }
}

function readAllowlist(filePath) {
  const entries = readJson(filePath, "allowlist");
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
    throw new Error(`i18n-check: allowlist file ${filePath} must be a JSON array of strings`);
  }
  return entries;
}

/** Flatten nested i18next resources into dot paths; arrays and primitives are leaves. */
function flattenKeys(value, prefix = "") {
  const keys = [];
  for (const [name, child] of Object.entries(value)) {
    const path = prefix === "" ? name : `${prefix}.${name}`;
    if (typeof child === "object" && child !== null && !Array.isArray(child)) {
      keys.push(...flattenKeys(child, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

/** Segment-aware prefix match: `app.health` covers `app.health.ok`, not `app.healthcare`. */
function isDynamicKey(key, prefixes) {
  return prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`));
}

function literalTKeys(sourceText) {
  const keys = new Set();
  for (const match of sourceText.matchAll(LITERAL_T_CALL)) {
    keys.add(match[2]);
  }
  return keys;
}

function listSourceFiles(rootDir, sourcesGlob) {
  const baseDir = resolve(rootDir, fixedGlobPrefix(sourcesGlob));
  let stats;
  try {
    stats = statSync(baseDir);
  } catch {
    throw new Error(
      `i18n-check: sources base directory not found: ${baseDir} (glob "${sourcesGlob}")`,
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(`i18n-check: sources base path is not a directory: ${baseDir}`);
  }
  const matcher = globToRegExp(sourcesGlob);
  const files = [];
  for (const filePath of walkFiles(baseDir)) {
    if (matcher.test(relativeToRoot(rootDir, filePath))) {
      files.push(filePath);
    }
  }
  return files.sort();
}

/** Longest wildcard-free leading path of a glob, e.g. `src/**\/*.ts` → `src`. */
function fixedGlobPrefix(glob) {
  const segments = [];
  for (const segment of glob.split("/")) {
    if (segment === "" || /[*?{]/.test(segment)) {
      break;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function globToRegExp(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          pattern += "(?:[^/]+/)*";
        } else {
          pattern += ".*";
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else if (char === "{") {
      const end = glob.indexOf("}", index);
      if (end === -1) {
        throw new Error(`i18n-check: unbalanced "{" in sources glob "${glob}"`);
      }
      const alternatives = glob
        .slice(index + 1, end)
        .split(",")
        .map((alternative) => escapeRegExp(alternative));
      pattern += `(?:${alternatives.join("|")})`;
      index = end;
    } else {
      pattern += escapeRegExp(char);
    }
  }
  return new RegExp(`^${pattern}$`);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relativeToRoot(rootDir, filePath) {
  return relative(rootDir, filePath).split(sep).join("/");
}

function toFinding(rootDir, filePath, key, reason) {
  return { file: relativeToRoot(rootDir, filePath), key, reason };
}

const CLI_FLAGS = new Map([
  ["--root", "root"],
  ["--locales-dir", "localesDir"],
  ["--sources-glob", "sourcesGlob"],
  ["--allowlist", "dynamicAllowlistPath"],
]);

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const name = CLI_FLAGS.get(flag);
    if (name === undefined) {
      throw new Error(
        `i18n-check: unknown argument "${flag}" (expected ${[...CLI_FLAGS.keys()].join(", ")})`,
      );
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`i18n-check: missing value for ${flag}`);
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function isCliEntry() {
  return (
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isCliEntry()) {
  try {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const options = parseCliArgs(process.argv.slice(2));
    const findings = checkI18n({
      root: options.root ?? repoRoot,
      localesDir: options.localesDir ?? "apps/web/src/i18n",
      sourcesGlob: options.sourcesGlob ?? "apps/web/src/**/*.{ts,tsx}",
      dynamicAllowlistPath: options.dynamicAllowlistPath ?? "scripts/i18n-dynamic-keys.json",
    });
    for (const { file, key, reason } of findings) {
      console.log(`${file}: ${key}: ${reason}`);
    }
    if (findings.length > 0) {
      console.error(`i18n-check: ${findings.length} finding(s)`);
      process.exit(EXIT_FINDINGS);
    }
    console.log("i18n-check: OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : `i18n-check: ${String(error)}`);
    process.exit(EXIT_UNUSABLE);
  }
}
