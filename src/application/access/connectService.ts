import {
  capabilitiesFromPing,
  reconcileCapabilities,
  type PingResponse,
  type ServerCapabilities,
} from '../../core/identity/capabilities';
import {
  OSS_DEFAULT_TEAM_ID,
  credentialFromResponse,
  isExpired,
  refreshDue,
  type Credential,
} from '../../core/identity/credential';
import { normaliseDeployment, scopeKey, type ScopeKey } from '../../core/identity/scope';
import { checkServerCompatibility, MIN_SERVER_VERSION } from '../../core/identity/serverVersion';
import { replaceBots } from '../../data/local/conversationStore';
import {
  deleteConnection,
  loadLastUsedConnection,
  setConnectionTeam,
  touchConnection,
  upsertConnection,
  type Connection,
} from '../../data/local/connectionStore';
import type { SqlDatabase } from '../../data/local/sql';
import { clearScope, loadCapabilities, saveCapabilities } from '../../data/local/userStateStore';
import { ApiError, MemohClient, type FetchFn } from '../../data/remote/memohClient';

export interface CredentialVault {
  load(connectionId: string): Promise<Credential | null>;
  save(connectionId: string, credential: Credential): Promise<void>;
  remove(connectionId: string): Promise<void>;
}

export type AccessDeps = Readonly<{
  db: SqlDatabase;
  vault: CredentialVault;
  fetchFn: FetchFn;
  now: () => number;
  newId: () => string;
}>;

// ---------------------------------------------------------------- probing

export type ServerProbe =
  | Readonly<{ kind: 'ok'; deployment: string; ping: PingResponse; verified: boolean }>
  | Readonly<{ kind: 'invalid_url' }>
  | Readonly<{ kind: 'unreachable'; detail: string }>
  | Readonly<{ kind: 'not_memoh' }>
  | Readonly<{ kind: 'too_old'; version: string; minimum: string }>;

/** Check a user-entered address before asking for credentials. */
export async function probeServer(deps: Pick<AccessDeps, 'fetchFn'>, input: string): Promise<ServerProbe> {
  let deployment: string;
  try {
    deployment = normaliseDeployment(input);
  } catch {
    return { kind: 'invalid_url' };
  }
  let ping: PingResponse;
  try {
    ping = await new MemohClient(deployment, deps.fetchFn).ping();
  } catch (error) {
    if (error instanceof ApiError && (error.kind === 'http' || error.kind === 'malformed')) return { kind: 'not_memoh' };
    return { kind: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
  }
  const compat = checkServerCompatibility(ping);
  switch (compat.kind) {
    case 'not_memoh':
      return { kind: 'not_memoh' };
    case 'too_old':
      return { kind: 'too_old', version: compat.version, minimum: MIN_SERVER_VERSION };
    default:
      return { kind: 'ok', deployment, ping, verified: compat.kind === 'supported' };
  }
}

// ---------------------------------------------------------------- state

export type SignedInSession = Readonly<{
  connection: Connection;
  scope: ScopeKey;
  credential: Credential;
  capabilities: ServerCapabilities;
}>;

export type AccessState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'signed_out' }>
  | Readonly<{ kind: 'signed_in'; session: SignedInSession }>
  /** Known account whose token is gone or expired. Local data is kept. */
  | Readonly<{ kind: 'needs_sign_in'; connection: Connection; scope: ScopeKey; reason: 'expired' | 'rejected' | 'missing' }>;

export type SignInResult =
  | Readonly<{ kind: 'signed_in' }>
  | Readonly<{ kind: 'invalid_credentials' }>
  | Readonly<{ kind: 'wrong_account' }>
  | Readonly<{ kind: 'error'; message: string }>;

/** A request was refused and the account must sign in again. */
export class NeedsSignInError extends Error {
  constructor() {
    super('Sign in again to continue');
    this.name = 'NeedsSignInError';
  }
}

