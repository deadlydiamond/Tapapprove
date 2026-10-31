import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { MAX_DETAIL } from '../lib/describe.mjs';
import { DEAD_RELAY, fakeRelay, openedRequest, PAIR_CODE, run, tempHome, writeConfig } from './helpers.mjs';

const configPath = (home) => join(home, '.tapapprove', 'config.json');
const settingsPath = (home) => join(home, '.claude', 'settings.json');

test('test does not send a command too long for the watch', async () => {
  const relay = await fakeRelay({ decide: () => 'allow' });
  const home = tempHome();
  writeConfig(home, { relay: relay.url, token: 'ch1.cli-secret' });
  const { code, stdout } = await run(['test', '--command', 'a'.repeat(MAX_DETAIL + 1)], { home });
  await relay.close();
  assert.equal(code, 2);
  assert.match(stdout, /too long/i);
  assert.equal(relay.calls.some((call) => call.path === '/v1/requests'), false);
});

test('test can offer a session answer and reports when it is chosen', async () => {
  const relay = await fakeRelay({ decide: () => ({ status: 'allow', option: 0 }) });
  const home = tempHome();
  writeConfig(home, { relay: relay.url, token: 'ch1.cli-secret' });
  const label = 'Yes, allow ls for this session';
  const { code, stdout } = await run(['test', '--session-label', label], { home });
  await relay.close();
  assert.equal(code, 0);
  assert.match(stdout, /for this session/);
  assert.deepEqual(openedRequest(relay).options, [label]);
});

test('test prints what the watch said to do instead', async () => {
  const relay = await fakeRelay({ decide: () => ({ status: 'deny', message: 'use pnpm instead' }) });
  const home = tempHome();
  writeConfig(home, { relay: relay.url, token: 'ch1.cli-secret' });
  const { code, stdout } = await run(['test'], { home });
  await relay.close();
  assert.equal(code, 1);
  assert.match(stdout, /use pnpm instead/);
});

