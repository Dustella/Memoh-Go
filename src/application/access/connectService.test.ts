import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Credential } from '../../core/identity/credential';
import { newId } from '../../core/ids';
import { loadBots, saveHistoryPage } from '../../data/local/conversationStore';
import { listConnections } from '../../data/local/connectionStore';
import type { SqlDatabase } from '../../data/local/sql';
import { loadDraft, saveDraft } from '../../data/local/userStateStore';
import type { FetchFn } from '../../data/remote/memohClient';
import { openNodeDatabase } from '../../../tests/support/nodeDatabase';
import { ConnectionManager, NeedsSignInError, probeServer, type CredentialVault } from './connectService';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-09-28T12:00:00Z');

/** In-memory stand-in for a Memoh server; bodies mirror the dev stack. */
function fakeServer(options: { version?: string; tokenTtl?: number } = {}) {
  const state = {
    now: T0,
    version: options.version ?? 'v0.20.0',
    users: new Map([['admin', { id: 'u-admin', password: 'admin123' }], ['eve', { id: 'u-eve', password: 'pw' }]]),
    valid: new Map<string, { user: string; exp: number }>(),
    calls: [] as string[],
    offline: false,
    issued: 0,
  };
  const ttl = options.tokenTtl ?? 24 * HOUR;
  const json = (status: number, body: unknown) => ({
    status,
    headers: { get: (n: string) => (n === 'date' ? new Date(state.now).toUTCString() : n === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
  });
  const issue = (user: string) => {
    const token = `tok-${user}-${(state.issued += 1)}`;
    const exp = state.now + ttl;
    state.valid.set(token, { user, exp });
    return { access_token: token, token_type: 'Bearer', expires_at: new Date(exp).toISOString() };
  };
  const authed = (headers: Record<string, string>) => {
    const t = headers.authorization?.replace(/^Bearer /, '');
    const entry = t ? state.valid.get(t) : undefined;
    return entry && entry.exp > state.now ? entry.user : null;
  };

  const fetchFn: FetchFn = async (url, init) => {
    if (state.offline) throw new Error('Network request failed');
    const path = new URL(url).pathname;
    state.calls.push(`${init.method} ${path}`);
    if (path === '/ping') return json(200, { status: 'ok', version: state.version, commit_hash: 'abc1234' });
    if (path === '/auth/login') {
      const { username, password } = JSON.parse(init.body ?? '{}');
      if (!username || !password) return json(400, { message: 'username and password are required' });
      const user = state.users.get(username);
      if (!user || user.password !== password) return json(401, { message: 'invalid credentials' });
      return json(200, { ...issue(username), user_id: user.id, username, display_name: username });
    }
    const user = authed(init.headers);
    if (!user) return json(401, { message: 'invalid or expired jwt' });
    if (path === '/auth/refresh') return json(200, issue(user));
    if (path === '/users/me') return json(200, { id: state.users.get(user)!.id, username: user, display_name: user });
    if (path === '/bots') return json(200, { items: [{ id: 'bot-kitty', display_name: 'Kitty', status: 'ready', is_active: true }] });
    return json(404, { message: 'Not Found' });
  };
  return { state, fetchFn };
}

function memoryVault(): CredentialVault & { items: Map<string, Credential> } {
  const items = new Map<string, Credential>();
  return {
    items,
    load: async (id) => items.get(id) ?? null,
    save: async (id, c) => void items.set(id, c),
    remove: async (id) => void items.delete(id),
  };
}

let db: SqlDatabase;
beforeEach(async () => {
  db = await openNodeDatabase();
});
afterEach(async () => {
  await db.close();
});

function setup(options?: Parameters<typeof fakeServer>[0]) {
  const server = fakeServer(options);
  const vault = memoryVault();
  const deps = { db, vault, fetchFn: server.fetchFn, now: () => server.state.now, newId };
  return { server, vault, deps, manager: new ConnectionManager(deps) };
}

async function signedIn(options?: Parameters<typeof fakeServer>[0]) {
  const ctx = setup(options);
  const probe = await probeServer(ctx.deps, 'memoh.example');
  if (probe.kind !== 'ok') throw new Error(probe.kind);
  expect(await ctx.manager.signIn(probe, 'admin', 'admin123')).toEqual({ kind: 'signed_in' });
  return { ...ctx, probe };
}

describe('probeServer', () => {
  it('normalises the address and accepts supported and non-release versions', async () => {
    const { deps } = setup();
    expect(await probeServer(deps, ' Memoh.Example/ ')).toMatchObject({ kind: 'ok', deployment: 'https://memoh.example', verified: true });
    expect(await probeServer(setup({ version: 'dev' }).deps, 'memoh.example')).toMatchObject({ kind: 'ok', verified: false });
  });

  it('explains every way an address can be wrong', async () => {
    expect(await probeServer(setup().deps, 'ftp://x')).toEqual({ kind: 'invalid_url' });
    expect(await probeServer(setup({ version: 'v0.16.0' }).deps, 'memoh.example')).toEqual({
      kind: 'too_old',
      version: 'v0.16.0',
      minimum: '0.17.0',
    });
    const offline = setup();
    offline.server.state.offline = true;
    expect((await probeServer(offline.deps, 'memoh.example')).kind).toBe('unreachable');
    const notMemoh: FetchFn = async () => ({ status: 200, headers: { get: () => 'text/html' }, text: async () => '<html>' });
    expect(await probeServer({ fetchFn: notMemoh }, 'example.com')).toEqual({ kind: 'not_memoh' });
  });
});

describe('sign in and restore', () => {
  it('signs in, stores the token only in the vault, and restores without network', async () => {
    const { manager, vault, server, deps } = await signedIn();
    const state = manager.state;
    expect(state.kind).toBe('signed_in');
    if (state.kind !== 'signed_in') return;
    expect(state.session.connection).toMatchObject({ deployment: 'https://memoh.example', accountId: 'u-admin', username: 'admin' });
    expect(vault.items.get(state.session.connection.connectionId)?.accessToken).toMatch(/^tok-admin/);

    const dump = JSON.stringify(await db.all('SELECT * FROM connections')) + JSON.stringify(await db.all('SELECT * FROM server_capabilities'));
    expect(dump).not.toContain('tok-');

    server.state.offline = true;
    const relaunched = new ConnectionManager(deps);
    expect((await relaunched.restore()).kind).toBe('signed_in');
  });

  it('reports wrong passwords without creating a connection', async () => {
    const { manager, deps } = setup();
    const probe = await probeServer(deps, 'memoh.example');
    if (probe.kind !== 'ok') throw new Error();
    expect(await manager.signIn(probe, 'admin', 'nope')).toEqual({ kind: 'invalid_credentials' });
    expect(await listConnections(db)).toEqual([]);
    expect(manager.state.kind).toBe('loading');
  });

  it('keeps one connection per account across repeated sign-ins', async () => {
    const { manager, probe } = await signedIn();
    const first = manager.state.kind === 'signed_in' ? manager.state.session.connection.connectionId : '';
    await manager.signIn(probe, 'admin', 'admin123');
    expect((await listConnections(db)).map((c) => c.connectionId)).toEqual([first]);
  });

  it('asks to sign in again after expiry but keeps local data, and refuses a different account', async () => {
    const { manager, server, deps, probe } = await signedIn();
    const session = manager.state.kind === 'signed_in' ? manager.state.session : null;
    const key = { scope: session!.scope, botId: 'bot-kitty', sessionId: 's1' };
    await saveDraft(db, key, 'keep me', 1);

    server.state.now += 25 * HOUR;
    const relaunched = new ConnectionManager(deps);
    expect(await relaunched.restore()).toMatchObject({ kind: 'needs_sign_in', reason: 'expired' });
    expect(await loadDraft(db, key)).toBe('keep me');

    expect(await relaunched.signIn(probe, 'eve', 'pw')).toEqual({ kind: 'wrong_account' });
    expect(await relaunched.signIn(probe, 'admin', 'admin123')).toEqual({ kind: 'signed_in' });
    expect(await loadDraft(db, key)).toBe('keep me');
  });
});

describe('token freshness', () => {
  it('uses the token as is while fresh and refreshes once 75% of its life has passed', async () => {
    const { manager, server } = await signedIn();
    await manager.syncBots();
    expect(server.state.calls.filter((c) => c.includes('refresh'))).toHaveLength(0);

    server.state.now += 19 * HOUR;
    const before = manager.state.kind === 'signed_in' ? manager.state.session.credential.accessToken : '';
    await Promise.all([manager.syncBots(), manager.syncBots(), manager.syncBots()]);
    expect(server.state.calls.filter((c) => c.includes('refresh'))).toHaveLength(1);
    const after = manager.state.kind === 'signed_in' ? manager.state.session.credential.accessToken : '';
    expect(after).not.toBe(before);
  });

  it('keeps working offline with a still-valid token when a refresh cannot reach the server', async () => {
    const { manager, server } = await signedIn();
    server.state.now += 20 * HOUR;
    server.state.offline = true;
    await expect(manager.ensureFresh()).resolves.toBeTruthy();
    expect(manager.state.kind).toBe('signed_in');
  });

  it('retries once after a 401 and then requires sign-in', async () => {
    const { manager, server } = await signedIn();
    const token = manager.state.kind === 'signed_in' ? manager.state.session.credential.accessToken : '';

    server.state.valid.delete(token); // e.g. server secret rotated
    await expect(manager.syncBots()).rejects.toBeInstanceOf(NeedsSignInError);
    expect(manager.state).toMatchObject({ kind: 'needs_sign_in', reason: 'rejected' });
  });

  it('corrects for a device clock that runs ahead of the server', async () => {
    const { manager, server, deps } = setup();
    const skewed = new ConnectionManager({ ...deps, now: () => server.state.now + 2 * HOUR });
    const probe = await probeServer(deps, 'memoh.example');
    if (probe.kind !== 'ok') throw new Error();
    await skewed.signIn(probe, 'admin', 'admin123');
    const credential = skewed.state.kind === 'signed_in' ? skewed.state.session.credential : null;
    expect(credential!.expiresAt - credential!.receivedAt).toBe(24 * HOUR);
    void manager;
  });
});

describe('bots and sign out', () => {
  it('caches bots for the scope and sign-out removes token, data and connection', async () => {
    const { manager, vault } = await signedIn();
    const session = manager.state.kind === 'signed_in' ? manager.state.session : null;
    await manager.syncBots();
    expect((await loadBots(db, session!.scope)).map((b) => b.id)).toEqual(['bot-kitty']);
    await saveHistoryPage(
      db,
      { scope: session!.scope, botId: 'bot-kitty', sessionId: 's1' },
      { turns: [{ turn_id: 't', turn_position: 1, role: 'user', text: 'x', timestamp: 't', id: 'm' }], direction: 'latest', hasOlder: false },
      1,
    );

    await manager.signOut();
    expect(manager.state.kind).toBe('signed_out');
    expect(vault.items.size).toBe(0);
    expect(await loadBots(db, session!.scope)).toEqual([]);
    expect(await db.first(`SELECT * FROM turns`)).toBeNull();
    expect(await listConnections(db)).toEqual([]);
  });
});


describe('team switching (ID-05)', () => {
  it('moves to a new scope, keeps the old Team\u2019s data, and survives restore and re-sign-in', async () => {
    const { manager, deps, probe } = await signedIn();
    const first = manager.state.kind === 'signed_in' ? manager.state.session : null;
    const oldKey = { scope: first!.scope, botId: 'bot-kitty', sessionId: 's1' };
    await manager.syncBots();
    await saveDraft(db, oldKey, 'team A draft', 1);

    const next = await manager.switchTeam('team-b');
    expect(next.scope).not.toBe(first!.scope);
    expect(next.connection.teamId).toBe('team-b');
    // Nothing from Team A is visible under Team B, and Team A's data is untouched.
    expect(await loadBots(db, next.scope)).toEqual([]);
    expect(await loadDraft(db, { ...oldKey, scope: next.scope })).toBe('');
    expect(await loadDraft(db, oldKey)).toBe('team A draft');
    // Same credential: switching is local, the account does not sign in again.
    expect(next.credential).toEqual(first!.credential);

    const relaunched = new ConnectionManager(deps);
    const restored = await relaunched.restore();
    expect(restored.kind === 'signed_in' && restored.session.connection.teamId).toBe('team-b');

    // Signing in again as the same account keeps the chosen Team.
    await manager.signIn(probe, 'admin', 'admin123');
    expect(manager.state.kind === 'signed_in' && manager.state.session.connection.teamId).toBe('team-b');

    await manager.switchTeam(first!.connection.teamId);
    expect(manager.state.kind === 'signed_in' && manager.state.session.scope).toBe(first!.scope);
    expect(await loadDraft(db, oldKey)).toBe('team A draft');
  });

  it('refuses while signed out', async () => {
    const { manager } = setup();
    await manager.restore();
    await expect(manager.switchTeam('x')).rejects.toBeInstanceOf(NeedsSignInError);
  });
});
