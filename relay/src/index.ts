// Worker entry point. Pairing is public; everything else carries a token whose
// first part names the channel, and the channel's Durable Object checks the rest.

import type { ApnsEnv } from './apns.ts';
import { ChannelDO } from './channel.ts';
import { errorResponse, HttpError, json, pairKey, readJson } from './http.ts';

export { ChannelDO };

export interface Env extends ApnsEnv {
  CHANNEL: DurableObjectNamespace<ChannelDO>;
  PAIR_CODES: KVNamespace;
  PAIR_RATE_LIMITER: RateLimit;
}

const CODE_TTL_SECONDS = 600;
// The relay sees only this part of the code the watch shows. The rest never leaves the devices.
const CODE_LENGTH = 4;
// 32 letters and digits without the look-alikes 0, O, 1 and I.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CODE_ATTEMPTS = 5;
const TOKEN_SHAPE = /^Bearer ([0-9a-f]{32})\.[A-Za-z0-9_-]{43}$/;

const codeKey = (code: string) => `code:${code}`;

function randomCode(): string {
  // 256 is a multiple of 32, so the remainder is unbiased.
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

async function unusedCode(env: Env): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = randomCode();
    if ((await env.PAIR_CODES.get(codeKey(code))) === null) return code;
  }
  throw new HttpError(503, 'no_code_available');
}

/** Pairing is the only public surface, so it is the part that needs a limit. */
async function limitPairing(request: Request, env: Env, action: string): Promise<void> {
  const client = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const { success } = await env.PAIR_RATE_LIMITER.limit({ key: `${action}:${client}` });
  if (!success) throw new HttpError(429, 'rate_limited');
}

async function startPairing(request: Request, env: Env): Promise<Response> {
  await limitPairing(request, env, 'start');
  const channelId = crypto.randomUUID().replace(/-/g, '');
  const code = await unusedCode(env);
  const channel = env.CHANNEL.get(env.CHANNEL.idFromName(channelId));
  const watchToken = await channel.init(channelId, CODE_TTL_SECONDS);
  await env.PAIR_CODES.put(codeKey(code), channelId, { expirationTtl: CODE_TTL_SECONDS });
  return json({ code, watchToken, expiresIn: CODE_TTL_SECONDS });
}

async function claimPairing(request: Request, env: Env): Promise<Response> {
  await limitPairing(request, env, 'claim');
  const body = await readJson(request);
  if (typeof body.code !== 'string') throw new HttpError(400, 'invalid_code');
  const cliKey = pairKey(body);
  if (!cliKey) throw new HttpError(400, 'invalid_key');
  const code = body.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const channelId = await env.PAIR_CODES.get(codeKey(code));
  if (!channelId) throw new HttpError(404, 'invalid_code');
  const claimed = await env.CHANNEL.get(env.CHANNEL.idFromName(channelId)).claim(cliKey);
  if (!claimed) throw new HttpError(404, 'invalid_code');
  await env.PAIR_CODES.delete(codeKey(code));
  return json({ cliToken: claimed });
}

function forwardToChannel(request: Request, env: Env): Promise<Response> {
  const channelId = request.headers.get('authorization')?.match(TOKEN_SHAPE)?.[1];
  if (!channelId) throw new HttpError(401, 'unauthorized');
  return env.CHANNEL.get(env.CHANNEL.idFromName(channelId)).fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname}`;
    try {
      if (route === 'GET /healthz') return json({ ok: true });
      if (route === 'POST /v1/pair/start') return await startPairing(request, env);
      if (route === 'POST /v1/pair/claim') return await claimPairing(request, env);
      if (pathname.startsWith('/v1/')) return await forwardToChannel(request, env);
      throw new HttpError(404, 'not_found');
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;
