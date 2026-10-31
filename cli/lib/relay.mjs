const REQUEST_TIMEOUT_MS = 15_000;
const LONG_POLL_SECONDS = 25;
const MAX_NETWORK_FAILURES = 3;
// A relay that answers instantly must not turn the wait into a busy loop.
const MIN_POLL_GAP_MS = 250;

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
    claim: (code, name) => call('POST', '/v1/pair/claim', { body: { code, name } }),
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

/** Resolves to the request's final status, or 'timeout' if the deadline passes first. */
export async function waitForDecision(client, id, waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1000;
  let failures = 0;
  while (Date.now() < deadline) {
    const started = Date.now();
    const remaining = Math.ceil((deadline - started) / 1000);
    try {
      const { status } = await client.poll(id, Math.min(LONG_POLL_SECONDS, remaining));
      failures = 0;
      if (status !== 'pending') return status;
    } catch (error) {
      if (error.status || ++failures >= MAX_NETWORK_FAILURES) throw error;
    }
    const elapsed = Date.now() - started;
    if (elapsed < MIN_POLL_GAP_MS) await delay(MIN_POLL_GAP_MS - elapsed);
  }
  return 'timeout';
}
