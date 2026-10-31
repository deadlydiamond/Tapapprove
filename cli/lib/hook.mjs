// The Claude Code hook. The rule that shapes this file: only a real answer from the
// watch produces a decision. Every failure exits 0 with empty stdout, which leaves
// the choice to Claude Code's own prompt. A failure must never become an allow.

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { configDir, DEFAULT_WAIT_SECONDS, loadConfig } from './config.mjs';
import { describeTool } from './describe.mjs';
import { sessionOptions } from './options.mjs';
import { relayClient, waitForDecision } from './relay.mjs';

const MAX_LOG_BYTES = 1_000_000;
// These tools ask the user to answer or review something a watch button cannot express.
const NEEDS_THE_COMPUTER = new Set(['AskUserQuestion', 'ExitPlanMode']);

/** Records that the hook ran. Tool names only: command text never reaches this file. */
function log(event, tool, outcome, startedAt) {
  try {
    const path = join(configDir(), 'hook.log');
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    try {
      if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.1`);
    } catch {
      // No log yet.
    }
    const line = `${new Date().toISOString()} ${event} tool=${tool} outcome=${outcome} ms=${Date.now() - startedAt}\n`;
    appendFileSync(path, line, { mode: 0o600 });
  } catch {
    // Logging must never affect the decision.
  }
}

function permissionDecision({ status, option, message }, options) {
  if (status === 'allow') {
    const update = options[option]?.update;
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow', ...(update ? { updatedPermissions: [update] } : {}) },
      },
    };
  }
  if (status === 'deny') {
    const denied = 'The user denied this from Tapapprove on their Apple Watch.';
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: message ? `${denied} They said: ${message}` : denied },
      },
    };
  }
  return null;
}

export async function runHook(stdinText) {
  const startedAt = Date.now();
  let input;
  try {
    input = JSON.parse(stdinText);
  } catch {
    log('unknown', 'unknown', 'error:bad-stdin', startedAt);
    return;
  }
  const event = input.hook_event_name ?? 'unknown';
  const tool = input.tool_name ?? 'unknown';

  const config = loadConfig();
  if (!config) return;
  if (NEEDS_THE_COMPUTER.has(tool)) {
    log(event, tool, 'skipped', startedAt);
    return;
  }

  const client = relayClient(config.relay, config.token);
  let requestId = null;
  const stop = async () => {
    if (requestId) await client.cancel(requestId).catch(() => {});
    log(event, tool, 'killed', startedAt);
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  const waitSeconds = config.waitSeconds ?? DEFAULT_WAIT_SECONDS;
  const options = sessionOptions(tool, input.permission_suggestions);
  let outcome;
  try {
    const summary = describeTool(tool, input.tool_input);
    if (summary.truncated) {
      log(event, tool, 'skipped:too-long', startedAt);
      return;
    }
    const created = await client.createRequest({
      tool,
      ...summary,
      options: options.map((option) => option.label),
      project: input.cwd ? basename(input.cwd) : undefined,
      ttlSeconds: waitSeconds,
    });
    requestId = created.id;
    outcome = await waitForDecision(client, requestId, waitSeconds);
  } catch (error) {
    log(event, tool, `error:${error.status ?? 'network'}`, startedAt);
    return;
  }

  if (outcome.status === 'timeout') await client.cancel(requestId).catch(() => {});
  log(event, tool, outcome.status, startedAt);
  const decision = permissionDecision(outcome, options);
  if (decision) process.stdout.write(`${JSON.stringify(decision)}\n`);
}
