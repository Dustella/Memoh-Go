import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { ConnectionManager, type AccessState } from '../application/access/connectService';
import { AlertCenter } from '../application/conversation/alertCenter';
import { ConversationSync } from '../application/conversation/conversationSync';
import { HomeService } from '../application/conversation/homeService';
import { LiveSessionPool, OutboxPump } from '../application/conversation/livePool';
import { RuntimeHub } from '../application/conversation/runtimeHub';
import { SessionEventsHub } from '../application/conversation/sessionEventsHub';
import { SessionCreator } from '../application/conversation/sessionCreator';
import { createLogger, type Logger } from '../core/diagnostics/log';
import { newId } from '../core/ids';
import { referencedUris } from '../core/resources/attachments';
import { openExpoDatabase } from '../data/local/expoDatabase';
import { loadPayloadsWithAttachments, markOutboxColdStart } from '../data/local/outboxStore';
import { loadPreferences, savePreference } from '../data/local/preferencesStore';
import type { SqlDatabase } from '../data/local/sql';
import type { FetchFn } from '../data/remote/memohClient';
import { installPlatformCrypto } from '../platform/installPlatformCrypto';
import { nativeSocketFactory } from '../platform/nativeSocketFactory';
import { readAttachmentBase64, sweepStaged } from '../platform/pickFiles';
import { secureCredentialVault } from '../platform/secureCredentialVault';
import { xhrEventStream } from '../platform/xhrEventStream';
import { appPreferences } from '../ui/preferences';

installPlatformCrypto();

/** Everything the screens use, built once per process. */
export type AppServices = Readonly<{
  db: SqlDatabase;
  access: ConnectionManager;
  sync: ConversationSync;
  hub: RuntimeHub;
  fetchFn: FetchFn;
  creator: SessionCreator;
  pool: LiveSessionPool;
  home: HomeService;
  events: SessionEventsHub;
  alerts: AlertCenter;
  log: Logger;
}>;

/**
 * The process-wide diagnostics log (PF-04). Created before storage opens so
 * boot failures and uncaught errors are captured too.
 */
export const appLog = createLogger({ capacity: 500 });
const previousHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  appLog.error('js.uncaught', { error, fatal: Boolean(isFatal) });
  previousHandler(error, isFatal);
});

const DATABASE_FILE = 'memoh-go.db';

async function createAppServices(): Promise<AppServices> {
  const log = appLog;
  const db = await openExpoDatabase(DATABASE_FILE);
  const saved = await loadPreferences(db);
  appPreferences.hydrate(saved, (next, key) => {
    void savePreference(db, key, next[key], Date.now()).catch((error: unknown) =>
      log.warn('preferences.save_failed', { key, error }),
    );
  });
  const fetchFn = fetch as unknown as FetchFn;
  const access = new ConnectionManager({
    db,
    vault: secureCredentialVault,
    fetchFn,
    now: Date.now,
    newId,
  });
  await access.restore();
  log.info('app.start', { access: access.state.kind });
  // Sends interrupted by the last process are unconfirmed, never silently resent.
  await markOutboxColdStart(db, Date.now());
  // CH-16: drop staged attachment copies no unfinished or resendable message needs.
  try {
    const removed = sweepStaged(referencedUris(await loadPayloadsWithAttachments(db)));
    if (removed) log.info('outbox.staged_swept', { removed });
  } catch (error) {
    log.warn('outbox.staged_sweep_failed', { error });
  }
  const hub = new RuntimeHub(access, nativeSocketFactory);
  const events = new SessionEventsHub(access, xhrEventStream);
  const sync = new ConversationSync(db, access, fetchFn, Date.now);
  const creator = new SessionCreator({ db, access, fetchFn, now: Date.now, newId });
  const liveDeps = { db, access, sync, hub, fetchFn, now: Date.now, newId, log, readAttachment: readAttachmentBase64 };
  const pool = new LiveSessionPool(liveDeps);
  const pump = new OutboxPump(liveDeps, pool);
  const home = new HomeService({ db, access, sync, pool, events, now: Date.now, log });
  let lastAccess = access.state.kind;
  let lastScope = access.state.kind === 'signed_in' ? access.state.session.scope : null;
  const stopBackground = () => {
    pump.stop();
    pool.stopAll();
    hub.closeAll();
    events.closeAll();
    creator.stop();
    // Home drops its watches and re-reads for the new state (empty when signed out).
    home.restart();
  };
  access.subscribe(() => {
    if (access.state.kind !== lastAccess) {
      log.info('access.state', {
        from: lastAccess,
        state: access.state.kind,
        reason: access.state.kind === 'needs_sign_in' ? access.state.reason : undefined,
      });
      lastAccess = access.state.kind;
    }
    const scope = access.state.kind === 'signed_in' ? access.state.session.scope : null;
    if (access.state.kind !== 'signed_in') {
      stopBackground();
    } else if (lastScope !== null && scope !== lastScope) {
      // Team switch (ID-05): nothing from the previous scope may keep running or sending.
      log.info('access.scope_changed');
      stopBackground();
    }
    lastScope = scope;
    void creator.resume();
    void pump.kick();
  });
  // A created session's first message is queued: send it even if its screen is closed.
  creator.subscribe(() => void pump.kick());
  const alerts = new AlertCenter(home, log);
  // AppState starts as 'unknown' until the first change event; only 'background' means away.
  const updateAlerts = () =>
    alerts.setEnabled(AppState.currentState !== 'background' && access.state.kind === 'signed_in' && appPreferences.get().inAppAlerts);
  access.subscribe(updateAlerts);
  appPreferences.subscribe(updateAlerts);
  AppState.addEventListener('change', (next) => {
    log.debug('app.state', { state: next });
    updateAlerts();
    if (next === 'active') {
      hub.wake();
      events.wake();
      void creator.resume();
      void pump.kick();
    }
  });
  updateAlerts();
  void creator.resume();
  void pump.kick();
  return { db, access, sync, hub, fetchFn, creator, pool, home, events, alerts, log };
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
        appLog.error('app.boot_failed', { error });
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
