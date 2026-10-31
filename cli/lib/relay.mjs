const REQUEST_TIMEOUT_MS = 15_000;
const LONG_POLL_SECONDS = 25;
const MAX_NETWORK_FAILURES = 3;
// A relay that answers instantly must not turn the wait into a busy loop.
const MIN_POLL_GAP_MS = 250;
const WATCH_KEY_WAIT_MS = 60_000;
const WATCH_KEY_POLL_MS = 1000;

export class RelayError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function relayClient(baseUrl, token) {
  async function call(method, path, { body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        // A hacked relay must not be able to aim this computer at another address.
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new RelayError(`Could not reach the relay at ${baseUrl} (${error.cause?.code ?? error.name})`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new RelayError(`Relay at ${baseUrl} answered ${response.status}`, { status: response.status, code: data.error });
    }
    return data;
  }

  return {
    claim: (code, key) => call('POST', '/v1/pair/claim', { body: { code, ...key } }),
    watchKey: () => call('GET', '/v1/pair/key'),
    createRequest: (summary) => call('POST', '/v1/requests', { body: summary }),
    poll: (id, waitSeconds) =>
      call('GET', `/v1/requests/${encodeURIComponent(id)}?wait=${waitSeconds}`, {
        timeoutMs: (waitSeconds + 10) * 1000,
      }),
    cancel: (id) => call('DELETE', `/v1/requests/${encodeURIComponent(id)}`, { timeoutMs: 3000 }),
    status: () => call('GET', '/v1/status'),
    revoke: () => call('DELETE', '/v1/pair', { timeoutMs: 5000 }),
  };
}

/** Resolves to the watch's half of the key exchange, or null if it does not arrive in time. */
export async function waitForWatchKey(client) {
  const deadline = Date.now() + WATCH_KEY_WAIT_MS;
  while (Date.now() < deadline) {
    const { key } = await client.watchKey();
    if (key) return key;
    await delay(WATCH_KEY_POLL_MS);
  }
  return null;
}

/** Resolves to the request's final answer as sent, unverified. Its status is 'timeout' if the deadline passes first. */
export async function waitForDecision(client, id, waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1000;
  let failures = 0;
  while (Date.now() < deadline) {
    const started = Date.now();
    const remaining = Math.ceil((deadline - started) / 1000);
    try {
      const answer = await client.poll(id, Math.min(LONG_POLL_SECONDS, remaining));
      failures = 0;
      if (answer.status !== 'pending') return answer;
    } catch (error) {
      if (error.status || ++failures >= MAX_NETWORK_FAILURES) throw error;
    }
    const elapsed = Date.now() - started;
    if (elapsed < MIN_POLL_GAP_MS) await delay(MIN_POLL_GAP_MS - elapsed);
  }
  return { status: 'timeout' };
}
