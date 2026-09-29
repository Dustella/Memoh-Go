import type { Logger } from '../../core/diagnostics/log';
import { isRunActive } from '../../core/conversation/types';
import { tn } from '../../core/i18n';
import {
  buildHome,
  homeKey,
  pickWatchSet,
  summarizeRun,
  type HomeSections,
  type HomeSession,
  type OutboxIssue,
  type RunSummary,
} from '../../core/home/home';
import { loadBots } from '../../data/local/conversationStore';
import { loadHomeSessions, loadOutboxIssues, loadSavedRuns, loadSeen } from '../../data/local/homeStore';
import type { SqlDatabase } from '../../data/local/sql';
import { loadUiState, saveUiState } from '../../data/local/userStateStore';
import type { ConnectionManager } from '../access/connectService';
import type { ConversationSync } from './conversationSync';
import type { LiveSessionPool } from './livePool';
import type { LiveSession } from './liveSession';

/** Hard cap on sessions subscribed for live state at once (U6 fallback). */
export const WATCH_LIMIT = 8;
const WATCH_WINDOW_MS = 30 * 60_000;
const MAX_BOTS_REFRESHED = 20;
const RELOAD_DEBOUNCE_MS = 250;
const BASELINE_KEY = 'home_baseline';

export type HomeSnapshot = Readonly<{
  loaded: boolean;
  refreshing: boolean;
  /** Last server refresh failed; cached data is shown. */
  error: string | null;
  sections: HomeSections;
  /** How many sessions are watched live, and the cap. */
  watching: number;
  watchLimit: number;
}>;

const EMPTY: HomeSnapshot = {
  loaded: false,
  refreshing: false,
  error: null,
  sections: { continueWith: null, needsYou: [], running: [], newResults: [], recent: [] },
  watching: 0,
  watchLimit: WATCH_LIMIT,
};

export type HomeDeps = Readonly<{
  db: SqlDatabase;
  access: ConnectionManager;
  sync: ConversationSync;
  pool: LiveSessionPool;
  now: () => number;
  log?: Logger;
}>;

/**
 * Builds the home screen from local data plus live run state of a bounded
 * set of sessions. Memoh has no Team-wide "what is running / waiting"
 * endpoint yet (contracts: U6), so the app subscribes to at most
 * WATCH_LIMIT sessions (active and unsent first, then recent) and shows the
 * rest from their last saved run state, marked as cached.
 *
 * Active only while the home screen is focused (`activate` / `deactivate`).
 */
export class HomeService {
  private snapshot: HomeSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private active = false;
  private sessions: HomeSession[] = [];
  private savedRuns = new Map<string, RunSummary>();
  private outbox = new Map<string, OutboxIssue>();
  private seen = new Map<string, number>();
  private baseline = 0;
  private refreshing = false;
  private error: string | null = null;
  private loaded = false;
  private readonly watched = new Map<string, { live: LiveSession; release: () => void; unsubscribe: () => void; wasActive: boolean }>();
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: HomeDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private holders = 0;