const scopeOf = (c: Connection) => scopeKey({ deployment: c.deployment, accountId: c.accountId, teamId: c.teamId });

/**
 * Owns the signed-in connection: restore on launch, sign in, keep the token
 * fresh, sign out. The UI subscribes to `state`.
 */
export class ConnectionManager {
  private current: AccessState = { kind: 'loading' };
  private readonly listeners = new Set<() => void>();
  private refreshing: Promise<SignedInSession> | null = null;

  constructor(private readonly deps: AccessDeps) {}

  get state(): AccessState {
    return this.current;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.current;

  private set(state: AccessState) {
    this.current = state;
    for (const listener of this.listeners) listener();
  }

  private client(connection: Connection) {
    return new MemohClient(connection.deployment, this.deps.fetchFn);
  }

  /** Launch: pick the last used connection and its credential, without network. */
  async restore(): Promise<AccessState> {
    const connection = await loadLastUsedConnection(this.deps.db);
    if (!connection) {
      this.set({ kind: 'signed_out' });
      return this.current;
    }
    const scope = scopeOf(connection);
    const credential = await this.deps.vault.load(connection.connectionId);
    if (!credential || isExpired(credential, this.deps.now())) {
      this.set({ kind: 'needs_sign_in', connection, scope, reason: credential ? 'expired' : 'missing' });
      return this.current;
    }
    const known = capabilitiesFromPing(connection.deployment, {
      version: connection.serverVersion,
      commit_hash: connection.serverCommit,
    });
    const capabilities = (await loadCapabilities(this.deps.db, known.serverKey)) ?? known;
    this.set({ kind: 'signed_in', session: { connection, scope, credential, capabilities } });
    return this.current;
  }

  async signIn(probe: Extract<ServerProbe, { kind: 'ok' }>, username: string, password: string): Promise<SignInResult> {
    const client = new MemohClient(probe.deployment, this.deps.fetchFn);
    const now = this.deps.now();
    let credential: Credential;
    let accountId: string;
    let displayName: string;
    let resolvedUsername: string;
    try {
      const login = await client.login(username.trim(), password);
      credential = credentialFromResponse(login.body, now, login.serverDate);
      const account = await client.me(credential.accessToken);
      accountId = account.id;
      resolvedUsername = account.username || login.body.username || username.trim();
      displayName = account.display_name || login.body.display_name || resolvedUsername;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return { kind: 'invalid_credentials' };
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }

    // Re-authenticating a known account must stay the same account.
    if (this.current.kind === 'needs_sign_in') {
      const expected = this.current.connection;
      if (expected.deployment === probe.deployment && expected.accountId !== accountId) return { kind: 'wrong_account' };
    }

    const connection = await upsertConnection(this.deps.db, {
      connectionId: this.deps.newId(),
      deployment: probe.deployment,
      accountId,
      teamId: OSS_DEFAULT_TEAM_ID,
      username: resolvedUsername,
      displayName,
      serverVersion: probe.ping.version ?? '',
      serverCommit: probe.ping.commit_hash ?? '',
      createdAt: now,
      lastUsedAt: now,
    });
    await this.deps.vault.save(connection.connectionId, credential);

    const fresh = capabilitiesFromPing(probe.deployment, probe.ping);
    const capabilities = reconcileCapabilities(await loadCapabilities(this.deps.db, fresh.serverKey), fresh);
    await saveCapabilities(this.deps.db, capabilities, now);

    this.set({ kind: 'signed_in', session: { connection, scope: scopeOf(connection), credential, capabilities } });
    return { kind: 'signed_in' };
  }

  /** Persist capability knowledge learned while signed in. */
  async updateCapabilities(capabilities: ServerCapabilities) {
    if (this.current.kind !== 'signed_in') return;
    await saveCapabilities(this.deps.db, capabilities, this.deps.now());
    this.set({ kind: 'signed_in', session: { ...this.current.session, capabilities } });
  }

  /** Single-flight token refresh. Network failures keep the still-valid token. */
  private refresh(session: SignedInSession): Promise<SignedInSession> {
    this.refreshing ??= (async () => {
      try {
        const now = this.deps.now();
        const response = await this.client(session.connection).refresh(session.credential.accessToken);
        const credential = credentialFromResponse(response.body, now, response.serverDate);
        await this.deps.vault.save(session.connection.connectionId, credential);
        const next = { ...session, credential };
        if (this.current.kind === 'signed_in' && this.current.session.connection.connectionId === session.connection.connectionId) {
          this.set({ kind: 'signed_in', session: next });
        }
        return next;
      } catch (error) {
        if (error instanceof ApiError && error.unauthorized) {
          this.markRejected(session);
          throw new NeedsSignInError();
        }
        return session;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private markRejected(session: SignedInSession) {
    if (this.current.kind === 'signed_in' && this.current.session.connection.connectionId === session.connection.connectionId) {
      this.set({ kind: 'needs_sign_in', connection: session.connection, scope: session.scope, reason: 'rejected' });
    }
  }

  /** A usable session, refreshed first when due. */
  async ensureFresh(): Promise<SignedInSession> {
    const state = this.current;
    if (state.kind !== 'signed_in') throw new NeedsSignInError();
    const now = this.deps.now();
    if (isExpired(state.session.credential, now)) {
      this.set({ kind: 'needs_sign_in', connection: state.session.connection, scope: state.session.scope, reason: 'expired' });
      throw new NeedsSignInError();
    }
    return refreshDue(state.session.credential, now) ? this.refresh(state.session) : state.session;
  }

  /** Run an authenticated call; on 401 refresh once and retry, then require sign-in. */
  async withToken<T>(call: (token: string, session: SignedInSession) => Promise<T>): Promise<T> {
    const session = await this.ensureFresh();
    try {
      return await call(session.credential.accessToken, session);
    } catch (error) {
      if (!(error instanceof ApiError && error.unauthorized)) throw error;
    }
    const retried = await this.refresh(session);
    if (retried === session) {
      this.markRejected(session);
      throw new NeedsSignInError();
    }
    try {
      return await call(retried.credential.accessToken, retried);
    } catch (error) {
      if (error instanceof ApiError && error.unauthorized) {
        this.markRejected(retried);
        throw new NeedsSignInError();
      }
      throw error;
    }
  }

  /** Fetch the Bot list and cache it for this scope. */
  async syncBots() {
    return this.withToken(async (token, session) => {
      const bots = await this.client(session.connection).listBots(token);
      await replaceBots(this.deps.db, session.scope, bots, this.deps.now());
      await touchConnection(this.deps.db, session.connection.connectionId, this.deps.now());
      return bots;
    });
  }

  /**
   * ID-05: move this account to another Team. Everything local is keyed by
   * scope (deployment + account + team), so the previous Team's cache, drafts
   * and unsent messages stay behind untouched and resume when switched back.
   */
  async switchTeam(teamId: string): Promise<SignedInSession> {
    const state = this.current;
    if (state.kind !== 'signed_in') throw new NeedsSignInError();
    if (state.session.connection.teamId === teamId) return state.session;
    const connection = await setConnectionTeam(this.deps.db, state.session.connection.connectionId, teamId, this.deps.now());
    const session = { ...state.session, connection, scope: scopeOf(connection) };
    this.set({ kind: 'signed_in', session });
    return session;
  }

  /** Forget this account on this device: token, cached data and unsent messages. */
  async signOut() {
    const state = this.current;
    const connection = state.kind === 'signed_in' ? state.session.connection : state.kind === 'needs_sign_in' ? state.connection : null;
    if (!connection) return;
    await this.deps.vault.remove(connection.connectionId);
    await clearScope(this.deps.db, scopeOf(connection));
    await deleteConnection(this.deps.db, connection.connectionId);
    await this.restore();
  }
}
