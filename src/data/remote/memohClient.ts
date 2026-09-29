import type { Turn } from '../../core/conversation/types';
import type { PingResponse } from '../../core/identity/capabilities';

/**
 * Minimal Memoh REST client. Never logs or echoes the token; errors carry the
 * server's `message` (all Memoh errors use `{message}`, verified on the dev
 * stack) but never the request headers.
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'malformed';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get unauthorized() {
    return this.kind === 'http' && this.status === 401;
  }
}

export type FetchResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};
export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<FetchResponse>;

export type LoginResponse = Readonly<{
  access_token: string;
  token_type: string;
  expires_at: string;
  user_id: string;
  role?: string;
  display_name?: string;
  username?: string;
  timezone?: string;
}>;
export type TokenResponse = Readonly<{ access_token: string; token_type: string; expires_at: string }>;
export type Account = Readonly<{ id: string; username: string; display_name?: string; role?: string }>;
export type BotSummary = Readonly<{
  id: string;
  name?: string;
  display_name?: string;
  status?: string;
  is_active?: boolean;
}>;

export type Timed<T> = Readonly<{ body: T; serverDate: string | null }>;

export type SessionSummary = Readonly<{
  id: string;
  bot_id: string;
  title?: string;
  type?: string;
  channel_type?: string;
  created_by_user_id?: string;
  created_at?: string;
  updated_at?: string;
}>;

const DEFAULT_TIMEOUT_MS = 15_000;

export class MemohClient {
  constructor(
    readonly baseUrl: string,
    private readonly fetchFn: FetchFn,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<Timed<T>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: FetchResponse;
    let text: string;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if (controller.signal.aborted) throw new ApiError('timeout', 'The server did not answer in time');
      throw new ApiError('network', error instanceof Error ? error.message : 'Network request failed');
    } finally {
      clearTimeout(timer);
    }

    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    if (response.status < 200 || response.status >= 300) {
      const message =
        parsed && typeof parsed === 'object' && typeof (parsed as { message?: unknown }).message === 'string'
          ? (parsed as { message: string }).message
          : `HTTP ${response.status}`;
      throw new ApiError('http', message, response.status);
    }
    if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
      throw new ApiError('malformed', 'The server returned an unexpected response', response.status);
    }
    return { body: parsed as T, serverDate: response.headers.get('date') };
  }

  async ping(): Promise<PingResponse> {
    return (await this.request<PingResponse>('GET', '/ping')).body;
  }

  login(username: string, password: string) {
    return this.request<LoginResponse>('POST', '/auth/login', { body: { username, password } });
  }

  refresh(token: string) {
    return this.request<TokenResponse>('POST', '/auth/refresh', { token });
  }

  async me(token: string): Promise<Account> {
    return (await this.request<Account>('GET', '/users/me', { token })).body;
  }

  async listBots(token: string): Promise<BotSummary[]> {
    const { body } = await this.request<{ items?: BotSummary[] }>('GET', '/bots', { token });
    return body.items ?? [];
  }

  /** Newest first; `nextCursor` is empty on the last page. */
  async listSessions(
    token: string,
    botId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: SessionSummary[]; nextCursor: string; serverDate: string | null }> {
    const query = new URLSearchParams();
    if (options.limit) query.set('limit', String(options.limit));
    if (options.cursor) query.set('cursor', options.cursor);
    const qs = query.toString();
    const { body, serverDate } = await this.request<{ items?: SessionSummary[]; next_cursor?: string }>(
      'GET',
      `/bots/${encodeURIComponent(botId)}/sessions${qs ? `?${qs}` : ''}`,
      { token },
    );
    return { items: body.items ?? [], nextCursor: body.next_cursor ?? '', serverDate };
  }

  /**
   * Not idempotent on servers without U5 (contracts/u5): callers must
   * reconcile a lost response. `client_request_id` makes a U5 server return
   * the existing row; older servers ignore the field.
   */
  async createSession(
    token: string,
    botId: string,
    body: { title?: string; client_request_id?: string } = {},
  ): Promise<SessionSummary> {
    return (
      await this.request<SessionSummary>('POST', `/bots/${encodeURIComponent(botId)}/sessions`, {
        token,
        body: { channel_type: 'local', ...body },
      })
    ).body;
  }

  /** Whether a session has any persisted turn (one-row history probe). */
  async hasHistory(token: string, botId: string, sessionId: string): Promise<boolean> {
    return (await this.listMessages(token, botId, sessionId, { limit: 1 })).length > 0;
  }

  /** Persisted turns, old → new; the page starts on a turn boundary. */
  async listMessages(
    token: string,
    botId: string,
    sessionId: string,
    options: { limit?: number; beforeMessageId?: string } = {},
  ): Promise<Turn[]> {
    const query = new URLSearchParams({ session_id: sessionId });
    if (options.limit) query.set('limit', String(options.limit));
    if (options.beforeMessageId) query.set('before_message_id', options.beforeMessageId);
    const { body } = await this.request<{ items?: Turn[] }>(
      'GET',
      `/bots/${encodeURIComponent(botId)}/messages?${query.toString()}`,
      { token },
    );
    return body.items ?? [];
  }
}
