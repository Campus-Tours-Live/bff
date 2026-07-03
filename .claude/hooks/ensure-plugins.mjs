#!/usr/bin/env node
/*
 * ensure-plugins.mjs — make sure THIS repo's Claude Code plugins are installed.
 *
 * Self-contained: reads this repo's own .claude/settings.json (extraKnownMarketplaces
 * + enabledPlugins), registers the marketplaces, and installs anything missing. It has
 * NO dependency on the sibling repos, so it works even when only this one repo is cloned.
 *
 * Modes:
 *   (default)   ensure — install any missing enabled plugins
 *   --check     report only — warn about missing plugins, install nothing (build/CI-safe)
 *
 * Safety: always exits 0 (never blocks a build). No-ops silently when the `claude` CLI is
 * absent (non-Claude users / CI) or when CI=1 is set. Installs run with a timeout and no
 * stdin, so they can never hang a session start; if an install can't complete it degrades
 * to a printed manual command.
 *
 * Requires Node 18+ (ships with the `claude` CLI, so if claude is present, node is too).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CHECK_ONLY = process.argv.includes('--check');
const here = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(here, '..', 'settings.json'); // <repo>/.claude/settings.json

function log(msg) {
  process.stderr.write(`[claude-plugins] ${msg}\n`);
}

// Never interfere with CI pipelines.
if (process.env.CI) process.exit(0);

function claude(args, opts = {}) {
  return execFileSync('claude', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    ...opts,
  });
}

// Read this repo's committed config.
let settings;
try {
  settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
} catch (err) {
  log(`could not read ${settingsPath}: ${err.message}`);
  process.exit(0);
}

const wanted = Object.entries(settings.enabledPlugins || {})
  .filter(([, on]) => on !== false)
  .map(([id]) => id); // "name@marketplace"
if (wanted.length === 0) process.exit(0);

// What's already installed? (This is also our probe for whether the CLI exists.)
let installed;
try {
  const list = JSON.parse(claude(['plugin', 'list', '--json']));
  installed = new Set(list.map((p) => p.id));
} catch (err) {
  if (err.code === 'ENOENT') process.exit(0); // no `claude` CLI → nothing to do, stay quiet
  log(`could not query installed plugins: ${err.message}`);
  process.exit(0);
}

const missing = wanted.filter((id) => !installed.has(id));
if (missing.length === 0) process.exit(0); // steady state: fast + silent

if (CHECK_ONLY) {
  log(`missing ${missing.length} plugin(s): ${missing.join(', ')}`);
  log('install them with:  node .claude/hooks/ensure-plugins.mjs');
  process.exit(0);
}

// Make sure the marketplaces are registered before installing (idempotent).
for (const def of Object.values(settings.extraKnownMarketplaces || {})) {
  const repo = def?.source?.repo;
  if (!repo) continue;
  try {
    claude(['plugin', 'marketplace', 'add', repo]);
  } catch {
    /* already added or offline — ignore */
  }
}

// Install the missing ones. stdin is ignored + a timeout is set, so this can't hang.
for (const id of missing) {
  try {
    log(`installing ${id} …`);
    claude(['plugin', 'install', id, '--scope', 'user'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 180_000,
    });
  } catch (err) {
    log(`could not install ${id}: ${err.message}`);
    log(`run manually:  claude plugin install ${id}`);
  }
}
process.exit(0);
