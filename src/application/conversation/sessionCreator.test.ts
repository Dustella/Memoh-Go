import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '../../core/ids';
import { beginAttempt, newCreation } from '../../core/operations/sessionCreate';
import { loadSessions } from '../../data/local/conversationStore';
import { loadPendingOutbox } from '../../data/local/outboxStore';
import { loadCreation, saveCreation } from '../../data/local/sessionCreationStore';
import type { SqlDatabase } from '../../data/local/sql';
import type { FetchFn } from '../../data/remote/memohClient';
import { openNodeDatabase } from '../../../tests/support/nodeDatabase';
import { ConnectionManager, probeServer, type CredentialVault } from '../access/connectService';
import { SessionCreator } from './sessionCreator';

const flush = async () => {
  for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 0));
};

type ServerSession = { id: string; bot_id: string; title: string; created_by_user_id: string; created_at: string; updated_at: string };

/**
 * Fake Memoh with a non-idempotent POST /sessions. `loseNext` makes the next
 * POST fail on the client either after the row is written ('response') or
 * before it reaches the server ('request').
 */
function fakeServer(clock: () => number) {
  const sessions: ServerSession[] = [];
  const history = new Map<string, number>();
  const state = { loseNext: null as null | 'response' | 'request', rejectNext: 0, posts: 0 };
  const json = (status: number, body: unknown) => ({
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  });
  const fetchFn: FetchFn = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/ping') return json(200, { status: 'ok', version: 'v0.20.0', commit_hash: 'x' });
    if (u.pathname === '/auth/login')
      return json(200, { access_token: 'tok', token_type: 'Bearer', expires_at: '2099-01-01T00:00:00Z', user_id: 'u1' });
    if (u.pathname === '/users/me') return json(200, { id: 'u1', username: 'admin' });
    if (u.pathname === '/bots/bot/sessions' && init.method === 'POST') {
      state.posts += 1;
      if (state.rejectNext) {
        state.rejectNext -= 1;
        return json(403, { message: 'forbidden' });
      }
      if (state.loseNext === 'request') {
        state.loseNext = null;
        throw new Error('Network request failed');
      }
      const body = JSON.parse(init.body!) as { title: string };
      const at = new Date(clock()).toISOString();
      const row = { id: `s${sessions.length + 1}`, bot_id: 'bot', title: body.title, created_by_user_id: 'u1', created_at: at, updated_at: at };
      sessions.unshift(row);
      if (state.loseNext === 'response') {
        state.loseNext = null;
        throw new Error('Network request failed');
      }
      return json(201, row);
    }
    if (u.pathname === '/bots/bot/sessions') return json(200, { items: sessions, next_cursor: '' });
    if (u.pathname === '/bots/bot/messages') {
      const n = history.get(u.searchParams.get('session_id')!) ?? 0;
      return json(200, { items: n ? [{ turn_id: 't', role: 'user', text: 'x', timestamp: 't', turn_position: 1 }] : [] });
    }
    return json(404, { message: 'Not Found' });
  };
  return { fetchFn, sessions, history, state };
}

const memoryVault = (): CredentialVault => {
  const m = new Map();
  return { load: async (id) => m.get(id) ?? null, save: async (id, c) => void m.set(id, c), remove: async (id) => void m.delete(id) };
};

let db: SqlDatabase;
let creators: SessionCreator[] = [];
beforeEach(async () => {
  db = await openNodeDatabase();
});
afterEach(async () => {
  for (const c of creators) c.stop();
  creators = [];
  await db.close();
});

async function setup() {
  let clock = Date.parse('2026-09-29T00:00:00Z');
  const server = fakeServer(() => clock);
  const access = new ConnectionManager({ db, vault: memoryVault(), fetchFn: server.fetchFn, now: () => clock, newId });
  const probe = await probeServer({ fetchFn: server.fetchFn }, 'http://memoh.test');
  if (probe.kind !== 'ok') throw new Error(probe.kind);
  await access.signIn(probe, 'admin', 'pw');
  const make = () => {
    const c = new SessionCreator({ db, access, fetchFn: server.fetchFn, now: () => clock, newId });
    creators.push(c);
    return c;
  };
  const scope = access.state.kind === 'signed_in' ? access.state.session.scope : null!;
  return { server, access, make, scope, tick: (ms: number) => (clock += ms) };
}

