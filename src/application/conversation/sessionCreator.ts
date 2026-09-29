import type { ScopeKey } from '../../core/identity/scope';
import {
  beginAttempt,
  isCreationOpen,
  newCreation,
  onCreateLost,
  onCreateRejected,
  onCreationColdStart,
  onNotFound,
  reconcileCandidates,
  retryCreation,
  type SessionCreation,
} from '../../core/operations/sessionCreate';
import {
  deleteCreation,
  finalizeCreation,
  loadClaimedSessionIds,
  loadCreation,
  loadUnfinishedCreations,
  saveCreation,
} from '../../data/local/sessionCreationStore';
import type { SqlDatabase } from '../../data/local/sql';
import { ApiError, MemohClient, type FetchFn } from '../../data/remote/memohClient';
import type { ConnectionManager } from '../access/connectService';

export type CreatorDeps = Readonly<{
  db: SqlDatabase;
  access: ConnectionManager;
  fetchFn: FetchFn;
  now: () => number;
  newId: () => string;
}>;

/** How many recent sessions a reconcile inspects. */
const RECONCILE_PAGE = 20;

/** A definite refusal: the request was processed and created nothing. */
function isDefiniteRejection(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.kind === 'http' &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 408, 409, 425, 429].includes(error.status)
  );
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Drives "new chat + first message" intents to a server session
 * (core/operations/sessionCreate.ts). Intents survive process death; the
 * app resumes them on launch and when it returns to the foreground.
 */
export class SessionCreator {
  private readonly known = new Map<string, SessionCreation>();
  private readonly listeners = new Set<() => void>();
  private readonly running = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private snapshot: readonly SessionCreation[] = [];
  private coldStartDone = false;

  constructor(private readonly deps: CreatorDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Every intent seen by this process, including ones created meanwhile. */
  getSnapshot = () => this.snapshot;

  private get scope(): ScopeKey | null {
    const s = this.deps.access.state;
    return s.kind === 'signed_in' ? s.session.scope : null;
  }

  private remember(c: SessionCreation) {
    this.known.set(c.requestId, c);
    this.snapshot = [...this.known.values()].filter((k) => k.scope === this.scope);
    for (const l of this.listeners) l();
  }

  private forget(requestId: string) {
    this.known.delete(requestId);
    this.snapshot = [...this.known.values()].filter((k) => k.scope === this.scope);
    for (const l of this.listeners) l();
  }

  private async save(c: SessionCreation) {
    await saveCreation(this.deps.db, c);
    this.remember(c);
    return c;
  }

  /** Load unfinished intents of the signed-in scope and drive the open ones. */
  async resume() {
    const scope = this.scope;
    if (!scope) {
      this.snapshot = [];
      for (const l of this.listeners) l();
      return;
    }
    const now = this.deps.now();
    for (let c of await loadUnfinishedCreations(this.deps.db, scope)) {
      // A POST in flight when the previous process died may have succeeded.
      if (!this.coldStartDone && !this.running.has(c.requestId)) c = await this.save(onCreationColdStart(c, now));
      else this.remember(c);
      if (isCreationOpen(c)) void this.drive(c.requestId);
    }
    this.coldStartDone = true;
  }

  async create(botId: string, text: string): Promise<SessionCreation> {
    const scope = this.scope;
    if (!scope) throw new Error('Not signed in');
    const c = await this.save(
      newCreation({ requestId: this.deps.newId(), invocationId: this.deps.newId(), scope, botId, text, now: this.deps.now() }),
    );
    void this.drive(c.requestId);
    return c;
  }

  async retry(requestId: string) {
    const c = await loadCreation(this.deps.db, requestId);
    if (!c) return;
    await this.save(retryCreation(c, this.deps.now()));
    void this.drive(requestId);
  }

  /** Drop a failed intent. An open one is never dropped: its session may exist. */
  async discard(requestId: string) {
    const c = await loadCreation(this.deps.db, requestId);
    if (!c || c.status !== 'failed') return;
    await deleteCreation(this.deps.db, requestId);
    this.forget(requestId);
  }

  /** Cancel scheduled retries (tests, sign-out). Intents stay on disk. */
  stop() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private schedule(c: SessionCreation) {
    const existing = this.timers.get(c.requestId);
    if (existing) clearTimeout(existing);
    const delay = Math.max(0, c.nextAttemptAt - this.deps.now());
    this.timers.set(
      c.requestId,
      setTimeout(() => {
        this.timers.delete(c.requestId);
        void this.drive(c.requestId);
      }, delay),
    );
  }

  /** Serialised per intent; loops until created, failed, or waiting on a backoff. */
  private async drive(requestId: string) {
    if (this.running.has(requestId)) return;
    this.running.add(requestId);
    try {
      for (;;) {
        const c = await loadCreation(this.deps.db, requestId);
        if (!c || !isCreationOpen(c) || c.scope !== this.scope) return;
        if (c.nextAttemptAt > this.deps.now()) {
          this.schedule(c);
          return;
        }
        const next = c.status === 'pending' ? await this.attempt(c) : await this.reconcile(c);
        if (!isCreationOpen(next)) return;
        if (next.status === 'unknown' && next.nextAttemptAt > this.deps.now()) {
          this.schedule(next);
          return;
        }
      }
    } finally {
      this.running.delete(requestId);
    }
  }

  private async attempt(c: SessionCreation): Promise<SessionCreation> {
    const started = await this.save(beginAttempt(c, this.deps.now()));
    try {
      const session = await this.deps.access.withToken((token, s) =>
        new MemohClient(s.connection.deployment, this.deps.fetchFn).createSession(token, c.botId, {
          title: c.title,
          client_request_id: c.requestId,
        }),
      );
      const done = await finalizeCreation(this.deps.db, started, session, this.deps.now());
      this.remember(done);
      return done;
    } catch (error) {
      const now = this.deps.now();
      return this.save(isDefiniteRejection(error) ? onCreateRejected(started, error.message, now) : onCreateLost(started, now, messageOf(error)));
    }
  }

  /** Did an earlier attempt create the session? Adopt it, or allow another POST. */
  private async reconcile(c: SessionCreation): Promise<SessionCreation> {
    try {
      const adopted = await this.deps.access.withToken(async (token, s) => {
        const client = new MemohClient(s.connection.deployment, this.deps.fetchFn);
        const page = await client.listSessions(token, c.botId, { limit: RECONCILE_PAGE });
        const serverNow = page.serverDate ? Date.parse(page.serverDate) : Number.NaN;
        const skewMs = Number.isNaN(serverNow) ? 0 : this.deps.now() - serverNow;
        const claimed = await loadClaimedSessionIds(this.deps.db, c.scope);
        const candidates = reconcileCandidates(c, page.items, { accountId: s.connection.accountId, skewMs, claimed });
        for (const candidate of candidates) {
          // Ours has no history yet: its first message is only queued after adoption.
          if (await client.hasHistory(token, c.botId, candidate.id)) continue;
          return page.items.find((item) => item.id === candidate.id)!;
        }
        return null;
      });
      const now = this.deps.now();
      if (!adopted) return this.save(onNotFound(c, now));
      const done = await finalizeCreation(this.deps.db, c, adopted, now);
      this.remember(done);
      return done;
    } catch (error) {
      // Offline or signed out: stay unknown and look again later.
      return this.save(onCreateLost(c, this.deps.now(), messageOf(error)));
    }
  }
}
