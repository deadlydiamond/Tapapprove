// End-to-end protection between this computer and the watch. The relay only ever carries
// sealed text, and it cannot make an approval: every answer carries a proof only the watch
// can make. watch/Tapapprove/ChannelCrypto.swift mirrors this file, byte for byte.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const LOOKUP_LENGTH = 4;
// 16 characters of 32 kinds is 80 bits. During a pairing a hacked relay holds a value it can test
// guesses against offline, so this has to be out of reach of any amount of guessing.
const SECRET_LENGTH = 16;
const PBKDF2_ROUNDS = 100_000;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

const raw = (base64) => Buffer.from(base64, 'base64');
const base64 = (bytes) => Buffer.from(bytes).toString('base64');

/** The relay sees the first part, to find the pairing. The second part never leaves the devices. */
export function splitCode(code) {
  const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== LOOKUP_LENGTH + SECRET_LENGTH) return null;
  return { lookup: clean.slice(0, LOOKUP_LENGTH), secret: clean.slice(LOOKUP_LENGTH) };
}

export function pairingTagKey(secret) {
  return base64(pbkdf2Sync(secret, 'tapapprove-pair-v1', PBKDF2_ROUNDS, 32, 'sha256'));
}

export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const fromUrl = (value) => base64(Buffer.from(value, 'base64url'));
  return {
    publicKey: fromUrl(publicKey.export({ format: 'jwk' }).x),
    privateKey: fromUrl(privateKey.export({ format: 'jwk' }).d),
  };
}

const hmac = (key, ...parts) => {
  const mac = createHmac('sha256', raw(key));
  for (const part of parts) mac.update(part);
  return base64(mac.digest());
};

export const cliTag = (tagKey, cliPublicKey) => hmac(tagKey, 'cli', raw(cliPublicKey));

export const watchTag = (tagKey, cliPublicKey, watchPublicKey) =>
  hmac(tagKey, 'watch', raw(watchPublicKey), raw(cliPublicKey));

const sameText = (a, b) => {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && timingSafeEqual(left, right);
};

export const tagMatches = sameText;

// The fixed PKCS8 header for a raw X25519 private key.
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

export function deriveKeys({ tagKey, cliPublicKey, watchPublicKey, privateKey, peerPublicKey }) {
  const shared = diffieHellman({
    privateKey: createPrivateKey({
      key: Buffer.concat([X25519_PKCS8_PREFIX, raw(privateKey)]),
      format: 'der',
      type: 'pkcs8',
    }),
    publicKey: createPublicKey({
      key: { kty: 'OKP', crv: 'X25519', x: raw(peerPublicKey).toString('base64url') },
      format: 'jwk',
    }),
  });
  const info = Buffer.concat([Buffer.from('tapapprove-v1'), raw(cliPublicKey), raw(watchPublicKey)]);
  const keys = Buffer.from(hkdfSync('sha256', shared, raw(tagKey), info, 96));
  return {
    requestKey: base64(keys.subarray(0, 32)),
    answerKey: base64(keys.subarray(32, 64)),
    proofKey: base64(keys.subarray(64, 96)),
  };
}

/** `label` ties the text to one request, so the relay cannot move it to another. */
export function seal(key, text, label) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', raw(key), nonce);
  cipher.setAAD(Buffer.from(label));
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return base64(Buffer.concat([nonce, body, cipher.getAuthTag()]));
}

export function open(key, sealed, label) {
  const bytes = raw(sealed);
  const decipher = createDecipheriv('aes-256-gcm', raw(key), bytes.subarray(0, NONCE_BYTES));
  decipher.setAAD(Buffer.from(label));
  decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
  const body = bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export function decisionProof(proofKey, { id, decision, option, sealedMessage }) {
  return hmac(proofKey, `decision\n${id}\n${decision}\n${option ?? ''}\n${sealedMessage ?? ''}`);
}

export function verifyDecision(proofKey, answer) {
  return typeof answer.proof === 'string' && sameText(decisionProof(proofKey, answer), answer.proof);
}