describe('SessionCreator', () => {
  it('creates the session, then queues the first message under its server id', async () => {
    const { server, make, scope } = await setup();
    const creator = make();
    const intent = await creator.create('bot', 'Plan a trip to Kyoto');
    await flush();

    const done = await loadCreation(db, intent.requestId);
    expect(done).toMatchObject({ status: 'created', sessionId: 's1' });
    expect(server.state.posts).toBe(1);
    const [entry] = await loadPendingOutbox(db, scope);
    expect(entry).toMatchObject({ sessionId: 's1', invocationId: intent.invocationId, payload: { text: 'Plan a trip to Kyoto' } });
    expect((await loadSessions(db, scope, 'bot')).map((s) => s.id)).toEqual(['s1']);
  });

  it('a lost response adopts the session the server made instead of creating another', async () => {
    const { server, make, tick, scope } = await setup();
    server.state.loseNext = 'response';
    const creator = make();
    const intent = await creator.create('bot', 'hello there');
    await flush();
    expect((await loadCreation(db, intent.requestId))?.status).toBe('unknown');

    tick(3_000);
    await creator.resume();
    await flush();
    expect(await loadCreation(db, intent.requestId)).toMatchObject({ status: 'created', sessionId: 's1' });
    expect(server.sessions).toHaveLength(1);
    expect(server.state.posts).toBe(1);
    expect(await loadPendingOutbox(db, scope)).toHaveLength(1);
  });

  it('a lost request finds nothing and POSTs again', async () => {
    const { server, make, tick } = await setup();
    server.state.loseNext = 'request';
    const creator = make();
    const intent = await creator.create('bot', 'hello there');
    await flush();
    tick(3_000);
    await creator.resume();
    await flush();
    expect(await loadCreation(db, intent.requestId)).toMatchObject({ status: 'created', sessionId: 's1' });
    expect(server.state.posts).toBe(2);
    expect(server.sessions).toHaveLength(1);
  });

  it('never adopts a same-titled session that already has history', async () => {
    const { server, make, tick } = await setup();
    server.state.loseNext = 'request';
    const creator = make();
    const intent = await creator.create('bot', 'hello there');
    await flush();
    // Another client made a same-titled session meanwhile and already chatted in it.
    const at = new Date(Date.parse('2026-09-29T00:00:01Z')).toISOString();
    server.sessions.unshift({ id: 'other', bot_id: 'bot', title: 'hello there', created_by_user_id: 'u1', created_at: at, updated_at: at });
    server.history.set('other', 1);
    tick(3_000);
    await creator.resume();
    await flush();
    const done = await loadCreation(db, intent.requestId);
    expect(done?.status).toBe('created');
    expect(done?.sessionId).not.toBe('other');
  });

  it('a POST in flight when the process died is reconciled on the next launch', async () => {
    const { server, make, tick, scope } = await setup();
    // The old process wrote the intent, its POST reached the server, then it was killed.
    const now = Date.parse('2026-09-29T00:00:00Z');
    const intent = beginAttempt(newCreation({ requestId: 'r1', invocationId: 'i1', scope, botId: 'bot', text: 'survive the kill', now }), now);
    await saveCreation(db, intent);
    const at = new Date(now + 200).toISOString();
    server.sessions.unshift({ id: 's9', bot_id: 'bot', title: 'survive the kill', created_by_user_id: 'u1', created_at: at, updated_at: at });

    tick(1_000);
    const creator = make();
    await creator.resume();
    await flush();
    expect(await loadCreation(db, 'r1')).toMatchObject({ status: 'created', sessionId: 's9' });
    expect(server.state.posts).toBe(0);
    expect(await loadPendingOutbox(db, scope)).toMatchObject([{ invocationId: 'i1', sessionId: 's9' }]);
  });

  it('a definite 4xx fails; the user can retry or discard it', async () => {
    const { server, make } = await setup();
    server.state.rejectNext = 1;
    const creator = make();
    const intent = await creator.create('bot', 'nope');
    await flush();
    expect(await loadCreation(db, intent.requestId)).toMatchObject({ status: 'failed', lastError: 'forbidden' });

    await creator.retry(intent.requestId);
    await flush();
    expect(await loadCreation(db, intent.requestId)).toMatchObject({ status: 'created' });

    server.state.rejectNext = 1;
    const second = await creator.create('bot', 'again');
    await flush();
    await creator.discard(second.requestId);
    expect(await loadCreation(db, second.requestId)).toBeNull();
    expect(creator.getSnapshot().some((c) => c.requestId === second.requestId)).toBe(false);
  });
});
