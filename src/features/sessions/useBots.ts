import { useCallback, useEffect, useState } from 'react';

import { NeedsSignInError } from '../../application/access/connectService';
import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { loadBots, type BotRecord } from '../../data/local/conversationStore';

export type BotsView = Readonly<{
  bots: BotRecord[];
  /** Cached rows were read; false only before the first local read. */
  loaded: boolean;
  refreshing: boolean;
  /** Last refresh failed; cached rows are still shown. */
  error: string | null;
  refresh: () => Promise<void>;
}>;

/** Cached Bots first, then a server refresh. */
export function useBots(): BotsView {
  const { db, access } = useServices();
  const state = useAccessState();
  const scope = state.kind === 'signed_in' ? state.session.scope : null;
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readCache = useCallback(async () => {
    if (!scope) return;
    setBots(await loadBots(db, scope));
    setLoaded(true);
  }, [db, scope]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await access.syncBots();
      setError(null);
    } catch (e) {
      if (!(e instanceof NeedsSignInError)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
      await readCache();
    }
  }, [access, readCache]);

  useEffect(() => {
    void readCache().then(refresh);
  }, [readCache, refresh]);

  return { bots, loaded, refreshing, error, refresh };
}
