#!/usr/bin/env node
import { cpSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { claudeSettingsPath, configDir, DEFAULT_RELAY, DEFAULT_WAIT_SECONDS, deleteConfig, loadConfig, saveConfig } from '../lib/config.mjs';
import { describeTool, MAX_DETAIL } from '../lib/describe.mjs';
import { runHook } from '../lib/hook.mjs';
import { relayClient, waitForDecision } from '../lib/relay.mjs';
import { hookInstalled, installHook, readSettings, uninstallHook } from '../lib/settings.mjs';

const USAGE = `Usage: tapapprove <command>

  pair <code>   Link this computer to the code shown on your watch
                  --relay <url>        Relay to use
                  --name <name>        Name shown for this computer
                  --wait <seconds>     How long to wait for the watch (default ${DEFAULT_WAIT_SECONDS})
                  --scope user|project Where to install the hook (default user)
                  --project-dir <dir>  Project for --scope project (default current folder)
  test          Send a test request to your watch
                  --tool <name>        Tool name to show (default Bash)
                  --command <text>     Command to show
                  --timeout <seconds>  How long to wait (default 60)
                  --session-label <text>  Also offer this "for this session" answer
  status        Show the pairing, the relay and the hook
  unpair        Remove the pairing and the hook
`;

const OPTIONS = {
  relay: { type: 'string' },
  name: { type: 'string' },
  wait: { type: 'string' },
  scope: { type: 'string' },
  'project-dir': { type: 'string' },
  tool: { type: 'string' },
  command: { type: 'string' },
  timeout: { type: 'string' },
  'session-label': { type: 'string' },
};

class UsageError extends Error {}

function positiveSeconds(value, flag, fallback) {
  if (value === undefined) return fallback;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1) throw new UsageError(`${flag} must be a whole number of seconds`);
  return seconds;
}

function requireConfig() {
  const config = loadConfig();
  if (!config) throw new Error('This computer is not paired yet. Run: tapapprove pair <code>');
  return config;
}

const privateCopyDir = () => join(configDir(), 'app');

/**
 * The hook decides what runs on this computer, so it runs a private copy of the CLI. Run
 * through npx, it would prefer a tapapprove in the project's node_modules, which anything
 * able to write to the project could plant.
 */
function installPrivateCopy() {
  const source = fileURLToPath(new URL('..', import.meta.url));
  const target = privateCopyDir();
  mkdirSync(target, { recursive: true, mode: 0o700 });
  if (realpathSync(source) !== realpathSync(target)) {
    for (const item of ['bin', 'lib', 'package.json']) {
      rmSync(join(target, item), { recursive: true, force: true });
      cpSync(join(source, item), join(target, item), { recursive: true });
    }
  }
  // GUI-launched editors often lack the shell PATH, so name node by absolute path.
  return `"${process.execPath}" "${join(target, 'bin', 'tapapprove.mjs')}" hook`;
}

async function pair(code, values) {
  if (!code) throw new UsageError('Missing code: tapapprove pair <code>');
  const scope = values.scope ?? 'user';
  if (scope !== 'user' && scope !== 'project') throw new UsageError('--scope must be user or project');
  const waitSeconds = positiveSeconds(values.wait, '--wait', DEFAULT_WAIT_SECONDS);
  const relay = (values.relay ?? loadConfig()?.relay ?? DEFAULT_RELAY).replace(/\/+$/, '');
  const settingsPath = claudeSettingsPath({ scope, projectDir: values['project-dir'] });

  // Check this before claiming, because a claim uses up the code.
  readSettings(settingsPath);

  let cliToken;
  try {
    ({ cliToken } = await relayClient(relay).claim(code.toUpperCase().replace(/[^A-Z0-9]/g, ''), values.name ?? hostname()));
  } catch (error) {
    if (error.status === 404) throw new Error('That code is wrong or has expired. Get a new code from your watch.');
    throw error;
  }

  installHook(settingsPath, installPrivateCopy(), { waitSeconds });
  saveConfig({ relay, token: cliToken, waitSeconds, settingsPath });
  console.log(`Paired with your watch.\nHook installed in ${settingsPath}\nTry it: tapapprove test`);
}

