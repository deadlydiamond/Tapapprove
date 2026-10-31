const MAX_BODY_BYTES = 512 * 1024;

export class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, ...error.extra }, error.status);
  console.error('Unexpected error', error);
  return json({ error: 'internal' }, 500);
}

/** Parses a JSON object body. An empty body counts as `{}`. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'too_large');
  if (text === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new HttpError(400, 'invalid_json');
  return parsed as Record<string, unknown>;
}

export function randomBase64url(byteCount: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface PairKey {
  publicKey: string;
  tag: string;
}

const KEY_TEXT = /^[A-Za-z0-9+/]{1,64}={0,2}$/;

/** Reads one side of the key exchange. The relay only carries it and cannot use it. */
export function pairKey(body: Record<string, unknown>): PairKey | null {
  const { publicKey, tag } = body;
  if (typeof publicKey !== 'string' || typeof tag !== 'string') return null;
  return KEY_TEXT.test(publicKey) && KEY_TEXT.test(tag) ? { publicKey, tag } : null;
}