  /**
   * Keep Home live until the returned release is called. Held by the home
   * screen while focused and, for in-app alerts (NT-01), by the app while it
   * is in the foreground. The watch cap applies either way.
   */
  retain(): () => void {
    this.holders += 1;
    if (this.holders === 1) void this.activate();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders -= 1;
      if (this.holders === 0) this.deactivate();
    };
  }

  /** Signed-in scope changed (sign-out, Team switch): drop watches and read the new scope. */
  restart() {
    this.unwatchAll();
    this.loaded = false;
    this.error = null;
    this.publish();
    if (!this.active) return;
    void this.reloadLocal().then(() => this.refresh());
  }

  /** Home is on screen: read the cache, watch sessions, refresh from the server. */
  private async activate() {
    if (this.active) return;
    this.active = true;
    await this.reloadLocal();
    void this.refresh();
  }

  private deactivate() {
    this.active = false;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    this.unwatchAll();
  }

  /** Pull the Bot list and every Bot's newest sessions page. */
  async refresh() {
    const state = this.deps.access.state;
    if (state.kind !== 'signed_in' || this.refreshing) return;
    this.refreshing = true;
    this.publish();
    try {
      await this.deps.access.syncBots();
      const bots = (await loadBots(this.deps.db, state.session.scope)).slice(0, MAX_BOTS_REFRESHED);
      const results = await Promise.allSettled(bots.map((b) => this.deps.sync.syncSessions(b.id)));
      const failed = results.filter((r) => r.status === 'rejected');
      this.error = failed.length > 0 ? tn('home.botsFailed', failed.length) : null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.deps.log?.warn('home.refresh_failed', { error: e });
    } finally {
      this.refreshing = false;
      await this.reloadLocal();
    }
  }

  private scheduleReload() {
    if (this.reloadTimer || !this.active) return;
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.reloadLocal();
    }, RELOAD_DEBOUNCE_MS);
  }

  private async reloadLocal() {
    const state = this.deps.access.state;
    if (state.kind !== 'signed_in') {
      this.unwatchAll();
      this.snapshot = EMPTY;
      this.publish();
      return;
    }
    const { db } = this.deps;
    const scope = state.session.scope;
    const [sessions, savedRuns, outbox, seen, baseline] = await Promise.all([
      loadHomeSessions(db, scope),
      loadSavedRuns(db, scope),
      loadOutboxIssues(db, scope),
      loadSeen(db, scope),
      loadUiState<number>(db, scope, BASELINE_KEY),
    ]);
    if (baseline === null) {
      // First home load on this device: history from before now is not "new".
      this.baseline = this.deps.now();
      await saveUiState(db, scope, BASELINE_KEY, this.baseline, this.baseline);
    } else {
      this.baseline = baseline;
    }
    Object.assign(this, { sessions, savedRuns, outbox, seen });
    this.loaded = true;
    if (this.active) this.updateWatchSet();
    this.publish();
  }

  private liveRuns(): Map<string, RunSummary> {
    const runs = new Map<string, RunSummary>();
    for (const [key, { live }] of this.watched) {
      const snap = live.getSnapshot();
      if (snap.live && snap.run) runs.set(key, summarizeRun(snap.run, this.deps.now()));
    }
    return runs;
  }

  private updateWatchSet() {
    const runs = new Map([...this.savedRuns, ...this.liveRuns()]);
    const wanted = new Set(
      pickWatchSet({ sessions: this.sessions, runs, outbox: this.outbox, now: this.deps.now(), limit: WATCH_LIMIT, windowMs: WATCH_WINDOW_MS }),
    );
    for (const [key, item] of this.watched) {
      if (wanted.has(key)) continue;
      item.unsubscribe();
      item.release();
      this.watched.delete(key);
    }
    for (const key of wanted) {
      if (this.watched.has(key)) continue;
      const session = this.sessions.find((s) => homeKey(s.botId, s.sessionId) === key);
      if (!session) continue;
      const live = this.deps.pool.get(session.botId, session.sessionId);
      const release = this.deps.pool.retain(live);
      const item: { live: LiveSession; release: () => void; unsubscribe: () => void; wasActive: boolean } = {
        live,
        release,
        unsubscribe: () => undefined,
        wasActive: false,
      };
      const off = live.subscribe(() => this.onLiveChanged(key, session.botId));
      item.unsubscribe = () => void off();
      this.watched.set(key, item);
    }
  }

  private onLiveChanged(key: string, botId: string) {
    const item = this.watched.get(key);
    if (!item) return;
    const run = item.live.getSnapshot().run;
    const activeNow = Boolean(run && isRunActive(run.status));
    // A watched run just finished: its session moved in the list, pull that Bot's page.
    if (item.wasActive && !activeNow) void this.deps.sync.syncSessions(botId).catch(() => undefined).then(() => this.scheduleReload());
    item.wasActive = activeNow;
    this.publish();
    this.scheduleReload();
  }

  private unwatchAll() {
    for (const item of this.watched.values()) {
      item.unsubscribe();
      item.release();
    }
    this.watched.clear();
  }

  private publish() {
    const live = this.liveRuns();
    const runs = new Map([...this.savedRuns, ...live]);
    this.snapshot = {
      loaded: this.loaded,
      refreshing: this.refreshing,
      error: this.error,
      sections: buildHome({
        sessions: this.sessions,
        runs,
        liveKeys: new Set(live.keys()),
        outbox: this.outbox,
        seen: this.seen,
        baseline: this.baseline,
      }),
      watching: this.watched.size,
      watchLimit: WATCH_LIMIT,
    };
    for (const listener of this.listeners) listener();
  }
}
