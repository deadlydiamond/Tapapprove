import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hookInstalled, installHook, uninstallHook } from '../lib/settings.mjs';

const COMMAND = '"/usr/bin/node" "/opt/tapapprove/bin/tapapprove.mjs" hook';

function tempSettings(initial) {
  const path = join(mkdtempSync(join(tmpdir(), 'tapapprove-settings-')), 'settings.json');
  if (initial !== undefined) writeFileSync(path, initial);
  return path;
}

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('creates the settings file when none exists', () => {
  const path = tempSettings();
  installHook(path, COMMAND);
  const [entry] = read(path).hooks.PermissionRequest;
  assert.equal(entry.matcher, '*');
  assert.equal(entry.hooks[0].command, COMMAND);
  assert.equal(entry.hooks[0].type, 'command');
});

test('sets a timeout above the wait so Claude Code does not kill the hook mid-wait', () => {
  const path = tempSettings();
  installHook(path, COMMAND, { waitSeconds: 90 });
  assert.ok(read(path).hooks.PermissionRequest[0].hooks[0].timeout > 90);
});

test('keeps every unrelated setting and hook', () => {
  const path = tempSettings(JSON.stringify({
    model: 'opus',
    permissions: { allow: ['Bash(ls)'] },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }],
      PermissionRequest: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'mine.sh' }] }],
    },
  }));
  installHook(path, COMMAND);
  const settings = read(path);
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.permissions.allow, ['Bash(ls)']);
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, 'guard.sh');
  assert.equal(settings.hooks.PermissionRequest.length, 2);
  assert.equal(settings.hooks.PermissionRequest[0].hooks[0].command, 'mine.sh');
});

test('installing twice leaves one entry and picks up the new command', () => {
  const path = tempSettings();
  installHook(path, COMMAND);
  installHook(path, '"/new/node" "/new/tapapprove.mjs" hook');
  const entries = read(path).hooks.PermissionRequest;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hooks[0].command, '"/new/node" "/new/tapapprove.mjs" hook');
});

test('refuses to touch a settings file it cannot parse', () => {
  const broken = '{ "model": "opus", // a comment\n }';
  const path = tempSettings(broken);
  assert.throws(() => installHook(path, COMMAND), /not valid JSON/);
  assert.equal(readFileSync(path, 'utf8'), broken);
});

test('backs up an existing file before the first change', () => {
  const original = JSON.stringify({ model: 'opus' });
  const path = tempSettings(original);
  installHook(path, COMMAND);
  const dir = join(path, '..');
  const backup = readdirSync(dir).find((name) => name.includes('.tapapprove-backup'));
  assert.ok(backup, 'expected a backup file');
  assert.equal(readFileSync(join(dir, backup), 'utf8'), original);
});

test('uninstall removes only the Tapapprove entry', () => {
  const path = tempSettings(JSON.stringify({
    model: 'opus',
    hooks: { PermissionRequest: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'mine.sh' }] }] },
  }));
  installHook(path, COMMAND);
  assert.equal(hookInstalled(path), true);
  uninstallHook(path);
  const settings = read(path);
  assert.equal(hookInstalled(path), false);
  assert.equal(settings.model, 'opus');
  assert.equal(settings.hooks.PermissionRequest[0].hooks[0].command, 'mine.sh');
});

test('uninstall drops an event key it emptied, so no stray config is left behind', () => {
  const path = tempSettings();
  installHook(path, COMMAND);
  uninstallHook(path);
  assert.equal(read(path).hooks, undefined);
});

test('uninstall on a missing file does nothing', () => {
  const path = tempSettings();
  uninstallHook(path);
  assert.equal(hookInstalled(path), false);
});
