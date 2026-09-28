/**
 * Client for the optional invocation lookup (contracts/u4-invocation-lookup.md).
 * Released servers do not have this route, so every response is classified
 * strictly: only a well-formed answer about *this* invocation counts, and a
 * failed or odd lookup never implies "not sent".
 */
export type LookupOutcome =
  | Readonly<{ kind: 'found'; runId: string; turnId: string; state?: string }>
  /** The server has no admission for this invocation: resending is safe. */
  | Readonly<{ kind: 'not_found' }>
  /** The route does not exist on this server build. */
  | Readonly<{ kind: 'unsupported' }>
  /** No usable answer this time (auth, network, 5xx, session gone). */
  | Readonly<{ kind: 'unavailable'; reason: string }>;

export type LookupResponse = Readonly<{ status: number; contentType: string; body: string }>;

type LookupBody = {
  found?: unknown;
  invocation_id?: unknown;
  session_id?: unknown;
  run_id?: unknown;
  turn_id?: unknown;
  state?: unknown;
  message?: unknown;
};

function parseJson(response: LookupResponse): LookupBody | null {
  if (!/\bjson\b/i.test(response.contentType)) return null;
  try {
    const value: unknown = JSON.parse(response.body);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as LookupBody) : null;
  } catch {
    return null;
  }
}

export function classifyLookupResponse(
  response: LookupResponse,
  expected: Readonly<{ sessionId: string; invocationId: string }>,
): LookupOutcome {
  const body = parseJson(response);

  if (response.status === 200) {
    // A proxy or SPA fallback can answer 200 with HTML or an unrelated JSON body.
    if (!body || typeof body.found !== 'boolean' || body.invocation_id !== expected.invocationId) {
      return { kind: 'unsupported' };
    }
    if (body.session_id !== undefined && body.session_id !== expected.sessionId) {
      return { kind: 'unavailable', reason: 'session_mismatch' };
    }
    if (!body.found) return { kind: 'not_found' };
    if (typeof body.run_id !== 'string' || typeof body.turn_id !== 'string') {
      return { kind: 'unavailable', reason: 'malformed' };
    }
    return {
      kind: 'found',
      runId: body.run_id,
      turnId: body.turn_id,
      ...(typeof body.state === 'string' ? { state: body.state } : {}),
    };
  }

  if (response.status === 404) {
    // The handler's own 404 means the route exists but the session is gone.
    return body?.message === 'session not found'
      ? { kind: 'unavailable', reason: 'session_not_found' }
      : { kind: 'unsupported' };
  }
  if (response.status === 405 || response.status === 501) return { kind: 'unsupported' };
  if (response.status === 401 || response.status === 403) return { kind: 'unavailable', reason: 'auth' };
  return { kind: 'unavailable', reason: `http_${response.status}` };
}

export type LookupRequest = Readonly<{
  baseUrl: string;
  accessToken: string;
  botId: string;
  sessionId: string;
  invocationId: string;
}>;

type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export async function lookupInvocation(
  fetchFn: FetchLike,
  request: LookupRequest,
  signal?: AbortSignal,
): Promise<LookupOutcome> {
  const path = [
    'bots',
    request.botId,
    'sessions',
    request.sessionId,
    'invocations',
    request.invocationId,
  ].map(encodeURIComponent);
  const url = `${request.baseUrl.replace(/\/+$/, '')}/${path.join('/')}`;
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${request.accessToken}`, accept: 'application/json' },
      signal,
    });
    return classifyLookupResponse(
      { status: response.status, contentType: response.headers.get('content-type') ?? '', body: await response.text() },
      request,
    );
  } catch {
    return { kind: 'unavailable', reason: 'network' };
  }
}
