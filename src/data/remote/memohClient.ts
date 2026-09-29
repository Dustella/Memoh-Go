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
    /** Machine-readable problem code (`code` in Memoh's problem+json bodies), when present. */
    readonly code?: string,
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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: { token?: string; body?: unknown; allowEmpty?: boolean } = {},
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
      // Legacy errors are `{message}`; newer handlers answer problem+json `{detail, code}`.
      const problem = parsed && typeof parsed === 'object' ? (parsed as { message?: unknown; detail?: unknown; code?: unknown }) : {};
      const message =
        typeof problem.message === 'string' ? problem.message : typeof problem.detail === 'string' ? problem.detail : `HTTP ${response.status}`;
      throw new ApiError('http', message, response.status, typeof problem.code === 'string' ? problem.code : undefined);
    }
    if (options.allowEmpty && text.length === 0) return { body: {} as T, serverDate: response.headers.get('date') };
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

  // ------------------------------------------------------------ follow-up / steer queue (CH-13)

  private queuePath(botId: string, sessionId: string, rest: string) {
    return `/bots/${encodeURIComponent(botId)}/sessions/${encodeURIComponent(sessionId)}/${rest}`;
  }

  /** Pending steer and follow-up items plus whether the active run accepts steering. */
  async getQueue(token: string, botId: string, sessionId: string): Promise<SessionQueue> {
    const { body } = await this.request<Partial<SessionQueue>>('GET', this.queuePath(botId, sessionId, 'queue'), { token });
    return { steer_supported: body.steer_supported === true, steer: body.steer ?? [], follow_up: body.follow_up ?? [] };
  }

  /** Idempotent by `invocation_id`: a replay with the same text returns the same item. */
  async enqueue(token: string, botId: string, sessionId: string, kind: QueueKind, body: { invocation_id: string; text: string }): Promise<QueueItem> {
    const rest = kind === 'steer' ? 'steer-queue' : 'follow-up-queue';
    return (await this.request<QueueItem>('POST', this.queuePath(botId, sessionId, rest), { token, body })).body;
  }

  async cancelQueueItem(token: string, botId: string, sessionId: string, kind: QueueKind, itemId: string): Promise<void> {
    const rest = `${kind === 'steer' ? 'steer-queue' : 'follow-up-queue'}/${encodeURIComponent(itemId)}`;
    await this.request('DELETE', this.queuePath(botId, sessionId, rest), { token, allowEmpty: true });
  }

  async promoteFollowUp(token: string, botId: string, sessionId: string, itemId: string): Promise<QueueItem> {
    const rest = `follow-up-queue/${encodeURIComponent(itemId)}/steer`;
    return (await this.request<QueueItem>('POST', this.queuePath(botId, sessionId, rest), { token, allowEmpty: true })).body;
  }

  // ------------------------------------------------------------ Bot detail (AD-01)

  async getBot(token: string, botId: string): Promise<BotDetail> {
    return (await this.request<BotDetail>('GET', `/bots/${encodeURIComponent(botId)}`, { token })).body;
  }

  async listBotChecks(token: string, botId: string): Promise<BotCheck[]> {
    const { body } = await this.request<{ items?: BotCheck[] }>('GET', `/bots/${encodeURIComponent(botId)}/checks`, { token });
    return body.items ?? [];
  }

  async memoryUsage(token: string, botId: string): Promise<{ count: number }> {
    const { body } = await this.request<{ count?: number }>('GET', `/bots/${encodeURIComponent(botId)}/memory/usage`, { token });
    return { count: body.count ?? 0 };
  }

  async countSchedules(token: string, botId: string): Promise<number> {
    const { body } = await this.request<{ items?: unknown[] }>('GET', `/bots/${encodeURIComponent(botId)}/schedule`, { token });
    return body.items?.length ?? 0;
  }

  async countWorkdirs(token: string, botId: string): Promise<number> {
    const { body } = await this.request<{ workdirs?: unknown[] }>('GET', `/bots/${encodeURIComponent(botId)}/workdirs`, { token });
    return body.workdirs?.length ?? 0;
  }

  // ------------------------------------------------------------ resources (M4)

  private bot(botId: string, rest: string) {
    return `/bots/${encodeURIComponent(botId)}${rest}`;
  }

  async getContainer(token: string, botId: string): Promise<ContainerInfo> {
    return (await this.request<ContainerInfo>('GET', this.bot(botId, '/container'), { token })).body;
  }

  async getContainerMetrics(token: string, botId: string): Promise<ContainerMetrics> {
    return (await this.request<ContainerMetrics>('GET', this.bot(botId, '/container/metrics'), { token })).body;
  }

  async listWorkspaceTargets(token: string, botId: string): Promise<WorkspaceTarget[]> {
    const { body } = await this.request<{ targets?: WorkspaceTarget[] }>('GET', this.bot(botId, '/workspace-targets'), { token });
    return body.targets ?? [];
  }

  async listWorkdirs(token: string, botId: string): Promise<Workdir[]> {
    const { body } = await this.request<{ workdirs?: Workdir[] }>('GET', this.bot(botId, '/workdirs'), { token });
    return body.workdirs ?? [];
  }

  async listFiles(token: string, botId: string, path: string): Promise<FsEntry[]> {
    const { body } = await this.request<{ entries?: FsEntry[] }>('GET', this.bot(botId, `/container/fs/list?path=${encodeURIComponent(path)}`), { token });
    return body.entries ?? [];
  }

  async statFile(token: string, botId: string, path: string): Promise<FsEntry> {
    return (await this.request<FsEntry>('GET', this.bot(botId, `/container/fs?path=${encodeURIComponent(path)}`), { token })).body;
  }

  async readFile(token: string, botId: string, path: string): Promise<{ content: string; size: number; revision?: string }> {
    const { body } = await this.request<{ content?: string; size?: number; revision?: string }>(
      'GET',
      this.bot(botId, `/container/fs/read?path=${encodeURIComponent(path)}`),
      { token },
    );
    return { content: body.content ?? '', size: body.size ?? 0, revision: body.revision };
  }

  /** Binary download (images, sharing). Send the token as a header, never in the URL. */
  downloadUrl(botId: string, path: string) {
    return `${this.baseUrl}${this.bot(botId, `/container/fs/download?path=${encodeURIComponent(path)}`)}`;
  }

  /** FL-04: multipart upload target (`path` = full destination path, `file`). */
  uploadUrl(botId: string) {
    return `${this.baseUrl}${this.bot(botId, '/container/fs/upload')}`;
  }

  async listSchedules(token: string, botId: string): Promise<Schedule[]> {
    const { body } = await this.request<{ items?: Schedule[] }>('GET', this.bot(botId, '/schedule'), { token });
    return body.items ?? [];
  }

  async createSchedule(token: string, botId: string, body: ScheduleInput): Promise<Schedule> {
    return (await this.request<Schedule>('POST', this.bot(botId, '/schedule'), { token, body })).body;
  }

  /** Partial update; `enabled` is how a schedule is switched on and off (there is no separate route). */
  async updateSchedule(token: string, botId: string, id: string, body: Partial<ScheduleInput>): Promise<Schedule> {
    return (await this.request<Schedule>('PUT', this.bot(botId, `/schedule/${encodeURIComponent(id)}`), { token, body })).body;
  }

  async listScheduleLogs(token: string, botId: string, scheduleId?: string, limit = 20): Promise<ScheduleLog[]> {
    const path = scheduleId ? `/schedule/${encodeURIComponent(scheduleId)}/logs` : '/schedule/logs';
    const { body } = await this.request<{ items?: ScheduleLog[] }>('GET', this.bot(botId, `${path}?limit=${limit}`), { token });
    return body.items ?? [];
  }

  async listMemory(token: string, botId: string): Promise<MemoryItem[]> {
    const { body } = await this.request<{ results?: MemoryItem[] | null }>('GET', this.bot(botId, '/memory?no_stats=true'), { token });
    return body.results ?? [];
  }

  async searchMemory(token: string, botId: string, query: string, limit = 30): Promise<MemoryItem[]> {
    const { body } = await this.request<{ results?: MemoryItem[] | null }>('POST', this.bot(botId, '/memory/search'), {
      token,
      body: { query, limit, no_stats: true },
    });
    return body.results ?? [];
  }

  async listModels(token: string): Promise<ModelOption[]> {
    const { body } = await this.request<ModelOption[] | { items?: ModelOption[] }>('GET', '/models', { token });
    return Array.isArray(body) ? body : (body.items ?? []);
  }
}

