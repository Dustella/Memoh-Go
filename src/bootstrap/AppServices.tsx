import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { ConnectionManager, type AccessState } from '../application/access/connectService';
import { newId } from '../core/ids';
import { openExpoDatabase } from '../data/local/expoDatabase';
import type { SqlDatabase } from '../data/local/sql';
import type { FetchFn } from '../data/remote/memohClient';
import { installPlatformCrypto } from '../platform/installPlatformCrypto';
import { secureCredentialVault } from '../platform/secureCredentialVault';

installPlatformCrypto();

/** Everything the screens use, built once per process. */
export type AppServices = Readonly<{ db: SqlDatabase; access: ConnectionManager }>;

const DATABASE_FILE = 'memoh-go.db';

async function createAppServices(): Promise<AppServices> {
  const db = await openExpoDatabase(DATABASE_FILE);
  const access = new ConnectionManager({
    db,
    vault: secureCredentialVault,
    fetchFn: fetch as unknown as FetchFn,
    now: Date.now,
    newId,
  });
  await access.restore();
  return { db, access };
}

let servicesPromise: Promise<AppServices> | undefined;

const ServicesContext = createContext<AppServices | null>(null);

type BootState = { kind: 'booting' } | { kind: 'ready'; services: AppServices } | { kind: 'failed'; error: Error };

/** Opens storage and restores the last session before rendering children. */
export function AppServicesProvider({ children, fallback }: { children: ReactNode; fallback: (state: BootState) => ReactNode }) {
  const [state, setState] = useState<BootState>({ kind: 'booting' });
  useEffect(() => {
    servicesPromise ??= createAppServices();
    servicesPromise.then(
      (services) => setState({ kind: 'ready', services }),
      (error: unknown) => {
        servicesPromise = undefined;
        setState({ kind: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
      },
    );
  }, []);
  if (state.kind !== 'ready') return <>{fallback(state)}</>;
  return <ServicesContext.Provider value={state.services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices outside AppServicesProvider');
  return services;
}

export function useAccessState(): AccessState {
  const { access } = useServices();
  return useSyncExternalStore(access.subscribe, access.getState);
}