async function test(values) {
  const config = requireConfig();
  const timeout = positiveSeconds(values.timeout, '--timeout', 60);
  const tool = values.tool ?? 'Bash';
  const summary = describeTool(tool, { command: values.command ?? 'echo "Hello from Tapapprove"' });
  const label = values['session-label'];
  if (summary.truncated) {
    console.log(`Too long for the watch (over ${MAX_DETAIL} characters). Claude Code's dialog decides a request like this.`);
    return 2;
  }
  const client = relayClient(config.relay, config.token);
  const { id, pushed } = await client.createRequest({
    tool,
    ...summary,
    options: label ? [label] : [],
    project: 'tapapprove test',
    ttlSeconds: timeout,
  });
  console.log(pushed ? 'Sent. Check your watch.' : 'Sent without a push, so open Tapapprove on your watch.');

  const { status, option, message } = await waitForDecision(client, id, timeout);
  if (status === 'allow') {
    console.log(option === 0 ? 'Approved on the watch for this session.' : 'Approved on the watch.');
    return 0;
  }
  if (status === 'deny') {
    console.log(message ? `Denied on the watch. It said: ${message}` : 'Denied on the watch.');
    return 1;
  }
  if (status === 'timeout') await client.cancel(id).catch(() => {});
  console.log(`No answer from the watch (${status}).`);
  return 2;
}

function ago(timestamp) {
  if (!timestamp) return 'never';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  return seconds < 90 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
}

async function status() {
  const config = requireConfig();
  const settingsPath = config.settingsPath ?? claudeSettingsPath();
  console.log(`Relay:      ${config.relay}`);
  console.log(`Hook:       ${hookInstalled(settingsPath) ? `installed in ${settingsPath}` : 'not installed'}`);
  let state;
  try {
    state = await relayClient(config.relay, config.token).status();
  } catch (error) {
    if (error.status === 401) {
      console.log('Paired:     no, the pairing was revoked. Run: tapapprove pair <code>');
      return 1;
    }
    throw error;
  }
  console.log(`Paired:     ${state.paired ? 'yes' : 'no'}`);
  console.log(`Watch seen: ${ago(state.lastWatchSeenAt)}`);
  console.log(`Push:       ${state.hasPushToken ? 'registered' : 'not registered'}`);
  console.log(`Pending:    ${state.pending}`);
  return 0;
}

async function unpair() {
  const config = loadConfig();
  if (config) await relayClient(config.relay, config.token).revoke().catch(() => {});
  uninstallHook(config?.settingsPath ?? claudeSettingsPath());
  deleteConfig();
  rmSync(privateCopyDir(), { recursive: true, force: true });
  console.log('Unpaired. The hook is removed.');
}

function readStdin() {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { text += chunk; });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', () => resolve(text));
  });
}

async function main() {
  const { values, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true });
  const [command, argument] = positionals;
  switch (command) {
    case 'pair':
      await pair(argument, values);
      return 0;
    case 'test':
      return test(values);
    case 'status':
      return status();
    case 'unpair':
      await unpair();
      return 0;
    case 'hook':
      await runHook(await readStdin());
      return 0;
    default:
      throw new UsageError(command ? `Unknown command: ${command}` : 'Missing command');
  }
}

try {
  process.exit(await main());
} catch (error) {
  if (process.argv[2] === 'hook') process.exit(0);
  const isUsage = error instanceof UsageError || error.code?.startsWith?.('ERR_PARSE_ARGS');
  console.error(`${error.message}${isUsage ? `\n\n${USAGE}` : ''}`);
  process.exit(isUsage ? 64 : 1);
}
