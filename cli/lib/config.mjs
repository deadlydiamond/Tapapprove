import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_RELAY = 'https://tapapprove-relay.tapapprove-relay.workers.dev';
export const DEFAULT_WAIT_SECONDS = 90;

export const configDir = () => join(homedir(), '.tapapprove');
const configPath = () => join(configDir(), 'config.json');

export function loadConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    return null;
  }
}

export function saveConfig(config) {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const temp = `${configPath()}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, configPath());
}

export function deleteConfig() {
  rmSync(configPath(), { force: true });
}

export function claudeSettingsPath({ scope = 'user', projectDir = process.cwd() } = {}) {
  if (scope === 'project') return join(projectDir, '.claude', 'settings.local.json');
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json');
}
