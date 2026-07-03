#!/usr/bin/env node
/*
 * ensure-plugins.mjs — keep THIS repo's agent skills installed and up to date, for BOTH
 * Claude Code and Codex.
 *
 * Self-contained: reads this repo's own .claude/settings.json (extraKnownMarketplaces +
 * enabledPlugins) and, for whichever agent CLIs are present (`claude` and/or `codex`),
 * registers the marketplaces, installs any missing enabled plugin, and keeps them updated.
 * The same plugin ids work for both agents (the wshobson/agents marketplace ships dual
 * `.claude-plugin` + `.codex-plugin` manifests); a plugin a given agent doesn't expose is
 * skipped, not retried. NO dependency on the sibling repos.
 *
 * Keep-latest is THROTTLED to once per 24h per repo (marker under ~/.claude) so session start
 * stays fast; installing a *missing* plugin still runs every time. --force-update ignores it.
 *
 * Flags: --check (report only), --hook (Claude SessionStart: emit reloadSkills on stdout so
 * new Claude skills load in the current session), --force-update (update now).
 *
 * Safety: always exits 0; no-ops when neither CLI is present or CI=1; child commands have
 * timeouts and no stdin so they can't hang a session start.
 * Requires Node 18+.
 */

import { readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const CHECK_ONLY = process.argv.includes("--check");
const HOOK = process.argv.includes("--hook");
const FORCE_UPDATE = process.argv.includes("--force-update");
const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000; // keep-latest throttle: at most once/day per repo

const here = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(here, "..", "settings.json"); // <repo>/.claude/settings.json
const markerKey = createHash("sha1").update(settingsPath).digest("hex").slice(0, 12);
const marker = join(homedir(), ".claude", `.ctl-plugins-updated-${markerKey}`);

// Logs go to stderr — in --hook mode stdout is reserved for the reloadSkills JSON.
function log(msg) {
  process.stderr.write(`[agent-plugins] ${msg}\n`);
}

if (process.env.CI) process.exit(0);

function run(bin, args, opts = {}) {
  return execFileSync(bin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    ...opts,
  });
}

// Resolve an agent CLI: prefer PATH, then known install locations (e.g. the macOS Codex app).
function resolveBin(name, fallbacks = []) {
  try {
    run(name, ["--version"]);
    return name;
  } catch {
    /* not on PATH */
  }
  for (const f of fallbacks) {
    try {
      if (existsSync(f)) {
        run(f, ["--version"]);
        return f;
      }
    } catch {
      /* present but not runnable */
    }
  }
  return null;
}

// Read this repo's committed config.
let settings;
try {
  settings = JSON.parse(readFileSync(settingsPath, "utf8"));
} catch (err) {
  log(`could not read ${settingsPath}: ${err.message}`);
  process.exit(0);
}
const wanted = Object.entries(settings.enabledPlugins || {})
  .filter(([, on]) => on !== false)
  .map(([id]) => id); // "name@marketplace"
if (wanted.length === 0) process.exit(0);
const marketplaceRepos = Object.values(settings.extraKnownMarketplaces || {})
  .map((d) => d?.source?.repo)
  .filter(Boolean);

const CLAUDE = resolveBin("claude");
const CODEX = resolveBin("codex", ["/Applications/Codex.app/Contents/Resources/codex"]);
if (!CLAUDE && !CODEX) process.exit(0);

// Is a keep-latest update pass due? Throttled to once/24h unless forced. Never in --check.
const updateDue =
  !CHECK_ONLY &&
  (FORCE_UPDATE ||
    (() => {
      try {
        return Date.now() - statSync(marker).mtimeMs > UPDATE_EVERY_MS;
      } catch {
        return true; // no marker yet → due
      }
    })());

// In --hook mode, child stdout → OUR stderr (fd 2) so stdout stays clean for the JSON.
const childOut = HOOK ? 2 : "inherit";

