// One Durable Object per pairing. It is the single place that decides who may do
// what and whether a request is still open, which keeps "first decision wins" and
// "a code works once" free of races.

import { DurableObject } from 'cloudflare:workers';
import { apnsConfig, sendPush, type DeviceEnv } from './apns.ts';
import { errorResponse, HttpError, json, pairKey, randomBase64url, readJson, sha256Hex, type PairKey } from './http.ts';
import type { Env } from './index.ts';

type Role = 'watch' | 'cli';
type Status = 'pending' | 'allow' | 'deny' | 'expired' | 'cancelled';

interface Meta {
  channelId: string;
  watchHash: string;
  cliHash: string | null;
  codeExpiresAt: number;
  apnsToken: string | null;
  apnsEnv: DeviceEnv | null;
  lastWatchSeenAt: number | null;
  cliKey: PairKey | null;
  watchKey: PairKey | null;
}

/** All the relay holds about a request. It cannot read `sealed`, and it cannot make `proof`. */
interface RequestRecord {
  id: string;
  sealed: string;
  preview?: string;
  createdAt: number;
  expiresAt: number;
  status: Status;
  option?: number;
  proof?: string;
  sealedMessage?: string;
}

const META_KEY = 'meta';
const REQUEST_PREFIX = 'req:';
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PROOF = 128;
const MAX_OPTION = 9;
const MAX_SEALED_MESSAGE = 8000;
const DEFAULT_TTL_SECONDS = 90;
const MAX_TTL_SECONDS = 300;
const MAX_LONG_POLL_SECONDS = 30;
const MAX_PENDING = 20;
const SEEN_WRITE_GAP_MS = 15_000;
const RETENTION_MS = 10 * 60 * 1000;

const makeToken = (channelId: string) => `${channelId}.${randomBase64url(32)}`;

const currentStatus = (record: RequestRecord, now: number): Status =>
  record.status === 'pending' && now >= record.expiresAt ? 'expired' : record.status;

export class ChannelDO extends DurableObject<Env> {
  /** Long-polls parked on a request. In memory is enough, since an open request keeps the object alive. */
  private waiters = new Map<string, Set<() => void>>();

  // Called by the Worker over RPC.

  async init(channelId: string, expiresInSeconds: number): Promise<string> {
    const watchToken = makeToken(channelId);
    const codeExpiresAt = Date.now() + expiresInSeconds * 1000;
    const meta: Meta = {
      channelId,
      watchHash: await sha256Hex(watchToken),
      cliHash: null,
      codeExpiresAt,
      apnsToken: null,
      apnsEnv: null,
      lastWatchSeenAt: null,
      cliKey: null,
      watchKey: null,
    };
    await this.ctx.storage.put(META_KEY, meta);
    await this.ctx.storage.setAlarm(codeExpiresAt);
    return watchToken;
  }

  async claim(cliKey: PairKey): Promise<string | null> {
    const meta = await this.meta();
    if (!meta || meta.cliHash || Date.now() >= meta.codeExpiresAt) return null;
    const cliToken = makeToken(meta.channelId);
    await this.saveMeta({ ...meta, cliHash: await sha256Hex(cliToken), cliKey });
    return cliToken;
  }

  // Authenticated routes, forwarded by the Worker.

  override async fetch(request: Request): Promise<Response> {
    try {
      const meta = await this.meta();
      const role = meta ? await this.roleFor(meta, request) : null;
      if (!meta || !role) throw new HttpError(401, 'unauthorized');
      return await this.route(meta, role, request);
    } catch (error) {
      return errorResponse(error);
    }
  }

  private async route(meta: Meta, role: Role, request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    const need = (required: Role) => {
      if (role !== required) throw new HttpError(403, 'forbidden');
    };

    if (key === 'GET /v1/status') return this.status(meta, role);
    if (key === 'DELETE /v1/pair') return this.revoke();
    if (key === 'PUT /v1/pair/key') {
      need('watch');
      return this.publishWatchKey(meta, request);
    }
    if (key === 'GET /v1/pair/key') {
      need('cli');
      return json({ key: meta.watchKey });
    }
    if (key === 'PUT /v1/device') {
      need('watch');
      return this.registerDevice(meta, request);
    }
    if (key === 'POST /v1/requests') {
      need('cli');
      return this.createRequest(meta, request);
    }
    if (key === 'GET /v1/requests') {
      need('watch');
      return this.listPending(meta);
    }

    const decision = url.pathname.match(/^\/v1\/requests\/([^/]+)\/decision$/);
    if (decision?.[1] && request.method === 'POST') {
      need('watch');
      return this.decide(decision[1], request);
    }
    const single = url.pathname.match(/^\/v1\/requests\/([^/]+)$/);
    if (single?.[1] && request.method === 'GET') {
      need('cli');
      return this.pollRequest(single[1], url);
    }
    if (single?.[1] && request.method === 'DELETE') {
      need('cli');
      return this.cancel(single[1]);
    }
    throw new HttpError(404, 'not_found');
  }

