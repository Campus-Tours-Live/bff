#!/usr/bin/env node
/*
 * ensure-plugins.mjs — keep THIS repo's Claude Code plugins installed and up to date.
 *
 * Self-contained: reads this repo's own .claude/settings.json (extraKnownMarketplaces
 * + enabledPlugins), registers the marketplaces, installs anything missing, and keeps the
 * enabled plugins updated to their latest version. NO dependency on the sibling repos, so it
 * works even when only this one repo is cloned.
 *
 * Keep-latest: updating every session would make each session start slow (a network call per
 * plugin) and updates need a reload/restart to apply, so the update pass is THROTTLED to at
 * most once per 24h (a marker file under ~/.claude). Installing a *missing* plugin still runs
 * every time. Use --force-update (npm run update:skills) to update now, ignoring the throttle.
 *
 * Modes / flags:
 *   (default)        install missing + (throttled) update to latest
 *   --check          report only — install/update nothing (build/CI-safe)
 *   --hook           SessionStart-hook mode — after changes, print a `reloadSkills` JSON to
 *                    stdout so new/updated skills load in the CURRENT session. stdout is
 *                    reserved for that JSON; child command output goes to stderr.
 *   --force-update   ignore the 24h throttle and update to latest now
 *
 * Safety: always exits 0 (never blocks a build). No-ops silently when the `claude` CLI is
 * absent (non-Claude users / CI) or when CI=1 is set. Child commands have timeouts and no
 * stdin, so they can never hang a session start.
 *
 * Requires Node 18+ (ships with the `claude` CLI, so if claude is present, node is too).
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const CHECK_ONLY = process.argv.includes("--check");
const HOOK = process.argv.includes("--hook");
const FORCE_UPDATE = process.argv.includes("--force-update");
const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000; // keep-latest throttle: update at most once/day
const here = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(here, "..", "settings.json"); // <repo>/.claude/settings.json
// Per-repo throttle marker (keyed by this repo's path) so each repo updates its OWN plugin
// set once/day, independent of which repo you opened first.
const markerKey = createHash("sha1").update(settingsPath).digest("hex").slice(0, 12);
const marker = join(homedir(), ".claude", `.ctl-plugins-updated-${markerKey}`);

// Logs always go to stderr — in --hook mode stdout is reserved for the reloadSkills JSON.
function log(msg) {
  process.stderr.write(`[claude-plugins] ${msg}\n`);
}

// Never interfere with CI pipelines.
if (process.env.CI) process.exit(0);

function claude(args, opts = {}) {
  return execFileSync("claude", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    ...opts,
  });
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

// What's already installed? (Also our probe for whether the CLI exists.) Keep each entry so
// we know its scope (user vs project) — updates must target the scope the plugin lives at.
let byId;
try {
  const list = JSON.parse(claude(["plugin", "list", "--json"]));
  byId = new Map(list.map((p) => [p.id, p]));
} catch (err) {
  if (err.code === "ENOENT") process.exit(0); // no `claude` CLI → nothing to do, stay quiet
  log(`could not query installed plugins: ${err.message}`);
  process.exit(0);
}

const missing = wanted.filter((id) => !byId.has(id));

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

// Steady state: nothing missing and no update due → fast + silent.
if (missing.length === 0 && !updateDue) process.exit(0);

if (CHECK_ONLY) {
  if (missing.length) {
    log(`missing ${missing.length} plugin(s): ${missing.join(", ")}`);
    log("install them with:  node .claude/hooks/ensure-plugins.mjs");
  }
  process.exit(0);
}

// Make sure the marketplaces are registered (needed for install AND update).
for (const def of Object.values(settings.extraKnownMarketplaces || {})) {
  const repo = def?.source?.repo;
  if (!repo) continue;
  try {
    claude(["plugin", "marketplace", "add", repo]);
  } catch {
    /* already added or offline — ignore */
  }
}

// In --hook mode, send child stdout to OUR stderr (fd 2) so stdout stays clean for the
// reloadSkills JSON; otherwise inherit it so `npm run dev` etc. show progress.
const childOut = HOOK ? 2 : "inherit";
let changed = 0;

// Install the missing ones (latest by default). stdin ignored + timeout, so it can't hang.
for (const id of missing) {
  try {
    log(`installing ${id} …`);
    claude(["plugin", "install", id, "--scope", "user"], {
      stdio: ["ignore", childOut, "inherit"],
      timeout: 180_000,
    });
    changed++;
  } catch (err) {
    log(`could not install ${id}: ${err.message}`);
    log(`run manually:  claude plugin install ${id}`);
  }
}

// Keep-latest: refresh marketplaces, then update each already-installed enabled plugin to the
// newest version at its own scope. Output is captured so we can tell what actually changed.
if (updateDue) {
  try {
    claude(["plugin", "marketplace", "update"], { timeout: 120_000 });
  } catch {
    /* offline / transient — ignore */
  }
  for (const id of wanted) {
    const p = byId.get(id);
    if (!p) continue; // was missing → already installed at latest above
    try {
      const out = claude(["plugin", "update", id, "--scope", p.scope || "user"], {
        timeout: 120_000,
      });
      if (/updated from/i.test(out)) {
        changed++;
        log(`updated ${id}`);
      }
    } catch {
      /* best-effort — a single plugin failing to update must not break the pass */
    }
  }
  try {
    writeFileSync(marker, String(Date.now())); // stamp the throttle
  } catch {
    /* ignore */
  }
}

// If anything changed, make it usable now.
if (changed > 0) {
  if (HOOK) {
    // SessionStart hook: re-scan skills after the hook finishes so new/updated skills load in
    // THIS session rather than only the next one. Must be the only thing on stdout.
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", reloadSkills: true },
      }) + "\n",
    );
  } else {
    // Outside a Claude session (predev / launcher / manual): we can't reload a running session
    // from here, so point the user at the command that picks up the changes.
    log(
      `applied ${changed} change(s). If a Claude session is open, run  /reload-plugins  (or restart) to use them now.`,
    );
  }
}
process.exit(0);