// ---- Claude Code ----
function ensureClaude(bin) {
  let byId;
  try {
    byId = new Map(JSON.parse(run(bin, ["plugin", "list", "--json"])).map((p) => [p.id, p]));
  } catch (err) {
    log(`[claude] could not query plugins: ${err.message}`);
    return 0;
  }
  const missing = wanted.filter((id) => !byId.has(id));
  if (missing.length === 0 && !updateDue) return 0;
  if (CHECK_ONLY) {
    if (missing.length) log(`[claude] missing ${missing.length}: ${missing.join(", ")}`);
    return 0;
  }
  for (const repo of marketplaceRepos) {
    try {
      run(bin, ["plugin", "marketplace", "add", repo]);
    } catch {
      /* already added / offline */
    }
  }
  let changed = 0;
  for (const id of missing) {
    try {
      log(`[claude] installing ${id} …`);
      run(bin, ["plugin", "install", id, "--scope", "user"], {
        stdio: ["ignore", childOut, "inherit"],
        timeout: 180_000,
      });
      changed++;
    } catch (err) {
      log(`[claude] could not install ${id}: ${err.message}`);
    }
  }
  if (updateDue) {
    try {
      run(bin, ["plugin", "marketplace", "update"], { timeout: 120_000 });
    } catch {
      /* ignore */
    }
    for (const id of wanted) {
      const p = byId.get(id);
      if (!p) continue;
      try {
        const out = run(bin, ["plugin", "update", id, "--scope", p.scope || "user"], {
          timeout: 120_000,
        });
        if (/updated from/i.test(out)) {
          changed++;
          log(`[claude] updated ${id}`);
        }
      } catch {
        /* best-effort */
      }
    }
  }
  return changed;
}

// ---- Codex ----
function ensureCodex(bin) {
  let listText;
  try {
    listText = run(bin, ["plugin", "list"], { timeout: 60_000 });
  } catch {
    return 0;
  }
  // `codex plugin list` is a table listing every plugin from configured marketplaces:
  // `<id>  <status> …` where status is "installed, enabled" or "not installed". Build the set
  // of ids Codex KNOWS (so we don't repeatedly try to add plugins Codex doesn't expose) and
  // the set already installed.
  const known = new Set();
  const installed = new Set();
  for (const line of listText.split("\n")) {
    const m = line.trim().match(/^(\S+@\S+)\b/);
    if (!m) continue;
    known.add(m[1]);
    if (!/not installed/.test(line)) installed.add(m[1]);
  }
  const missing = wanted.filter((id) => known.has(id) && !installed.has(id));
  if (missing.length === 0 && !updateDue) return 0;
  if (CHECK_ONLY) {
    if (missing.length) log(`[codex] missing ${missing.length}: ${missing.join(", ")}`);
    return 0;
  }
  for (const repo of marketplaceRepos) {
    try {
      run(bin, ["plugin", "marketplace", "add", repo], { timeout: 120_000 });
    } catch {
      /* already added / offline */
    }
  }
  let changed = 0;
  for (const id of missing) {
    try {
      log(`[codex] installing ${id} …`);
      run(bin, ["plugin", "add", id], { stdio: ["ignore", childOut, "inherit"], timeout: 180_000 });
      changed++;
    } catch {
      /* not in Codex's snapshot for this id — skip */
    }
  }
  if (updateDue) {
    try {
      run(bin, ["plugin", "marketplace", "upgrade"], { timeout: 120_000 });
    } catch {
      /* ignore */
    }
  }
  return changed;
}

let changedClaude = 0;
let changedCodex = 0;
if (CLAUDE) changedClaude = ensureClaude(CLAUDE);
if (CODEX) changedCodex = ensureCodex(CODEX);

if (updateDue && !CHECK_ONLY) {
  try {
    writeFileSync(marker, String(Date.now())); // stamp the throttle
  } catch {
    /* ignore */
  }
}

if (CHECK_ONLY) process.exit(0);

if (HOOK) {
  // Claude SessionStart: re-scan skills so newly-installed Claude skills load in THIS session.
  // (Codex isn't the agent running this hook, so its changes don't need a Claude reload.)
  if (changedClaude > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", reloadSkills: true },
      }) + "\n",
    );
  }
} else if (changedClaude + changedCodex > 0) {
  log(
    `applied ${changedClaude + changedCodex} change(s). If a Claude/Codex session is open, run  /reload-plugins  (or restart) to use them now.`,
  );
}
process.exit(0);
