import { useCallback, useEffect, useRef, useState } from 'react';

import { NeedsSignInError } from '../../application/access/connectService';
import { HISTORY_PAGE_SIZE } from '../../application/conversation/conversationSync';
import { useAccessState, useServices } from '../../bootstrap/AppServices';
import type { Turn } from '../../core/conversation/types';
import {
  loadHistoryCheckpoint,
  loadRecentTurns,
  loadSessions,
  type HistoryCheckpoint,
  type SessionRecord,
} from '../../data/local/conversationStore';

const errorText = (e: unknown) => (e instanceof NeedsSignInError ? null : e instanceof Error ? e.message : String(e));

function useScope() {
  const state = useAccessState();
  return state.kind === 'signed_in' ? state.session.scope : null;
}

/** Cached sessions of one Bot, then the first server page; `loadMore` pages on. */
export function useSessions(botId: string) {
  const { db, sync } = useServices();
  const scope = useScope();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<string>('');
  const [hasMore, setHasMore] = useState(false);
  const limit = useRef(30);

  const readCache = useCallback(async () => {
    if (!scope) return;
    setSessions(await loadSessions(db, scope, botId, limit.current));
    setLoaded(true);
  }, [db, scope, botId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      cursor.current = await sync.syncSessions(botId);
      setHasMore(cursor.current !== '');
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRefreshing(false);
      await readCache();
    }
  }, [sync, botId, readCache]);

  const loadMore = useCallback(async () => {
    if (!cursor.current || refreshing) return;
    try {
      cursor.current = await sync.syncSessions(botId, cursor.current);
      setHasMore(cursor.current !== '');
      limit.current += 30;
      await readCache();
    } catch (e) {
      setError(errorText(e));
    }
  }, [sync, botId, readCache, refreshing]);

  useEffect(() => {
    void readCache().then(refresh);
  }, [readCache, refresh]);

  return { sessions, loaded, refreshing, error, hasMore, refresh, loadMore, reload: readCache };
}

export type HistoryState = Readonly<{
  turns: Turn[];
  checkpoint: HistoryCheckpoint | null;
  /** Cached rows were read at least once. */
  loaded: boolean;
  syncing: boolean;
  loadingOlder: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadOlder: () => Promise<void>;
}>;

/** Local history first (instant, offline), then the newest server page. */
export function useHistory(botId: string, sessionId: string): HistoryState {
  const { db, sync } = useServices();
  const scope = useScope();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [checkpoint, setCheckpoint] = useState<HistoryCheckpoint | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Rows to show from the cache; grows as older pages load. */
  const window = useRef(HISTORY_PAGE_SIZE * 2);
  const olderInFlight = useRef(false);

  const readCache = useCallback(async () => {
    if (!scope) return;
    const key = { scope, botId, sessionId };
    const [nextTurns, nextCheckpoint] = await Promise.all([
      loadRecentTurns(db, key, window.current),
      loadHistoryCheckpoint(db, key),
    ]);
    setTurns(nextTurns);
    setCheckpoint(nextCheckpoint);
    setLoaded(true);
    return nextTurns.length;
  }, [db, scope, botId, sessionId]);

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      await sync.syncLatest({ botId, sessionId });
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSyncing(false);
      await readCache();
    }
  }, [sync, botId, sessionId, readCache]);

  const loadOlder = useCallback(async () => {
    if (olderInFlight.current || !scope) return;
    olderInFlight.current = true;
    setLoadingOlder(true);
    try {
      const shown = turns.length;
      window.current += HISTORY_PAGE_SIZE * 2;
      const cached = (await readCache()) ?? 0;
      // Cache had nothing further: fetch the page before the oldest message.
      if (cached <= shown && checkpoint?.hasOlder) {
        await sync.syncOlder({ botId, sessionId });
        await readCache();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      olderInFlight.current = false;
      setLoadingOlder(false);
    }
  }, [scope, turns.length, readCache, checkpoint, sync, botId, sessionId]);

  useEffect(() => {
    void readCache().then(refresh);
  }, [readCache, refresh]);

  return { turns, checkpoint, loaded, syncing, loadingOlder, error, refresh, loadOlder };
}
