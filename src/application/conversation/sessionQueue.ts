import type { Known } from '../../core/identity/capabilities';
import { t, type MessageKey } from '../../core/i18n';
import { ApiError, MemohClient, type FetchFn, type QueueItem, type QueueKind } from '../../data/remote/memohClient';
import { NeedsSignInError, type ConnectionManager } from '../access/connectService';

/**
 * CH-13: messages typed while the Bot is still replying.
 *
 * - follow_up: queued on the server and run as the next turn when this one
 *   ends (`POST .../follow-up-queue`).
 * - steer: added to the running task at its next step
 *   (`POST .../steer-queue`), offered only while the server reports
 *   `steer_supported` for the active run.
 *
 * Both are idempotent by `invocation_id` (verified on the dev stack: a
 * replay with the same text returns the same item; different text is a 409
 * `session_runtime.invocation_conflict`). A lost response is retried with the
 * same id. The queue endpoints are newer than the oldest supported server, so
 * support is learned from evidence: a route-level 404 means "not supported"
 * and the chat falls back to the Outbox, which holds the message and retries
 * `session_busy` until the run ends (the M2 behaviour).
 *
 * Queued items live on the server; the app keeps none of them on disk. The
 * composer text is only cleared once the server has accepted the item, and
 * is put back whenever it was not.
 */
export type QueueMode = QueueKind;

export type PendingQueueItem = QueueItem & Readonly<{ kind: QueueKind }>;

export type QueueView = Readonly<{
  support: Known;
  /** The active run accepts steering right now. */
  steerSupported: boolean;
  /** Items still waiting (status `accepted`), steer first, in queue order. */
  items: readonly PendingQueueItem[];
  busy: boolean;
  notice: string | null;
}>;

export type SubmitOutcome =
  | Readonly<{ kind: 'queued' }>
  /** Nothing was created and nothing is running: send it as a normal message. */
  | Readonly<{ kind: 'send_now' }>
  /** Not queued; put the text back in the composer. */
  | Readonly<{ kind: 'returned' }>;

export type QueueDeps = Readonly<{
  access: ConnectionManager;
  fetchFn: FetchFn;
  newId: () => string;
  sleep?: (ms: number) => Promise<void>;
}>;

const MAX_ATTEMPTS = 3;
const POLL_MS = 3_000;

const isRouteMissing = (e: unknown) =>
  e instanceof ApiError && e.kind === 'http' && e.status === 404 && !e.code && /^not found$/i.test(e.message.trim());
const definite = (e: unknown) => e instanceof ApiError && e.kind === 'http';

export class SessionQueueController {
  private view: QueueView = { support: 'unknown', steerSupported: false, items: [], busy: false, notice: null };
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly deps: QueueDeps,
    readonly botId: string,
    readonly sessionId: string,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = () => this.view;

  private set(patch: Partial<QueueView>) {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l();
  }

  private call<T>(work: (client: MemohClient, token: string) => Promise<T>): Promise<T> {
    return this.deps.access.withToken((token, session) => work(new MemohClient(session.connection.deployment, this.deps.fetchFn), token));
  }

  /** Re-read the server queue. Polls while items are pending. */
  async refresh() {
    if (this.disposed || this.view.support === 'no') return;
    try {
      const queue = await this.call((c, token) => c.getQueue(token, this.botId, this.sessionId));
      const pending = (kind: QueueKind, items: readonly QueueItem[]) =>
        items.filter((i) => i.status === 'accepted').map((i) => ({ ...i, kind }));
      const items = [...pending('steer', queue.steer), ...pending('follow_up', queue.follow_up)];
      this.set({ support: 'yes', steerSupported: queue.steer_supported, items });
    } catch (e) {
      if (isRouteMissing(e)) this.set({ support: 'no', steerSupported: false, items: [] });
      // Otherwise keep the last view; the next poll or run change tries again.
    }
    this.schedulePoll();
  }

  private schedulePoll() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed || this.view.items.length === 0) return;
    this.timer = setTimeout(() => void this.refresh(), POLL_MS);
  }

  dismissNotice() {
    if (this.view.notice) this.set({ notice: null });
  }

  async submit(mode: QueueMode, text: string): Promise<SubmitOutcome> {
    if (this.view.support === 'no') return { kind: 'send_now' };
    this.set({ busy: true, notice: null });
    try {
      return await this.submitAs(mode === 'steer' && this.view.steerSupported ? 'steer' : 'follow_up', text);
    } finally {
      this.set({ busy: false });
      void this.refresh();
    }
  }

  private returned(key: MessageKey, params?: Record<string, string>): SubmitOutcome {
    this.set({ notice: t(key, params) });
    return { kind: 'returned' };
  }

  private async submitAs(kind: QueueKind, text: string): Promise<SubmitOutcome> {
    const invocationId = this.deps.newId();
    let ambiguous = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.call((c, token) => c.enqueue(token, this.botId, this.sessionId, kind, { invocation_id: invocationId, text }));
        if (this.view.support !== 'yes') this.set({ support: 'yes' });
        return { kind: 'queued' };
      } catch (e) {
        if (e instanceof NeedsSignInError) return { kind: 'returned' };
        if (isRouteMissing(e)) {
          // Route absent: nothing was created, so the Outbox can take it.
          this.set({ support: 'no', steerSupported: false, items: [] });
          return ambiguous ? this.returned('queue.unsupported') : { kind: 'send_now' };
        }
        if (!definite(e)) {
          ambiguous = true;
          if (attempt < MAX_ATTEMPTS) await (this.deps.sleep ?? delay)(400 * attempt);
          continue;
        }
        const code = (e as ApiError).code ?? '';
        if (code === 'queue_no_active_run') {
          // The run ended first. Safe to send normally only if no earlier attempt may have landed.
          return ambiguous ? this.returned('queue.notActive') : { kind: 'send_now' };
        }
        if (kind === 'steer' && /steer_unsupported/.test(code)) {
          this.set({ steerSupported: false, notice: t('queue.steerUnsupported') });
          return this.submitAs('follow_up', text);
        }
        if (/capacity|overloaded/.test(code)) return this.returned('queue.full');
        return this.returned('queue.failed', { message: (e as ApiError).message });
      }
    }
    return this.returned('queue.failed', { message: 'network' });
  }

  async cancel(item: PendingQueueItem) {
    try {
      await this.call((c, token) => c.cancelQueueItem(token, this.botId, this.sessionId, item.kind, item.item_id));
    } catch (e) {
      // Already claimed or gone: the refresh below shows what really happened.
      if (e instanceof NeedsSignInError) return;
    }
    await this.refresh();
  }

  async promote(item: PendingQueueItem) {
    if (item.kind !== 'follow_up') return;
    try {
      await this.call((c, token) => c.promoteFollowUp(token, this.botId, this.sessionId, item.item_id));
    } catch (e) {
      if (e instanceof ApiError && /steer_unsupported/.test(e.code ?? '')) this.set({ steerSupported: false, notice: t('queue.steerUnsupported') });
    }
    await this.refresh();
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
