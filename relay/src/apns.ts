// Sends alert pushes to the watch. Uses only Web Crypto and fetch, so it runs in a
// Worker without a push library.

export interface ApnsEnv {
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_TOPIC?: string;
}

export interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  topic: string;
}

export type DeviceEnv = 'sandbox' | 'production';

export interface PushDevice {
  token: string;
  env: DeviceEnv;
}

export interface PushSummary {
  id: string;
  title: string;
  detail: string;
  project?: string;
  expiresAt?: number;
  truncated?: boolean;
  options?: string[];
}

export interface PushResult {
  sent: boolean;
  dead: boolean;
}

const MAX_BODY = 178;
// APNs refuses tokens older than an hour and rate limits new ones, so reuse for 50 minutes.
const TOKEN_LIFETIME_MS = 50 * 60 * 1000;

export function apnsConfig(env: ApnsEnv): ApnsConfig | null {
  const { APNS_KEY_P8: keyP8, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_TOPIC: topic } = env;
  return keyP8 && keyId && teamId && topic ? { keyP8, keyId, teamId, topic } : null;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

function importSigningKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function buildJwt(config: ApnsConfig, issuedAtSeconds: number): Promise<string> {
  const unsigned = `${encodeJson({ alg: 'ES256', kid: config.keyId })}.${encodeJson({ iss: config.teamId, iat: issuedAtSeconds })}`;
  const key = await importSigningKey(config.keyP8);
  // Web Crypto already returns raw r||s, the form JOSE requires.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

let cachedToken: { keyId: string; jwt: string; issuedAt: number } | null = null;

async function providerToken(config: ApnsConfig, now: number): Promise<string> {
  const age = cachedToken ? now - cachedToken.issuedAt : -1;
  if (cachedToken?.keyId === config.keyId && age >= 0 && age < TOKEN_LIFETIME_MS) return cachedToken.jwt;
  const jwt = await buildJwt(config, Math.floor(now / 1000));
  cachedToken = { keyId: config.keyId, jwt, issuedAt: now };
  return jwt;
}

export function buildPayload({ id, title, detail, project, truncated, options }: PushSummary) {
  // The notification offers Approve only when it can show the whole request, and a session
  // answer only when it can also show what that answer allows.
  const option = options?.[0];
  const whole = option ? `${detail}\n\n${option}` : detail;
  const fits = whole.length <= MAX_BODY && !truncated;
  return {
    aps: {
      alert: {
        title,
        ...(project ? { subtitle: project } : {}),
        body: fits ? whole || 'Tap to review' : detail.length <= MAX_BODY ? detail || 'Tap to review' : `${detail.slice(0, MAX_BODY)}…`,
      },
      category: !fits ? 'TAPAPPROVE_REVIEW' : option ? 'TAPAPPROVE_QUICK_SESSION' : 'TAPAPPROVE_QUICK',
      sound: 'default',
    },
    requestId: id,
  };
}

export async function sendPush(
  config: ApnsConfig,
  device: PushDevice,
  summary: PushSummary,
  { fetchFn = fetch, now = Date.now() }: { fetchFn?: typeof fetch; now?: number } = {},
): Promise<PushResult> {
  const host = device.env === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  try {
    const response = await fetchFn(`https://${host}/3/device/${device.token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${await providerToken(config, now)}`,
        'apns-topic': config.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor((summary.expiresAt ?? 0) / 1000)),
      },
      body: JSON.stringify(buildPayload(summary)),
    });
    if (response.ok) return { sent: true, dead: false };
    if (response.status === 410) return { sent: false, dead: true };
    const { reason } = await response.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
    return { sent: false, dead: reason === 'BadDeviceToken' };
  } catch {
    return { sent: false, dead: false };
  }
}
