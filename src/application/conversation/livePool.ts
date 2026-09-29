import { isRunActive } from '../../core/conversation/types';
import { loadPendingOutbox } from '../../data/local/outboxStore';
import { LiveSession, type LiveDeps } from './liveSession';

const keyOf = (botId: string, sessionId: string) => `${botId}\u0000${sessionId}`;

/**
 * At most one LiveSession per conversation, shared by the chat screen and the
 * background pump, so a session's Outbox is never driven twice.
 */
export class LiveSessionPool {
  private readonly items = new Map<string, { live: LiveSession; refs: number; stopTimer: ReturnType<typeof setTimeout> | null }>();

  constructor(
    private readonly deps: LiveDeps,
    /** Grace period before an unused session is stopped, so a quick remount reuses it. */
    private readonly lingerMs = 1_000,
  ) {}

  /** Get or create (not started). */
  get(botId: string, sessionId: string): LiveSession {
    const key = keyOf(botId, sessionId);
    const existing = this.items.get(key);
    if (existing) return existing.live;
    const live = new LiveSession(this.deps, botId, sessionId);
    this.items.set(key, { live, refs: 0, stopTimer: null });
    return live;
  }

  /** Start (on first use) and keep running until the returned release is called. */
  retain(live: LiveSession): () => void {
    const key = keyOf(live.botId, live.sessionId);
    let item = this.items.get(key);
    if (!item || item.live !== live) {
      if (item) {
        // A newer instance replaced this one: use that.
        return this.retain(item.live);
      }
      item = { live, refs: 0, stopTimer: null };
      this.items.set(key, item);
    }
    if (item.stopTimer) {
      clearTimeout(item.stopTimer);
      item.stopTimer = null;
    }
    item.refs += 1;
    if (item.refs === 1 && !live.started) void live.start();
    let released = false;
    const held = item;
    return () => {
      if (released) return;
      released = true;
      held.refs -= 1;
      if (held.refs > 0) return;
      held.stopTimer = setTimeout(() => {
        held.stopTimer = null;
        if (held.refs > 0) return;
        held.live.stop();
        if (this.items.get(key) === held) this.items.delete(key);
      }, this.lingerMs);
    };
  }

  isHeld(botId: string, sessionId: string) {
    return (this.items.get(keyOf(botId, sessionId))?.refs ?? 0) > 0;
  }

  stopAll() {
    for (const item of this.items.values()) {
      if (item.stopTimer) clearTimeout(item.stopTimer);
      item.live.stop();
    }
    this.items.clear();
  }
}

/**
 * Works every session that has unsent messages, whether or not its chat is
 * open (e.g. a new chat's first message after the user left the screen, or
 * sends queued before the app was killed). Each worked session is released
 * once its Outbox is empty and it has no active run.
 */
export class OutboxPump {
  private readonly held = new Map<string, { release: () => void; unsubscribe: () => void }>();
  private kicking = false;

  constructor(
    private readonly deps: LiveDeps,
    private readonly pool: LiveSessionPool,
  ) {}

  /** Look for sessions with unsent messages and start working them. */
  async kick() {
    if (this.kicking) return;
    this.kicking = true;
    try {
      const s = this.deps.access.state;
      if (s.kind !== 'signed_in') return;
      const pending = await loadPendingOutbox(this.deps.db, s.session.scope);
      for (const entry of pending) {
        const key = keyOf(entry.botId, entry.sessionId);
        if (this.held.has(key)) continue;
        const live = this.pool.get(entry.botId, entry.sessionId);
        const release = this.pool.retain(live);
        const check = () => {
          const snap = live.getSnapshot();
          if (!live.loaded) return;
          const busy = snap.pending.length > 0 || (snap.run !== null && isRunActive(snap.run.status));
          if (busy) return;
          const item = this.held.get(key);
          if (!item) return;
          this.held.delete(key);
          item.unsubscribe();
          item.release();
        };
        const unsubscribe = live.subscribe(check);
        this.held.set(key, { release, unsubscribe });
      }
    } finally {
      this.kicking = false;
    }
  }

  stop() {
    for (const item of this.held.values()) {
      item.unsubscribe();
      item.release();
    }
    this.held.clear();
  }
}
