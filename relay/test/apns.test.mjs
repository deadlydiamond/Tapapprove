import assert from 'node:assert/strict';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { apnsConfig, buildJwt, buildPayload, sendPush } from '../src/apns.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KEY_P8 = privateKey.export({ type: 'pkcs8', format: 'pem' });

const ENV = { APNS_KEY_P8: KEY_P8, APNS_KEY_ID: 'KEY1234567', APNS_TEAM_ID: 'TEAM123456', APNS_TOPIC: 'com.example.app' };
const CONFIG = apnsConfig(ENV);
const DEVICE = { token: 'a'.repeat(64), env: 'production' };
const SUMMARY = { id: 'r1', title: 'Run command', detail: 'ls -la', project: 'shop' };

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());

function fakeApns(status = 200, reason) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(reason ? JSON.stringify({ reason }) : null, { status });
  };
  return { calls, fetchFn };
}

test('no push config when any secret is missing, so a relay without APNs still works', () => {
  for (const key of Object.keys(ENV)) {
    assert.equal(apnsConfig({ ...ENV, [key]: undefined }), null, `${key} missing`);
  }
});

test('the JWT is what APNs requires, and its signature verifies', async () => {
  const jwt = await buildJwt(CONFIG, 1_800_000_000);
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(decode(header), { alg: 'ES256', kid: 'KEY1234567' });
  assert.deepEqual(decode(claims), { iss: 'TEAM123456', iat: 1_800_000_000 });

  // JOSE wants raw r||s (64 bytes), not the DER form many crypto APIs produce.
  const raw = Buffer.from(signature, 'base64url');
  assert.equal(raw.length, 64);
  const verifier = await webcrypto.subtle.importKey(
    'spki',
    publicKey.export({ type: 'spki', format: 'der' }),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const valid = await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifier,
    raw,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  assert.equal(valid, true);
});

test('a key pasted with literal \\n sequences still signs', async () => {
  const flattened = apnsConfig({ ...ENV, APNS_KEY_P8: KEY_P8.replace(/\n/g, '\\n') });
  assert.equal((await buildJwt(flattened, 1_800_000_000)).split('.').length, 3);
});

test('a short request can be approved straight from the notification', () => {
  const { aps, requestId } = buildPayload(SUMMARY);
  assert.equal(requestId, 'r1');
  assert.equal(aps.category, 'TAPAPPROVE_QUICK');
  assert.equal(aps.alert.title, 'Run command');
  assert.equal(aps.alert.subtitle, 'shop');
  assert.equal(aps.alert.body, 'ls -la');
});

test('a request too long for the notification must be opened, so no one approves an unseen tail', () => {
  const { aps } = buildPayload({ ...SUMMARY, detail: `ls; ${'x'.repeat(400)}; rm -rf /` });
  assert.equal(aps.category, 'TAPAPPROVE_REVIEW');
  assert.ok(!aps.alert.body.includes('rm -rf /'));
  assert.ok(aps.alert.body.length <= 180);
});

test('a short request can be allowed for the session from the notification, which names what that allows', () => {
  const { aps } = buildPayload({ ...SUMMARY, options: ['Yes, allow ls for this session'] });
  assert.equal(aps.category, 'TAPAPPROVE_QUICK_SESSION');
  assert.match(aps.alert.body, /ls -la/);
  assert.match(aps.alert.body, /Yes, allow ls for this session/);
});

test('a session answer that does not fit beside the request must be opened', () => {
  const { aps } = buildPayload({ ...SUMMARY, detail: 'x'.repeat(150), options: ['Yes, allow ls for this session'] });
  assert.equal(aps.category, 'TAPAPPROVE_REVIEW');
  assert.doesNotMatch(aps.alert.body, /this session/);
});

test('a short request marked as cut still must be opened, since the tail is hidden', () => {
  assert.equal(buildPayload({ ...SUMMARY, truncated: true }).aps.category, 'TAPAPPROVE_REVIEW');
});

for (const [env, host] of [['production', 'api.push.apple.com'], ['sandbox', 'api.sandbox.push.apple.com']]) {
  test(`a ${env} device is sent to ${host}`, async () => {
    const { calls, fetchFn } = fakeApns();
    const result = await sendPush(CONFIG, { ...DEVICE, env }, SUMMARY, { fetchFn });
    assert.deepEqual(result, { sent: true, dead: false });
    assert.equal(calls[0].url, `https://${host}/3/device/${DEVICE.token}`);
    assert.equal(calls[0].init.headers['apns-topic'], 'com.example.app');
    assert.equal(calls[0].init.headers['apns-push-type'], 'alert');
    assert.equal(calls[0].init.headers['apns-priority'], '10');
    assert.equal(JSON.parse(calls[0].init.body).requestId, 'r1');
  });
}

test('a push expires with its request, so a late delivery cannot show a dead prompt', async () => {
  const { calls, fetchFn } = fakeApns();
  await sendPush(CONFIG, DEVICE, { ...SUMMARY, expiresAt: 1_900_000_090_500 }, { fetchFn });
  assert.equal(calls[0].init.headers['apns-expiration'], '1900000090');
});

test('the signing token is reused, because APNs rejects frequent new ones', async () => {
  const { calls, fetchFn } = fakeApns();
  const start = 1_900_000_000_000;
  await sendPush(CONFIG, DEVICE, SUMMARY, { fetchFn, now: start });
  await sendPush(CONFIG, DEVICE, SUMMARY, { fetchFn, now: start + 49 * 60_000 });
  await sendPush(CONFIG, DEVICE, SUMMARY, { fetchFn, now: start + 51 * 60_000 });
  const tokens = calls.map((call) => call.init.headers.authorization);
  assert.equal(tokens[0], tokens[1]);
  assert.notEqual(tokens[1], tokens[2]);
});

for (const [status, reason] of [[410, 'Unregistered'], [400, 'BadDeviceToken']]) {
  test(`${reason} marks the device token dead so it is not retried forever`, async () => {
    const { fetchFn } = fakeApns(status, reason);
    assert.deepEqual(await sendPush(CONFIG, DEVICE, SUMMARY, { fetchFn }), { sent: false, dead: true });
  });
}

test('other APNs errors keep the token', async () => {
  const { fetchFn } = fakeApns(500, 'InternalServerError');
  assert.deepEqual(await sendPush(CONFIG, DEVICE, SUMMARY, { fetchFn }), { sent: false, dead: false });
});

test('a network failure reports not sent instead of failing the request', async () => {
  const fetchFn = async () => { throw new Error('boom'); };
  assert.deepEqual(await sendPush(CONFIG, DEVICE, SUMMARY, { fetchFn }), { sent: false, dead: false });
});
