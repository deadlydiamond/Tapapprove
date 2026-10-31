import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decisionProof, generateKeyPair, open, pairingTagKey, seal, watchTag } from '../lib/e2e.mjs';

export const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tapapprove.mjs');

/** A throwaway HOME, so tests can never touch the real ~/.claude/settings.json. */
export function tempHome() {
  return mkdtempSync(join(tmpdir(), 'tapapprove-home-'));
}

export const PAIR_CODE = 'ABCD-EFGH-JKLM-NPQR-STUV';
const PAIR_SECRET = 'EFGHJKLMNPQRSTUV';

export const TEST_KEYS = {
  requestKey: Buffer.alloc(32, 1).toString('base64'),
  answerKey: Buffer.alloc(32, 2).toString('base64'),
  proofKey: Buffer.alloc(32, 3).toString('base64'),
};

export function writeConfig(home, config) {
  const dir = join(home, '.tapapprove');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ keys: TEST_KEYS, ...config }));
}

/** What the watch would read from the request the CLI sent to this relay. */
export function openedRequest(relay) {
  const { body } = relay.calls.find((call) => call.method === 'POST' && call.path === '/v1/requests');
  return JSON.parse(open(TEST_KEYS.requestKey, body.sealed, `req:${body.id}`));
}

/** Plays the watch: signs each answer with the test keys, unless the answer brings its own proof. */
function watchAnswer(id, answer) {
  const { status, option, message, ...rest } = typeof answer === 'string' ? { status: answer } : answer;
  if (status !== 'allow' && status !== 'deny') return { status };
  const sealedMessage = message ? seal(TEST_KEYS.answerKey, message, `msg:${id}`) : undefined;
  const proof = decisionProof(TEST_KEYS.proofKey, { id, decision: status, option, sealedMessage });
  return { status, option, sealedMessage, proof, ...rest };
}

function watchPublicKey({ publicKey }) {
  const watch = generateKeyPair();
  return { publicKey: watch.publicKey, tag: watchTag(pairingTagKey(PAIR_SECRET), publicKey, watch.publicKey) };
}

/** Runs the real CLI as a child process. `onSpawn` can signal it mid-run. */
export function run(args, { home, stdin = '', onSpawn } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude') },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
    onSpawn?.(child);
  });
}

/**
 * A stand-in relay speaking the real HTTP contract. `decide(request)` returns the
 * status to report on each poll of a request.
 */
export async function fakeRelay({ decide = () => 'pending', claim, createStatus = 200, watchKey = watchPublicKey, status = {} } = {}) {
  const calls = [];
  let claimed;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://relay');
      const parsed = body ? JSON.parse(body) : undefined;
      calls.push({ method: req.method, path: url.pathname, auth: req.headers.authorization, body: parsed });
      const send = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.method === 'POST' && url.pathname === '/v1/pair/claim') {
        claimed = parsed;
        return claim ? send(...claim(parsed)) : send(200, { cliToken: 'ch1.cli-secret' });
      }
      if (req.method === 'GET' && url.pathname === '/v1/pair/key') {
        return send(200, { key: watchKey(claimed) });
      }
      if (req.method === 'POST' && url.pathname === '/v1/requests') {
        if (createStatus !== 200) return send(createStatus, { error: 'nope' });
        return send(200, { id: parsed.id, expiresAt: Date.now() + 60_000, pushed: false });
      }
      const single = url.pathname.match(/^\/v1\/requests\/([^/]+)$/);
      if (req.method === 'GET' && single) {
        return send(200, { id: single[1], ...watchAnswer(single[1], decide(parsed)) });
      }
      if (req.method === 'DELETE' && single) {
        return send(200, { id: single[1], status: 'cancelled' });
      }
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        return send(200, { paired: true, role: 'cli', hasPushToken: false, pending: 0, lastWatchSeenAt: null, ...status });
      }
      if (req.method === 'DELETE' && url.pathname === '/v1/pair') {
        return send(200, { ok: true });
      }
      return send(404, { error: 'not_found' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

/** A URL nothing is listening on. */
export const DEAD_RELAY = 'http://127.0.0.1:9';