  private async status(meta: Meta, role: Role): Promise<Response> {
    const now = Date.now();
    const records = await this.allRequests();
    return json({
      paired: meta.cliHash !== null,
      role,
      peerKey: role === 'watch' ? meta.cliKey : undefined,
      hasPushToken: meta.apnsToken !== null,
      lastWatchSeenAt: meta.lastWatchSeenAt,
      pending: records.filter((record) => currentStatus(record, now) === 'pending').length,
    });
  }

  private async revoke(): Promise<Response> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    for (const id of this.waiters.keys()) this.wake(id);
    return json({ ok: true });
  }

  private async registerDevice(meta: Meta, request: Request): Promise<Response> {
    const { apnsToken, env } = await readJson(request);
    // This value becomes part of the APNs URL, so accept only what a real token looks like.
    if (typeof apnsToken !== 'string' || !/^[0-9a-fA-F]{32,200}$/.test(apnsToken)) {
      throw new HttpError(400, 'invalid_token');
    }
    if (env !== 'sandbox' && env !== 'production') throw new HttpError(400, 'invalid_env');
    await this.saveMeta({ ...meta, apnsToken, apnsEnv: env });
    return json({ ok: true });
  }

  private async publishWatchKey(meta: Meta, request: Request): Promise<Response> {
    if (meta.watchKey) throw new HttpError(409, 'key_already_set');
    const watchKey = pairKey(await readJson(request));
    if (!watchKey) throw new HttpError(400, 'invalid_key');
    await this.saveMeta({ ...meta, watchKey });
    return json({ ok: true });
  }

  private async createRequest(meta: Meta, request: Request): Promise<Response> {
    const body = await readJson(request);
    if (typeof body.id !== 'string' || !REQUEST_ID.test(body.id)) throw new HttpError(400, 'invalid_id');
    if (typeof body.sealed !== 'string' || body.sealed.length === 0) throw new HttpError(400, 'invalid_request');
    if (await this.ctx.storage.get(REQUEST_PREFIX + body.id)) throw new HttpError(409, 'duplicate_id');

    const now = Date.now();
    const pending = (await this.allRequests()).filter((record) => currentStatus(record, now) === 'pending');
    if (pending.length >= MAX_PENDING) throw new HttpError(429, 'too_many_pending');

    const ttl = typeof body.ttlSeconds === 'number' ? body.ttlSeconds : DEFAULT_TTL_SECONDS;
    const record: RequestRecord = {
      id: body.id,
      sealed: body.sealed,
      ...(typeof body.preview === 'string' ? { preview: body.preview } : {}),
      createdAt: now,
      expiresAt: now + Math.min(Math.max(ttl, 1), MAX_TTL_SECONDS) * 1000,
      status: 'pending',
    };
    await this.ctx.storage.put(REQUEST_PREFIX + record.id, record);
    await this.ensureCleanup(now);

    const pushed = await this.push(meta, record);
    return json({ id: record.id, expiresAt: record.expiresAt, pushed });
  }

  private async push(meta: Meta, record: RequestRecord): Promise<boolean> {
    if (!meta.apnsToken || !meta.apnsEnv) return false;
    const config = apnsConfig(this.env, meta.apnsEnv);
    if (!config) return false;
    const result = await sendPush(config, { token: meta.apnsToken, env: meta.apnsEnv }, record);
    if (result.dead) await this.saveMeta({ ...meta, apnsToken: null, apnsEnv: null });
    return result.sent;
  }

  private async listPending(meta: Meta): Promise<Response> {
    const now = Date.now();
    if (meta.lastWatchSeenAt === null || now - meta.lastWatchSeenAt > SEEN_WRITE_GAP_MS) {
      await this.saveMeta({ ...meta, lastWatchSeenAt: now });
    }
    const requests = (await this.allRequests())
      .filter((record) => currentStatus(record, now) === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ id, sealed, createdAt, expiresAt }) => ({ id, sealed, createdAt, expiresAt }));
    return json({ requests, serverTime: now });
  }

  private async pollRequest(id: string, url: URL): Promise<Response> {
    const record = await this.requireRequest(id);
    const wait = Math.min(Number(url.searchParams.get('wait')) || 0, MAX_LONG_POLL_SECONDS);
    const now = Date.now();
    if (wait > 0 && currentStatus(record, now) === 'pending') {
      await this.waitForChange(id, Math.min(wait * 1000, record.expiresAt - now));
    }
    const latest = await this.requireRequest(id);
    return json({
      id,
      status: currentStatus(latest, Date.now()),
      option: latest.option,
      proof: latest.proof,
      sealedMessage: latest.sealedMessage,
    });
  }

  private async decide(id: string, request: Request): Promise<Response> {
    const { decision, option, proof, sealedMessage } = await readJson(request);
    if (decision !== 'allow' && decision !== 'deny') throw new HttpError(400, 'invalid_decision');
    const record = await this.requireRequest(id);
    const status = currentStatus(record, Date.now());
    if (status === 'pending') {
      // The computer checks the proof. The relay only refuses what could never be one.
      if (typeof proof !== 'string' || proof.length === 0 || proof.length > MAX_PROOF) {
        throw new HttpError(400, 'invalid_proof');
      }
      record.proof = proof;
      if (decision === 'allow' && option !== undefined) {
        if (!Number.isInteger(option) || (option as number) < 0 || (option as number) > MAX_OPTION) {
          throw new HttpError(400, 'invalid_option');
        }
        record.option = option as number;
      }
      if (decision === 'deny' && sealedMessage !== undefined) {
        if (typeof sealedMessage !== 'string' || sealedMessage.length > MAX_SEALED_MESSAGE) {
          throw new HttpError(400, 'invalid_message');
        }
        record.sealedMessage = sealedMessage;
      }
      await this.finish(record, decision);
      return json({ id, status: decision });
    }
    // A retry after a lost response is fine. A different answer comes too late.
    if (status === decision) return json({ id, status });
    throw new HttpError(409, 'already_closed', { status });
  }

  private async cancel(id: string): Promise<Response> {
    const record = await this.requireRequest(id);
    const status = currentStatus(record, Date.now());
    if (status !== 'pending') return json({ id, status });
    await this.finish(record, 'cancelled');
    return json({ id, status: 'cancelled' });
  }

  /** Scheduled cleanup: drops abandoned pairings and closed requests. */
  override async alarm(): Promise<void> {
    const meta = await this.meta();
    if (!meta) return;
    const now = Date.now();
    if (meta.cliHash === null) {
      if (now >= meta.codeExpiresAt) await this.ctx.storage.deleteAll();
      else await this.ctx.storage.setAlarm(meta.codeExpiresAt);
      return;
    }
    let remaining = 0;
    for (const record of await this.allRequests()) {
      if (currentStatus(record, now) !== 'pending' && now - record.expiresAt > RETENTION_MS) {
        await this.ctx.storage.delete(REQUEST_PREFIX + record.id);
      } else {
        remaining += 1;
      }
    }
    if (remaining > 0) await this.ctx.storage.setAlarm(now + RETENTION_MS);
  }

  // Helpers.

  private meta(): Promise<Meta | undefined> {
    return this.ctx.storage.get<Meta>(META_KEY);
  }

  private saveMeta(meta: Meta): Promise<void> {
    return this.ctx.storage.put(META_KEY, meta);
  }

  private async roleFor(meta: Meta, request: Request): Promise<Role | null> {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    if (!token) return null;
    const hash = await sha256Hex(token);
    if (hash === meta.watchHash) return 'watch';
    if (hash === meta.cliHash) return 'cli';
    return null;
  }

  private async allRequests(): Promise<RequestRecord[]> {
    const records = await this.ctx.storage.list<RequestRecord>({ prefix: REQUEST_PREFIX });
    return [...records.values()];
  }

  private async requireRequest(id: string): Promise<RequestRecord> {
    const record = await this.ctx.storage.get<RequestRecord>(REQUEST_PREFIX + id);
    if (!record) throw new HttpError(404, 'not_found');
    return record;
  }

  /** Closes a request and drops its text, which nothing needs once it is answered. */
  private async finish(record: RequestRecord, status: Status): Promise<void> {
    await this.ctx.storage.put(REQUEST_PREFIX + record.id, { ...record, status, sealed: '', preview: undefined });
    this.wake(record.id);
  }

  private async ensureCleanup(now: number): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + RETENTION_MS);
  }

  private waitForChange(id: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const waiters = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, waiters);
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        if (waiters.size === 0) this.waiters.delete(id);
        resolve();
      };
      const timer = setTimeout(done, Math.max(timeoutMs, 0));
      waiters.add(done);
    });
  }

  private wake(id: string): void {
    for (const done of [...(this.waiters.get(id) ?? [])]) done();
  }
}
