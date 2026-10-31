import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cliTag,
  decisionProof,
  deriveKeys,
  generateKeyPair,
  open,
  pairingTagKey,
  seal,
  splitCode,
  verifyDecision,
  watchTag,
} from '../lib/e2e.mjs';

const pairKeys = () => {
  const tagKey = pairingTagKey('EFGHJKLMNPQRSTUV');
  const cli = generateKeyPair();
  const watch = generateKeyPair();
  const common = { tagKey, cliPublicKey: cli.publicKey, watchPublicKey: watch.publicKey };
  return {
    cliKeys: deriveKeys({ ...common, privateKey: cli.privateKey, peerPublicKey: watch.publicKey }),
    watchKeys: deriveKeys({ ...common, privateKey: watch.privateKey, peerPublicKey: cli.publicKey }),
  };
};

test('a code splits into the part the relay sees and the part it never does', () => {
  assert.deepEqual(splitCode('abcd-efgh-jklm-npqr-stuv'), { lookup: 'ABCD', secret: 'EFGHJKLMNPQRSTUV' });
  assert.deepEqual(splitCode('ABCD EFGH JKLM NPQR STUV'), { lookup: 'ABCD', secret: 'EFGHJKLMNPQRSTUV' });
});

test('a code of the wrong length is refused, including the older shorter kinds', () => {
  assert.equal(splitCode('ABC234'), null);
  assert.equal(splitCode('ABCD-EFGH-JKLM'), null);
  assert.equal(splitCode('ABCDEFGHJKLMNPQRSTUVW'), null);
  assert.equal(splitCode(''), null);
});

test('both sides derive the same keys, and the three keys differ', () => {
  const { cliKeys, watchKeys } = pairKeys();
  assert.deepEqual(cliKeys, watchKeys);
  assert.equal(new Set([cliKeys.requestKey, cliKeys.answerKey, cliKeys.proofKey]).size, 3);
});

test('the tags prove knowledge of the secret, and bind the exact public keys', () => {
  const tagKey = pairingTagKey('EFGHJKLMNPQRSTUV');
  const cli = generateKeyPair();
  const watch = generateKeyPair();
  const other = generateKeyPair();
  assert.equal(cliTag(tagKey, cli.publicKey), cliTag(tagKey, cli.publicKey));
  assert.notEqual(cliTag(tagKey, cli.publicKey), cliTag(tagKey, other.publicKey));
  assert.notEqual(cliTag(pairingTagKey('EFGHJKLMNPQRSTUW'), cli.publicKey), cliTag(tagKey, cli.publicKey));
  assert.notEqual(watchTag(tagKey, cli.publicKey, watch.publicKey), watchTag(tagKey, other.publicKey, watch.publicKey));
});

test('sealed text opens with the same key and label', () => {
  const key = pairKeys().cliKeys.requestKey;
  const sealed = seal(key, 'rm -rf build', 'req:one');
  assert.ok(!Buffer.from(sealed, 'base64').toString('latin1').includes('rm -rf'));
  assert.equal(open(key, sealed, 'req:one'), 'rm -rf build');
});

test('sealing twice gives different text, so equal commands cannot be spotted', () => {
  const key = pairKeys().cliKeys.requestKey;
  assert.notEqual(seal(key, 'same', 'req:one'), seal(key, 'same', 'req:one'));
});

test('text moved to another request does not open, so the relay cannot swap requests', () => {
  const key = pairKeys().cliKeys.requestKey;
  assert.throws(() => open(key, seal(key, 'ls', 'req:one'), 'req:two'));
});

test('changed text does not open', () => {
  const key = pairKeys().cliKeys.requestKey;
  const bytes = Buffer.from(seal(key, 'ls', 'req:one'), 'base64');
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => open(key, bytes.toString('base64'), 'req:one'));
});

test('text from another pairing does not open', () => {
  assert.throws(() => open(pairKeys().cliKeys.requestKey, seal(pairKeys().cliKeys.requestKey, 'ls', 'r'), 'r'));
});

test('a real answer verifies', () => {
  const { proofKey } = pairKeys().cliKeys;
  const answer = { id: 'one', decision: 'allow', option: 1 };
  assert.equal(verifyDecision(proofKey, { ...answer, proof: decisionProof(proofKey, answer) }), true);
});

for (const [change, name] of [
  [{ decision: 'allow' }, 'a denial turned into an approval'],
  [{ id: 'two' }, 'an answer moved to another request'],
  [{ option: 0 }, 'a different session answer'],
  [{ sealedMessage: 'other' }, 'a replaced message'],
]) {
  test(`${name} does not verify`, () => {
    const { proofKey } = pairKeys().cliKeys;
    const answer = { id: 'one', decision: 'deny', option: 1, sealedMessage: 'text' };
    const proof = decisionProof(proofKey, answer);
    assert.equal(verifyDecision(proofKey, { ...answer, ...change, proof }), false);
  });
}

test('a missing or odd proof does not verify and does not throw', () => {
  const { proofKey } = pairKeys().cliKeys;
  for (const proof of [undefined, null, '', 'short', 42]) {
    assert.equal(verifyDecision(proofKey, { id: 'one', decision: 'allow', proof }), false);
  }
});

test('a proof from another pairing does not verify', () => {
  const answer = { id: 'one', decision: 'allow' };
  const proof = decisionProof(pairKeys().cliKeys.proofKey, answer);
  assert.equal(verifyDecision(pairKeys().cliKeys.proofKey, { ...answer, proof }), false);
});
