import { useCallback, useEffect, useRef, useState } from 'react';

import { NeedsSignInError } from '../../application/access/connectService';
import { useServices } from '../../bootstrap/AppServices';
import { ApiError, MemohClient } from '../../data/remote/memohClient';

export type RemoteState<T> = Readonly<{
  data: T | undefined;
  loading: boolean;
  /** Last failure: HTTP status (0 = network) and message. */
  error: Readonly<{ status: number; message: string }> | null;
  /** When the current data was fetched (epoch ms). */
  fetchedAt: number | null;
  refresh: () => Promise<void>;
}>;

/**
 * Server-only views (M4 resources) that the app does not cache: load on
 * mount and on `refresh`, keep the previous data while reloading. A request
 * that outlives its screen is ignored.
 */
export function useRemote<T>(load: (client: MemohClient, token: string) => Promise<T>, deps: readonly unknown[]): RemoteState<T> {
  const { access, fetchFn } = useServices();
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RemoteState<T>['error']>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await access.withToken((token, session) => load(new MemohClient(session.connection.deployment, fetchFn), token));
      if (!alive.current) return;
      setData(result);
      setError(null);
      setFetchedAt(Date.now());
    } catch (e) {
      if (!alive.current || e instanceof NeedsSignInError) return;
      setError({ status: e instanceof ApiError && e.kind === 'http' ? e.status : 0, message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, fetchFn, ...deps]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, fetchedAt, refresh };
}

/** Run one authenticated call outside a view (toggles, creates). */
export function useServerCall() {
  const { access, fetchFn } = useServices();
  return useCallback(
    <T,>(work: (client: MemohClient, token: string) => Promise<T>) =>
      access.withToken((token, session) => work(new MemohClient(session.connection.deployment, fetchFn), token)),
    [access, fetchFn],
  );
}
