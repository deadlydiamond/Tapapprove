// Edits Claude Code's settings file. It holds the user's own config, so this only
// ever adds or removes the Tapapprove entry and refuses a file it cannot parse.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_WAIT_SECONDS } from './config.mjs';

const EVENT = 'PermissionRequest';
// Claude Code should only cut the hook off after the hook's own wait has ended.
const TIMEOUT_MARGIN_SECONDS = 30;

const isOurs = (hook) => /tapapprove[^\s"']*["']?\s+hook\s*$/.test(hook?.command ?? '');

export function readSettings(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${path} is not valid JSON. Fix it and try again. Nothing was changed.`);
  }
}

function writeSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  const exists = existsSync(path);
  const backup = `${path}.tapapprove-backup`;
  if (exists && !existsSync(backup)) copyFileSync(path, backup);
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, exists ? { mode: statSync(path).mode } : undefined);
  renameSync(temp, path);
}

function withoutOurs(settings) {
  const hooks = { ...settings.hooks };
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries
      .map((entry) => ({ ...entry, hooks: (entry.hooks ?? []).filter((hook) => !isOurs(hook)) }))
      .filter((entry) => entry.hooks.length > 0);
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  const { hooks: _dropped, ...rest } = settings;
  return Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
}

export function installHook(path, command, { waitSeconds = DEFAULT_WAIT_SECONDS } = {}) {
  const settings = withoutOurs(readSettings(path) ?? {});
  const hooks = { ...settings.hooks };
  hooks[EVENT] = [
    ...(hooks[EVENT] ?? []),
    { matcher: '*', hooks: [{ type: 'command', command, timeout: waitSeconds + TIMEOUT_MARGIN_SECONDS }] },
  ];
  writeSettings(path, { ...settings, hooks });
}

export function uninstallHook(path) {
  const settings = readSettings(path);
  if (settings === null || !hookInstalled(path)) return;
  writeSettings(path, withoutOurs(settings));
}

export function hookInstalled(path) {
  try {
    const entries = Object.values(readSettings(path)?.hooks ?? {}).flat();
    return entries.some((entry) => (entry?.hooks ?? []).some(isOurs));
  } catch {
    return false;
  }
}
