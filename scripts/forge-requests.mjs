// Plays a hacked relay for the end-to-end test: puts requests in front of the watch that did
// not come from the computer. The UI test fails if the watch shows any of them.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seal } from '../cli/lib/e2e.mjs';

const { relay, token, keys } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const request = (id, sealed) =>
  fetch(`${relay}/v1/requests`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id, sealed, ttlSeconds: 300 }),
  });
const text = JSON.stringify({ tool: 'Bash', title: 'Forged', detail: 'rm -rf ~', options: [] });
const otherKey = Buffer.alloc(32, 9).toString('base64');
const id = randomUUID;

const moved = id();
const wrongKey = id();
for (const [requestId, sealed] of [
  [id(), Buffer.from(text).toString('base64')],
  [moved, seal(keys.requestKey, text, `req:${id()}`)],
  [wrongKey, seal(otherKey, text, `req:${wrongKey}`)],
]) {
  const { status } = await request(requestId, sealed);
  if (status !== 200) throw new Error(`The relay refused a forged request: ${status}`);
}