// ---------------------------------------------------------------- resource shapes (dev stack, 2026-09-29)

export type ContainerInfo = Readonly<{
  container_id?: string;
  workspace_backend?: string;
  image?: string;
  status?: string;
  container_path?: string;
  task_running?: boolean;
  updated_at?: string;
}>;
export type ContainerMetrics = Readonly<{
  supported: boolean;
  unsupported_reason?: string;
  status?: Readonly<{ exists?: boolean; task_running?: boolean }>;
  metrics?: Readonly<{
    cpu?: Readonly<{ usage_percent?: number }>;
    memory?: Readonly<{ usage_bytes?: number; limit_bytes?: number }>;
    storage?: Readonly<{ used_bytes?: number }>;
  }>;
  sampled_at?: string;
}>;
export type WorkspaceTarget = Readonly<{
  target_id: string;
  kind: 'native' | 'remote' | string;
  runtime_id?: string;
  name: string;
  primary?: boolean;
  online?: boolean;
  /** online | offline | revoked | owner_mismatch | client_update_required */
  status?: string;
}>;
export type Workdir = Readonly<{
  id: string;
  name: string;
  target_kind?: string;
  workspace_target_id?: string;
  path: string;
  archived?: boolean;
}>;
export type FsEntry = Readonly<{ name: string; path: string; size: number; mode?: string; modTime?: string; isDir: boolean }>;
export type Schedule = Readonly<{
  id: string;
  name: string;
  description?: string;
  /** Cron expression (5 fields, optional seconds), in the Bot's time zone. */
  pattern: string;
  enabled: boolean;
  command: string;
  max_calls?: number | null;
  current_calls?: number;
  run_target?: string;
  created_at?: string;
  updated_at?: string;
}>;
export type ScheduleInput = Readonly<{
  name: string;
  description?: string;
  pattern: string;
  command: string;
  enabled?: boolean;
  run_target?: 'new_session' | 'existing_session';
}>;
export type ScheduleLog = Readonly<{
  id: string;
  schedule_id: string;
  session_id?: string;
  status: string;
  result_text?: string;
  error_message?: string;
  started_at: string;
  completed_at?: string;
}>;
export type MemoryItem = Readonly<{
  id: string;
  memory: string;
  created_at?: string;
  updated_at?: string;
  score?: number;
  metadata?: Readonly<Record<string, unknown>>;
}>;
export type ModelOption = Readonly<{
  id: string;
  model_id: string;
  name?: string;
  type?: string;
  enable?: boolean;
  reasoning?: Readonly<{ supported?: boolean; can_disable?: boolean; efforts?: readonly string[]; default_effort?: string }>;
}>;

export type QueueKind = 'steer' | 'follow_up';
/** accepted = pending; claimed/applied = taken by the run; the rest are terminal. */
export type QueueStatus = 'accepted' | 'claimed' | 'applied' | 'rejected' | 'expired' | 'canceled';
export type QueueItem = Readonly<{
  item_id: string;
  status: QueueStatus;
  position: number;
  text: string;
  target_run_id?: string;
  enqueued_during_run_id?: string;
}>;
export type SessionQueue = Readonly<{ steer_supported: boolean; steer: QueueItem[]; follow_up: QueueItem[] }>;

/** GET /bots/:id (verified on the dev stack, 2026-09-29). */
export type BotDetail = BotSummary &
  Readonly<{
    owner_user_id?: string;
    avatar_url?: string;
    timezone?: string;
    check_state?: string;
    check_issue_count?: number;
    current_user_permissions?: string[];
    created_at?: string;
    updated_at?: string;
  }>;
export type BotCheck = Readonly<{ id: string; type?: string; title_key?: string; status: string; summary?: string }>;