test('pair claims the code, saves the token privately and installs the hook', async () => {
  const relay = await fakeRelay();
  const home = tempHome();
  const { code, stdout } = await run(['pair', 'abcd-efgh-jklm-npqr-stuv', '--relay', relay.url], { home });
  await relay.close();

  assert.equal(code, 0);
  assert.match(stdout, /Paired/);
  assert.equal(relay.calls[0].body.code, 'ABCD');
  assert.ok(!('name' in relay.calls[0].body), 'the relay has no need for the name of this computer');
  assert.ok(!JSON.stringify(relay.calls).includes('EFGHJKLM'), 'the secret part of the code must never reach the relay');

  const config = JSON.parse(readFileSync(configPath(home), 'utf8'));
  assert.equal(config.token, 'ch1.cli-secret');
  assert.equal(config.relay, relay.url);
  assert.equal(Buffer.from(config.keys.requestKey, 'base64').length, 32);
  assert.equal(new Set(Object.values(config.keys)).size, 3);
  assert.equal(statSync(configPath(home)).mode & 0o777, 0o600);

  const settings = JSON.parse(readFileSync(settingsPath(home), 'utf8'));
  assert.match(settings.hooks.PermissionRequest[0].hooks[0].command, /tapapprove\.mjs" hook$/);
});

test('the hook runs a private copy, so a planted node_modules cannot replace it', async () => {
  const relay = await fakeRelay();
  const home = tempHome();
  await run(['pair', PAIR_CODE, '--relay', relay.url], { home });
  await relay.close();
  const settings = JSON.parse(readFileSync(settingsPath(home), 'utf8'));
  const { command } = settings.hooks.PermissionRequest[0].hooks[0];
  assert.doesNotMatch(command, /npx/);
  const script = command.match(/"([^"]+tapapprove\.mjs)"/)[1];
  assert.ok(realpathSync(script).startsWith(realpathSync(join(home, '.tapapprove'))), script);

  // The private copy works on its own: with no pairing it stays out of the way.
  writeFileSync(configPath(home), '{}');
  const child = spawnSync(process.execPath, [script, 'hook'], {
    input: 'not json',
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '');
});

test('unpair removes the private copy too', async () => {
  const relay = await fakeRelay();
  const home = tempHome();
  await run(['pair', PAIR_CODE, '--relay', relay.url], { home });
  await run(['unpair'], { home });
  await relay.close();
  assert.equal(existsSync(join(home, '.tapapprove', 'app')), false);
});

test('pair with a bad code explains itself and changes nothing', async () => {
  const relay = await fakeRelay({ claim: () => [404, { error: 'invalid_code' }] });
  const home = tempHome();
  const { code, stderr } = await run(['pair', 'WRNG-EFGH-JKLM-NPQR-STUV', '--relay', relay.url], { home });
  await relay.close();
  assert.notEqual(code, 0);
  assert.match(stderr, /code/i);
  assert.equal(existsSync(configPath(home)), false);
  assert.equal(existsSync(settingsPath(home)), false);
});

test('pair with a code of the wrong length explains itself without contacting the relay', async () => {
  const relay = await fakeRelay();
  const home = tempHome();
  const { code, stderr } = await run(['pair', 'ABC234', '--relay', relay.url], { home });
  await relay.close();
  assert.notEqual(code, 0);
  assert.match(stderr, /20 characters/);
  assert.equal(relay.calls.length, 0);
  assert.equal(existsSync(configPath(home)), false);
});

test('a watch that cannot prove the code is refused, revoked and nothing is saved', async () => {
  const relay = await fakeRelay({
    watchKey: ({ publicKey }) => ({ publicKey, tag: 'bm90IGEgcmVhbCB0YWc=' }),
  });
  const home = tempHome();
  const { code, stderr } = await run(['pair', PAIR_CODE, '--relay', relay.url], { home });
  await relay.close();
  assert.notEqual(code, 0);
  assert.match(stderr, /verify/i);
  assert.ok(relay.calls.some((call) => call.method === 'DELETE' && call.path === '/v1/pair'));
  assert.equal(existsSync(configPath(home)), false);
  assert.equal(existsSync(settingsPath(home)), false);
});

test('test ignores an answer the watch did not sign', async () => {
  const relay = await fakeRelay({ decide: () => ({ status: 'allow', proof: 'made-up' }) });
  const home = tempHome();
  writeConfig(home, { relay: relay.url, token: 'ch1.cli-secret' });
  const { code, stdout } = await run(['test', '--timeout', '3'], { home });
  await relay.close();
  assert.equal(code, 2);
  assert.match(stdout, /did not come from your watch/);
});

test('test and status ask a pairing from before encryption to pair again', async () => {
  const relay = await fakeRelay();
  const home = tempHome();
  writeConfig(home, { relay: relay.url, token: 'ch1.cli-secret', keys: null });
  const tested = await run(['test'], { home });
  const status = await run(['status'], { home });
  await relay.close();
  assert.notEqual(tested.code, 0);
  assert.match(tested.stderr, /pair again/i);
  assert.match(status.stdout, /Encrypted:\s+no/);
});

test('pair with an unreachable relay names the relay and changes nothing', async () => {
  const home = tempHome();
  const { code, stderr } = await run(['pair', PAIR_CODE, '--relay', DEAD_RELAY], { home });
  assert.notEqual(code, 0);
  assert.ok(stderr.includes(DEAD_RELAY));
  assert.equal(existsSync(configPath(home)), false);
});

test('pair without a code prints usage', async () => {
  const { code, stderr } = await run(['pair'], { home: tempHome() });
  assert.notEqual(code, 0);
  assert.match(stderr, /pair <code>/);
});

test('pair --scope project writes the hook to the project, not the user settings', async () => {
  const relay = await fakeRelay();
  const home = tempHome();
  const { code } = await run(['pair', PAIR_CODE, '--relay', relay.url, '--scope', 'project', '--project-dir', home], { home });
  await relay.close();
  assert.equal(code, 0);
  assert.equal(existsSync(settingsPath(home)), false);
  assert.ok(existsSync(join(home, '.claude', 'settings.local.json')));
});

async function pairedHome(options) {
  const relay = await fakeRelay(options);
  const home = tempHome();
  writeConfig(home, { relay: relay.url, token: 'ch1.cli-secret' });
  return { relay, home };
}

test('test exits 0 when the watch approves', async () => {
  const { relay, home } = await pairedHome({ decide: () => 'allow' });
  const { code, stdout } = await run(['test', '--timeout', '3'], { home });
  await relay.close();
  assert.equal(code, 0);
  assert.match(stdout, /Approved/);
  assert.equal(openedRequest(relay).tool, 'Bash');
});

test('test exits 1 when the watch denies', async () => {
  const { relay, home } = await pairedHome({ decide: () => 'deny' });
  const { code, stdout } = await run(['test', '--timeout', '3'], { home });
  await relay.close();
  assert.equal(code, 1);
  assert.match(stdout, /Denied/);
});

test('test exits 2 when nobody answers', async () => {
  const { relay, home } = await pairedHome({ decide: () => 'pending' });
  const { code, stdout } = await run(['test', '--timeout', '1'], { home });
  await relay.close();
  assert.equal(code, 2);
  assert.match(stdout, /No answer/);
});

test('test without a pairing tells you to pair', async () => {
  const { code, stderr } = await run(['test'], { home: tempHome() });
  assert.notEqual(code, 0);
  assert.match(stderr, /pair/);
});

test('status reports the relay state and that the hook is missing', async () => {
  const { relay, home } = await pairedHome();
  const { code, stdout } = await run(['status'], { home });
  await relay.close();
  assert.equal(code, 0);
  assert.match(stdout, /Paired:\s+yes/);
  assert.match(stdout, /Hook:\s+not installed/);
});

test('status exits non-zero when the relay cannot be reached', async () => {
  const home = tempHome();
  writeConfig(home, { relay: DEAD_RELAY, token: 'ch1.cli-secret' });
  const { code, stderr } = await run(['status'], { home });
  assert.notEqual(code, 0);
  assert.ok(stderr.includes(DEAD_RELAY));
});

test('unpair revokes on the relay and removes the local config and hook', async () => {
  const relay = await fakeRelay();
  const home = tempHome();
  await run(['pair', PAIR_CODE, '--relay', relay.url], { home });
  const { code } = await run(['unpair'], { home });
  await relay.close();
  assert.equal(code, 0);
  assert.ok(relay.calls.some((call) => call.method === 'DELETE' && call.path === '/v1/pair'));
  assert.equal(existsSync(configPath(home)), false);
  assert.equal(JSON.parse(readFileSync(settingsPath(home), 'utf8')).hooks, undefined);
});

test('unpair still cleans up locally when the relay is down', async () => {
  const home = tempHome();
  writeConfig(home, { relay: DEAD_RELAY, token: 'ch1.cli-secret' });
  const { code } = await run(['unpair'], { home });
  assert.equal(code, 0);
  assert.equal(existsSync(configPath(home)), false);
});

test('an unknown command prints usage', async () => {
  const { code, stderr } = await run(['nope'], { home: tempHome() });
  assert.notEqual(code, 0);
  assert.match(stderr, /Usage/);
});

test('status cannot be made to print terminal codes by the relay', async () => {
  const relay = await fakeRelay({ status: { pending: '\u001b]0;pwned\u0007' } });
  const home = tempHome();
  writeConfig(home, { relay: relay.url, token: 'ch1.cli-secret' });
  const { stdout } = await run(['status'], { home });
  await relay.close();
  assert.ok(!stdout.includes('\u001b'));
});

test('a code typed with spaces still pairs', async () => {
  const relay = await fakeRelay();
  const home = tempHome();
  const { code } = await run(['pair', ...PAIR_CODE.split('-'), '--relay', relay.url], { home });
  await relay.close();
  assert.equal(code, 0);
  assert.equal(relay.calls[0].body.code, 'ABCD');
});

test('the relay cannot send this computer off to another address', async () => {
  let reached = 0;
  const other = createServer((req, res) => { reached += 1; res.end('{}'); });
  await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
  const redirecting = createServer((req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${other.address().port}/admin` });
    res.end();
  });
  await new Promise((resolve) => redirecting.listen(0, '127.0.0.1', resolve));
  const home = tempHome();
  writeConfig(home, { relay: `http://127.0.0.1:${redirecting.address().port}`, token: 'ch1.cli-secret' });
  const { code } = await run(['status'], { home });
  other.close();
  redirecting.close();
  assert.equal(reached, 0);
  assert.notEqual(code, 0);
});
