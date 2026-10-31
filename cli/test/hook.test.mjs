import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEAD_RELAY, fakeRelay, run, tempHome, writeConfig } from './helpers.mjs';

const PROMPT = JSON.stringify({
  session_id: 's1',
  cwd: '/Users/me/projects/shop',
  permission_mode: 'default',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'SECRET_TOKEN=abc ls -la' },
});

async function hook({ decide, createStatus, waitSeconds = 3, stdin = PROMPT, onSpawn } = {}) {
  const relay = await fakeRelay({ decide, createStatus });
  const home = tempHome();
  writeConfig(home, { relay: relay.url, token: 'ch1.cli-secret', waitSeconds });
  const result = await run(['hook'], { home, stdin, onSpawn });
  await relay.close();
  return { ...result, relay, home };
}

const asksForPrompt = ({ code, stdout }) => {
  assert.equal(code, 0);
  assert.equal(stdout, '', 'no stdout means Claude Code falls back to its own prompt');
};

test('an approval from the watch allows the tool', async () => {
  const { code, stdout } = await hook({ decide: () => 'allow' });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  });
});

test('a denial from the watch denies the tool and tells Claude why', async () => {
  const { code, stdout } = await hook({ decide: () => 'deny' });
  assert.equal(code, 0);
  const { decision } = JSON.parse(stdout).hookSpecificOutput;
  assert.equal(decision.behavior, 'deny');
  assert.match(decision.message, /Apple Watch/);
});

test('sends the masked summary and the project name, with the CLI token', async () => {
  const { relay } = await hook({ decide: () => 'allow' });
  const create = relay.calls.find((call) => call.path === '/v1/requests');
  assert.equal(create.auth, 'Bearer ch1.cli-secret');
  assert.equal(create.body.tool, 'Bash');
  assert.equal(create.body.project, 'shop');
  assert.match(create.body.detail, /ls -la/);
  assert.ok(!create.body.detail.includes('abc'));
});

test('tells the relay when the summary was cut', async () => {
  const stdin = JSON.stringify({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'a'.repeat(5000) },
  });
  const { relay } = await hook({ decide: () => 'deny', stdin });
  assert.equal(relay.calls.find((call) => call.path === '/v1/requests').body.truncated, true);
});

test('keeps waiting across pending polls until a decision arrives', async () => {
  let polls = 0;
  const { stdout } = await hook({ decide: () => (++polls < 3 ? 'pending' : 'allow'), waitSeconds: 5 });
  assert.equal(polls, 3);
  assert.equal(JSON.parse(stdout).hookSpecificOutput.decision.behavior, 'allow');
});

test('an unreachable relay falls back to the normal prompt, never to allow', async () => {
  const home = tempHome();
  writeConfig(home, { relay: DEAD_RELAY, token: 'ch1.cli-secret', waitSeconds: 3 });
  asksForPrompt(await run(['hook'], { home, stdin: PROMPT }));
});

test('a rejected token falls back to the normal prompt', async () => {
  asksForPrompt(await hook({ createStatus: 401 }));
});

test('no decision in time falls back to the prompt and cancels on the relay', async () => {
  const result = await hook({ decide: () => 'pending', waitSeconds: 1 });
  asksForPrompt(result);
  assert.ok(result.relay.calls.some((call) => call.method === 'DELETE' && call.path === '/v1/requests/r1'));
});

for (const status of ['expired', 'cancelled']) {
  test(`a request that ended as ${status} falls back to the prompt`, async () => {
    asksForPrompt(await hook({ decide: () => status }));
  });
}

test('being killed mid-wait prints no decision and cancels on the relay', async () => {
  const result = await hook({
    decide: () => 'pending',
    waitSeconds: 30,
    onSpawn: (child) => setTimeout(() => child.kill('SIGTERM'), 800),
  });
  assert.equal(result.stdout, '');
  assert.ok(result.relay.calls.some((call) => call.method === 'DELETE'));
});

test('without a pairing the hook stays out of the way', async () => {
  asksForPrompt(await run(['hook'], { home: tempHome(), stdin: PROMPT }));
});

test('malformed stdin falls back to the prompt', async () => {
  asksForPrompt(await hook({ stdin: 'not json' }));
});

for (const tool of ['AskUserQuestion', 'ExitPlanMode']) {
  test(`${tool} needs an answer a watch cannot give, so it skips the relay`, async () => {
    const result = await hook({
      stdin: JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: {} }),
    });
    asksForPrompt(result);
    assert.equal(result.relay.calls.length, 0);
  });
}

test('logs each run without the command text, so a run can be proven later', async () => {
  const { home } = await hook({ decide: () => 'allow' });
  const log = readFileSync(join(home, '.tapapprove', 'hook.log'), 'utf8');
  assert.match(log, /PermissionRequest/);
  assert.match(log, /tool=Bash/);
  assert.match(log, /outcome=allow/);
  assert.ok(!log.includes('ls -la'));
  assert.ok(existsSync(join(home, '.tapapprove', 'hook.log')));
});
