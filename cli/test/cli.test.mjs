import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEAD_RELAY, fakeRelay, run, tempHome, writeConfig } from './helpers.mjs';

const configPath = (home) => join(home, '.tapapprove', 'config.json');
const settingsPath = (home) => join(home, '.claude', 'settings.json');

test('pair claims the code, saves the token privately and installs the hook', async () => {
  const relay = await fakeRelay();
  const home = tempHome();
  const { code, stdout } = await run(['pair', 'abc-234', '--relay', relay.url, '--name', 'MacBook'], { home });
  await relay.close();

  assert.equal(code, 0);
  assert.match(stdout, /Paired/);
  assert.deepEqual(relay.calls[0].body, { code: 'ABC234', name: 'MacBook' });

  const config = JSON.parse(readFileSync(configPath(home), 'utf8'));
  assert.equal(config.token, 'ch1.cli-secret');
  assert.equal(config.relay, relay.url);
  assert.equal(statSync(configPath(home)).mode & 0o777, 0o600);

  const settings = JSON.parse(readFileSync(settingsPath(home), 'utf8'));
  assert.match(settings.hooks.PermissionRequest[0].hooks[0].command, /tapapprove\.mjs" hook$/);
});

test('the hook runs a private copy, so a planted node_modules cannot replace it', async () => {
  const relay = await fakeRelay();
  const home = tempHome();
  await run(['pair', 'ABC234', '--relay', relay.url], { home });
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
  await run(['pair', 'ABC234', '--relay', relay.url], { home });
  await run(['unpair'], { home });
  await relay.close();
  assert.equal(existsSync(join(home, '.tapapprove', 'app')), false);
});

test('pair with a bad code explains itself and changes nothing', async () => {
  const relay = await fakeRelay({ claim: () => [404, { error: 'invalid_code' }] });
  const home = tempHome();
  const { code, stderr } = await run(['pair', 'WRONG1', '--relay', relay.url], { home });
  await relay.close();
  assert.notEqual(code, 0);
  assert.match(stderr, /code/i);
  assert.equal(existsSync(configPath(home)), false);
  assert.equal(existsSync(settingsPath(home)), false);
});

test('pair with an unreachable relay names the relay and changes nothing', async () => {
  const home = tempHome();
  const { code, stderr } = await run(['pair', 'ABC234', '--relay', DEAD_RELAY], { home });
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
  const { code } = await run(['pair', 'ABC234', '--relay', relay.url, '--scope', 'project', '--project-dir', home], { home });
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
  assert.equal(relay.calls.find((call) => call.path === '/v1/requests').body.tool, 'Bash');
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
  await run(['pair', 'ABC234', '--relay', relay.url], { home });
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
