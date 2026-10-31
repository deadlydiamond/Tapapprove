import { randomUUID } from 'node:crypto';
// Runs against the real Worker and Durable Object under `wrangler dev`.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RELAY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
let base;
let wrangler;
let stateDir;

const freePort = () =>
  new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

before(async () => {
  const [port, inspector] = [await freePort(), await freePort()];
  stateDir = mkdtempSync(join(tmpdir(), 'tapapprove-relay-'));
  base = `http://127.0.0.1:${port}`;
  let output = '';
  wrangler = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(port), '--inspector-port', String(inspector), '--persist-to', stateDir],
    { cwd: RELAY_DIR, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } },
  );
  wrangler.stdout.on('data', (chunk) => { output += chunk; });
  wrangler.stderr.on('data', (chunk) => { output += chunk; });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`wrangler dev did not start:\n${output}`);
}, { timeout: 70_000 });

after(() => {
  wrangler?.kill('SIGTERM');
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
});

async function api(method, path, { token, body, raw } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body || raw ? { 'content-type': 'application/json' } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

const CLI_KEY = { publicKey: Buffer.alloc(32, 7).toString('base64'), tag: Buffer.alloc(32, 8).toString('base64') };
const WATCH_KEY = { publicKey: Buffer.alloc(32, 9).toString('base64'), tag: Buffer.alloc(32, 10).toString('base64') };

async function pairedChannel() {
  const started = await api('POST', '/v1/pair/start', { body: {} });
  assert.equal(started.status, 200);
  const claimed = await api('POST', '/v1/pair/claim', { body: { code: started.data.code, ...CLI_KEY } });
  assert.equal(claimed.status, 200);
  return { watch: started.data.watchToken, cli: claimed.data.cliToken, code: started.data.code };
}

const newRequest = (cli, extra = {}) =>
  api('POST', '/v1/requests', {
    token: cli,
    body: { id: randomUUID(), sealed: 'c2VhbGVk', preview: 'cHJldmlldw==', ttlSeconds: 60, ...extra },
  });

// Pairing

test('pair/start works with no body and returns a readable code', async () => {
  const { status, data } = await api('POST', '/v1/pair/start');
  assert.equal(status, 200);
  assert.match(data.code, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(data.watchToken);
  assert.ok(data.expiresIn > 0);
});

test('the watch sees the pairing complete, and the relay holds no device name', async () => {
  const started = await api('POST', '/v1/pair/start');
  const before = await api('GET', '/v1/status', { token: started.data.watchToken });
  assert.equal(before.status, 200);
  assert.equal(before.data.paired, false);

  await api('POST', '/v1/pair/claim', { body: { code: started.data.code, ...CLI_KEY } });
  const afterClaim = await api('GET', '/v1/status', { token: started.data.watchToken });
  assert.equal(afterClaim.data.paired, true);
  assert.equal('peerName' in afterClaim.data, false);
  assert.equal(afterClaim.data.role, 'watch');
});

test('a code works only once', async () => {
  const { code } = await pairedChannel();
  const second = await api('POST', '/v1/pair/claim', { body: { code, ...CLI_KEY } });
  assert.equal(second.status, 404);
  assert.equal(second.data.error, 'invalid_code');
});

test('an unknown code is rejected', async () => {
  const { status } = await api('POST', '/v1/pair/claim', { body: { code: 'ZZZZ', ...CLI_KEY } });
  assert.equal(status, 404);
});

test('the two public keys cross over the relay, each one once', async () => {
  const started = await api('POST', '/v1/pair/start');
  const { code, watchToken: watch } = started.data;
  const { cliToken: cli } = (await api('POST', '/v1/pair/claim', { body: { code, ...CLI_KEY } })).data;

  assert.deepEqual((await api('GET', '/v1/status', { token: watch })).data.peerKey, CLI_KEY);
  assert.equal((await api('GET', '/v1/status', { token: cli })).data.peerKey, undefined);

  assert.equal((await api('GET', '/v1/pair/key', { token: cli })).data.key, null);
  assert.equal((await api('PUT', '/v1/pair/key', { token: watch, body: WATCH_KEY })).status, 200);
  assert.deepEqual((await api('GET', '/v1/pair/key', { token: cli })).data.key, WATCH_KEY);
  assert.equal((await api('PUT', '/v1/pair/key', { token: watch, body: CLI_KEY })).status, 409);
  assert.deepEqual((await api('GET', '/v1/pair/key', { token: cli })).data.key, WATCH_KEY);
});

test('only the watch can publish its key and only the computer can read it', async () => {
  const { cli, watch } = await pairedChannel();
  assert.equal((await api('PUT', '/v1/pair/key', { token: cli, body: WATCH_KEY })).status, 403);
  assert.equal((await api('GET', '/v1/pair/key', { token: watch })).status, 403);
});

for (const [name, key] of [
  ['no key', {}],
  ['a key that is not text', { publicKey: 5, tag: CLI_KEY.tag }],
  ['no tag', { publicKey: CLI_KEY.publicKey }],
  ['a key that is too long', { publicKey: 'A'.repeat(500), tag: CLI_KEY.tag }],
  ['a tag that is not base64', { publicKey: CLI_KEY.publicKey, tag: '<script>' }],
]) {
  test(`a claim with ${name} is refused and the code still works`, async () => {
    const { code } = (await api('POST', '/v1/pair/start')).data;
    const refused = await api('POST', '/v1/pair/claim', { body: { code, ...key } });
    assert.equal(refused.status, 400);
    assert.equal(refused.data.error, 'invalid_key');
    assert.equal((await api('POST', '/v1/pair/claim', { body: { code, ...CLI_KEY } })).status, 200);
  });
}

test('a malformed claim body is a 400, not a crash', async () => {
  assert.equal((await api('POST', '/v1/pair/claim', { raw: '{nope' })).status, 400);
  assert.equal((await api('POST', '/v1/pair/claim', { body: { code: 42 } })).status, 400);
});

// Authorization

test('requests need a valid token', async () => {
  const { cli } = await pairedChannel();
  assert.equal((await api('GET', '/v1/status')).status, 401);
  assert.equal((await api('GET', '/v1/status', { token: 'garbage' })).status, 401);
  assert.equal((await api('GET', '/v1/status', { token: `${cli}x` })).status, 401);
  // Right shape and right channel, wrong secret: only the Durable Object can catch this.
  const flipped = `${cli.slice(0, -1)}${cli.endsWith('A') ? 'B' : 'A'}`;
  assert.equal((await api('GET', '/v1/status', { token: flipped })).status, 401);
});

test('only the watch can decide, so a compromised computer cannot approve itself', async () => {
  const { cli } = await pairedChannel();
  const { data } = await newRequest(cli);
  const attempt = await api('POST', `/v1/requests/${data.id}/decision`, { token: cli, body: { decision: 'allow', proof: 'p' } });
  assert.equal(attempt.status, 403);
  assert.equal((await api('GET', `/v1/requests/${data.id}`, { token: cli })).data.status, 'pending');
});

test('only the computer can create requests', async () => {
  const { watch } = await pairedChannel();
  assert.equal((await newRequest(watch)).status, 403);
});

test('one pairing cannot see or decide requests of another', async () => {
  const a = await pairedChannel();
  const b = await pairedChannel();
  const { data } = await newRequest(a.cli);
  assert.equal((await api('GET', `/v1/requests/${data.id}`, { token: b.cli })).status, 404);
  assert.equal((await api('POST', `/v1/requests/${data.id}/decision`, { token: b.watch, body: { decision: 'allow', proof: 'p' } })).status, 404);
  assert.deepEqual((await api('GET', '/v1/requests', { token: b.watch })).data.requests, []);
});

test('revoking from either side kills both tokens', async () => {
  const { cli, watch } = await pairedChannel();
  assert.equal((await api('DELETE', '/v1/pair', { token: cli })).status, 200);
  assert.equal((await api('GET', '/v1/status', { token: cli })).status, 401);
  assert.equal((await api('GET', '/v1/status', { token: watch })).status, 401);
});

// Request lifecycle

test('a new request reaches the watch sealed, and nothing else about it', async () => {
  const { cli, watch } = await pairedChannel();
  const created = await newRequest(cli);
  assert.equal(created.status, 200);
  assert.equal(created.data.pushed, false);

  const { data } = await api('GET', '/v1/requests', { token: watch });
  assert.equal(data.requests.length, 1);
  const [request] = data.requests;
  assert.equal(request.id, created.data.id);
  assert.equal(request.sealed, 'c2VhbGVk');
  assert.deepEqual(Object.keys(request).sort(), ['createdAt', 'expiresAt', 'id', 'sealed']);
  assert.ok(request.expiresAt > data.serverTime);
});

for (const decision of ['allow', 'deny']) {
  test(`${decision} wakes a waiting long-poll right away`, async () => {
    const { cli, watch } = await pairedChannel();
    const { data } = await newRequest(cli);
    const started = Date.now();
    const poll = api('GET', `/v1/requests/${data.id}?wait=20`, { token: cli });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const decided = await api('POST', `/v1/requests/${data.id}/decision`, { token: watch, body: { decision, proof: 'p' } });
    assert.equal(decided.status, 200);
    const { data: result } = await poll;
    assert.equal(result.status, decision);
    assert.ok(Date.now() - started < 10_000, 'must not wait out the full long-poll');
  });
}

test('a long-poll with no decision returns pending after its wait', async () => {
  const { cli } = await pairedChannel();
  const { data } = await newRequest(cli);
  const started = Date.now();
  const { data: result } = await api('GET', `/v1/requests/${data.id}?wait=1`, { token: cli });
  assert.equal(result.status, 'pending');
  assert.ok(Date.now() - started >= 900);
});

test('a decided request leaves the watch list', async () => {
  const { cli, watch } = await pairedChannel();
  const { data } = await newRequest(cli);
  await api('POST', `/v1/requests/${data.id}/decision`, { token: watch, body: { decision: 'allow', proof: 'p' } });
  assert.deepEqual((await api('GET', '/v1/requests', { token: watch })).data.requests, []);
});

test('the first decision wins and a same-answer retry is harmless', async () => {
  const { cli, watch } = await pairedChannel();
  const { data } = await newRequest(cli);
  const path = `/v1/requests/${data.id}/decision`;
  await api('POST', path, { token: watch, body: { decision: 'deny', proof: 'p' } });
  assert.equal((await api('POST', path, { token: watch, body: { decision: 'deny', proof: 'p' } })).status, 200);
  const flip = await api('POST', path, { token: watch, body: { decision: 'allow', proof: 'p' } });
  assert.equal(flip.status, 409);
  assert.equal(flip.data.status, 'deny');
  assert.equal((await api('GET', `/v1/requests/${data.id}`, { token: cli })).data.status, 'deny');
});

test('an invalid decision is rejected and changes nothing', async () => {
  const { cli, watch } = await pairedChannel();
  const { data } = await newRequest(cli);
  assert.equal((await api('POST', `/v1/requests/${data.id}/decision`, { token: watch, body: { decision: 'yes' } })).status, 400);
  assert.equal((await api('GET', `/v1/requests/${data.id}`, { token: cli })).data.status, 'pending');
});

test('an expired request cannot be approved late', async () => {
  const { cli, watch } = await pairedChannel();
  const { data } = await newRequest(cli, { ttlSeconds: 1 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const late = await api('POST', `/v1/requests/${data.id}/decision`, { token: watch, body: { decision: 'allow', proof: 'p' } });
  assert.equal(late.status, 409);
  assert.equal(late.data.status, 'expired');
  assert.equal((await api('GET', `/v1/requests/${data.id}`, { token: cli })).data.status, 'expired');
  assert.deepEqual((await api('GET', '/v1/requests', { token: watch })).data.requests, []);
});

test('a long-poll ends as expired when the request runs out first', async () => {
  const { cli } = await pairedChannel();
  const { data } = await newRequest(cli, { ttlSeconds: 1 });
  const started = Date.now();
  const { data: result } = await api('GET', `/v1/requests/${data.id}?wait=20`, { token: cli });
  assert.equal(result.status, 'expired');
  assert.ok(Date.now() - started < 10_000);
});

test('a cancelled request disappears and cannot be approved', async () => {
  const { cli, watch } = await pairedChannel();
  const { data } = await newRequest(cli);
  assert.equal((await api('DELETE', `/v1/requests/${data.id}`, { token: cli })).status, 200);
  assert.deepEqual((await api('GET', '/v1/requests', { token: watch })).data.requests, []);
  const late = await api('POST', `/v1/requests/${data.id}/decision`, { token: watch, body: { decision: 'allow', proof: 'p' } });
  assert.equal(late.status, 409);
  assert.equal(late.data.status, 'cancelled');
});

test('cancelling cannot overturn a decision', async () => {
  const { cli, watch } = await pairedChannel();
  const { data } = await newRequest(cli);
  await api('POST', `/v1/requests/${data.id}/decision`, { token: watch, body: { decision: 'allow', proof: 'p' } });
  await api('DELETE', `/v1/requests/${data.id}`, { token: cli });
  assert.equal((await api('GET', `/v1/requests/${data.id}`, { token: cli })).data.status, 'allow');
});

test('text sent in the clear is dropped, even if a client sends it', async () => {
  const { cli, watch } = await pairedChannel();
  await newRequest(cli, { tool: 'Bash', title: 'Run', detail: 'rm -rf /', project: 'shop', options: ['one'] });
  const [request] = (await api('GET', '/v1/requests', { token: watch })).data.requests;
  assert.deepEqual(Object.keys(request).sort(), ['createdAt', 'expiresAt', 'id', 'sealed']);
});

test('a long sealed request reaches the watch whole', async () => {
  const { cli, watch } = await pairedChannel();
  const sealed = 'A'.repeat(300_000);
  assert.equal((await newRequest(cli, { sealed })).status, 200);
  assert.equal((await api('GET', '/v1/requests', { token: watch })).data.requests[0].sealed, sealed);
});

test('a request past the size limit is refused, not cut', async () => {
  const { cli } = await pairedChannel();
  assert.equal((await newRequest(cli, { sealed: 'A'.repeat(600_000) })).status, 413);
});

test('a request needs sealed text and a well-formed id of its own', async () => {
  const { cli } = await pairedChannel();
  assert.equal((await newRequest(cli, { sealed: undefined })).status, 400);
  assert.equal((await newRequest(cli, { sealed: '' })).status, 400);
  assert.equal((await newRequest(cli, { id: 'not-an-id' })).status, 400);
  assert.equal((await newRequest(cli, { id: '../meta' })).status, 400);
  const { data } = await newRequest(cli);
  assert.equal((await newRequest(cli, { id: data.id })).status, 409);
});

test('the answer reaches the computer exactly as the watch sent it', async () => {
  const { cli, watch } = await pairedChannel();
  const { data } = await newRequest(cli);
  const body = { decision: 'allow', option: 1, proof: 'proof-text' };
  assert.equal((await api('POST', `/v1/requests/${data.id}/decision`, { token: watch, body })).status, 200);
  const result = (await api('GET', `/v1/requests/${data.id}`, { token: cli })).data;
  assert.equal(result.status, 'allow');
  assert.equal(result.option, 1);
  assert.equal(result.proof, 'proof-text');
});

test('an answer without a proof is refused and the request stays open', async () => {
  const { cli, watch } = await pairedChannel();
  const { data } = await newRequest(cli);
  const path = `/v1/requests/${data.id}/decision`;
  for (const proof of [undefined, '', 5, 'p'.repeat(500)]) {
    const answer = await api('POST', path, { token: watch, body: { decision: 'allow', proof } });
    assert.equal(answer.status, 400);
    assert.equal(answer.data.error, 'invalid_proof');
  }
  assert.equal((await api('GET', `/v1/requests/${data.id}`, { token: cli })).data.status, 'pending');
});

test('an odd session answer is refused and the request stays open', async () => {
  const { cli, watch } = await pairedChannel();
  const { data } = await newRequest(cli);
  const path = `/v1/requests/${data.id}/decision`;
  for (const option of [10, -1, 0.5, 'one']) {
    const answer = await api('POST', path, { token: watch, body: { decision: 'allow', option, proof: 'p' } });
    assert.equal(answer.status, 400);
    assert.equal(answer.data.error, 'invalid_option');
  }
  assert.equal((await api('GET', `/v1/requests/${data.id}`, { token: cli })).data.status, 'pending');
});

test('a denial can carry sealed instructions, within a limit', async () => {
  const { cli, watch } = await pairedChannel();
  const first = (await newRequest(cli)).data;
  const body = { decision: 'deny', proof: 'p', sealedMessage: 'c2FpZA==' };
  assert.equal((await api('POST', `/v1/requests/${first.id}/decision`, { token: watch, body })).status, 200);
  assert.equal((await api('GET', `/v1/requests/${first.id}`, { token: cli })).data.sealedMessage, 'c2FpZA==');

  const second = (await newRequest(cli)).data;
  const tooLong = { decision: 'deny', proof: 'p', sealedMessage: 'A'.repeat(9000) };
  const refused = await api('POST', `/v1/requests/${second.id}/decision`, { token: watch, body: tooLong });
  assert.equal(refused.status, 400);
  assert.equal(refused.data.error, 'invalid_message');
});

test('an approval carries no message', async () => {
  const { cli, watch } = await pairedChannel();
  const { data } = await newRequest(cli);
  const body = { decision: 'allow', proof: 'p', sealedMessage: 'c2FpZA==' };
  await api('POST', `/v1/requests/${data.id}/decision`, { token: watch, body });
  assert.equal((await api('GET', `/v1/requests/${data.id}`, { token: cli })).data.sealedMessage, undefined);
});

test('a flood of pending requests is refused past the cap', async () => {
  const { cli } = await pairedChannel();
  const results = [];
  for (let index = 0; index < 21; index += 1) results.push((await newRequest(cli)).status);
  assert.deepEqual(results.slice(0, 20), Array(20).fill(200));
  assert.equal(results[20], 429);
});

// Device and status

test('the watch can register a push token, and status reports it', async () => {
  const { cli, watch } = await pairedChannel();
  assert.equal((await api('GET', '/v1/status', { token: cli })).data.hasPushToken, false);
  const put = await api('PUT', '/v1/device', { token: watch, body: { apnsToken: 'ab'.repeat(32), env: 'sandbox' } });
  assert.equal(put.status, 200);
  assert.equal((await api('GET', '/v1/status', { token: cli })).data.hasPushToken, true);
});

test('a malformed push token is rejected, since it ends up in the APNs URL', async () => {
  const { watch } = await pairedChannel();
  assert.equal((await api('PUT', '/v1/device', { token: watch, body: { apnsToken: '../../evil', env: 'sandbox' } })).status, 400);
  assert.equal((await api('PUT', '/v1/device', { token: watch, body: { apnsToken: 'ab'.repeat(32), env: 'nope' } })).status, 400);
});

test('the computer can see that the watch is checking in', async () => {
  const { cli, watch } = await pairedChannel();
  assert.equal((await api('GET', '/v1/status', { token: cli })).data.lastWatchSeenAt, null);
  await api('GET', '/v1/requests', { token: watch });
  assert.equal(typeof (await api('GET', '/v1/status', { token: cli })).data.lastWatchSeenAt, 'number');
});

test('status counts pending requests', async () => {
  const { cli } = await pairedChannel();
  await newRequest(cli);
  await newRequest(cli);
  assert.equal((await api('GET', '/v1/status', { token: cli })).data.pending, 2);
});

// Abuse limits. Each test uses its own client address so it cannot starve the others.

async function hammer(path, body, address, attempts = 150) {
  let status;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': address },
      body: JSON.stringify(body),
    });
    status = response.status;
    if (status === 429) return { status, attempt };
  }
  return { status, attempt: attempts };
}

test('guessing pairing codes gets cut off, so codes cannot be brute forced', async () => {
  const { status, attempt } = await hammer('/v1/pair/claim', { code: 'ZZZZZZ' }, '203.0.113.10');
  assert.equal(status, 429);
  assert.ok(attempt >= 10, 'a person retrying a mistyped code must not be blocked');
});

test('one client hitting the limit does not block another', async () => {
  await hammer('/v1/pair/claim', { code: 'ZZZZ', ...CLI_KEY }, '203.0.113.11');
  const other = await fetch(`${base}/v1/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.12' },
    body: JSON.stringify({ code: 'ZZZZ', ...CLI_KEY }),
  });
  assert.equal(other.status, 404);
});

test('starting pairings in a flood gets cut off, so channels cannot be mass created', async () => {
  const { status } = await hammer('/v1/pair/start', {}, '203.0.113.13');
  assert.equal(status, 429);
});

test('unknown routes are 404 JSON', async () => {
  const { status, data } = await api('GET', '/nope');
  assert.equal(status, 404);
  assert.equal(data.error, 'not_found');
});
