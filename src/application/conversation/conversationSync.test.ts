import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Turn } from '../../core/conversation/types';
import { newId } from '../../core/ids';
import { loadHistoryCheckpoint, loadRecentTurns, loadSessions } from '../../data/local/conversationStore';
import type { SqlDatabase } from '../../data/local/sql';
import type { FetchFn } from '../../data/remote/memohClient';
import { openNodeDatabase } from '../../../tests/support/nodeDatabase';
import { ConnectionManager, probeServer, type CredentialVault } from '../access/connectService';
import { ConversationSync, HISTORY_PAGE_SIZE, pageHasOlder } from './conversationSync';

const turn = (p: number): Turn[] => [
  { turn_id: `t${p}`, turn_position: p, role: 'user', text: `q${p}`, timestamp: 't', id: `u${p}` },
  { turn_id: `t${p}`, turn_position: p, role: 'assistant', messages: [{ id: 0, type: 'text', content: `a${p}` }], timestamp: 't', id: `a${p}` },
];

/** Mirrors the dev stack: pages of whole turns, old → new, `before_message_id` exclusive. */
function fakeServer(turnCount: number, sessionCount: number) {
  const all = Array.from({ length: turnCount }, (_, i) => turn(i + 1)).flat();
  const sessions = Array.from({ length: sessionCount }, (_, i) => ({
    id: `s${i}`,
    bot_id: 'bot',
    title: `Session ${i}`,
    updated_at: new Date(Date.UTC(2026, 8, 28, 12, 0, 0) - i * 60_000).toISOString(),
  }));
  const json = (status: number, body: unknown) => ({
    status,
    headers: { get: (n: string) => (n === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
  });
  const calls: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (u.pathname === '/ping') return json(200, { status: 'ok', version: 'v0.20.0', commit_hash: 'x' });
    if (u.pathname === '/auth/login')
      return json(200, { access_token: 'tok', token_type: 'Bearer', expires_at: '2099-01-01T00:00:00Z', user_id: 'u1' });
    if (u.pathname === '/users/me') return json(200, { id: 'u1', username: 'admin' });
    if (u.pathname === '/bots/bot/sessions') {
      const limit = Number(u.searchParams.get('limit') ?? 30);
      const start = Number(u.searchParams.get('cursor') || 0);
      const next = start + limit < sessions.length ? String(start + limit) : '';
      return json(200, { items: sessions.slice(start, start + limit), next_cursor: next });
    }
    if (u.pathname === '/bots/bot/messages') {
      const limit = Number(u.searchParams.get('limit') ?? 30);
      const before = u.searchParams.get('before_message_id');
      const end = before ? all.findIndex((t) => t.id === before) : all.length;
      let start = Math.max(0, end - limit);
      while (start > 0 && all[start]!.turn_id === all[start - 1]!.turn_id) start -= 1; // align to turn start
      return json(200, { items: all.slice(start, end) });
    }
    return json(404, { message: 'Not Found' });
  };
  return { fetchFn, calls };
}

const vault = (): CredentialVault => {
  const m = new Map();
  return { load: async (id) => m.get(id) ?? null, save: async (id, c) => void m.set(id, c), remove: async (id) => void m.delete(id) };
};

let db: SqlDatabase;
beforeEach(async () => {
  db = await openNodeDatabase();
});
afterEach(async () => {
  await db.close();
});

async function setup(turnCount: number, sessionCount = 3) {
  const server = fakeServer(turnCount, sessionCount);
  const access = new ConnectionManager({ db, vault: vault(), fetchFn: server.fetchFn, now: () => Date.UTC(2026, 8, 28), newId });
  const probe = await probeServer({ fetchFn: server.fetchFn }, 'memoh.example');
  if (probe.kind !== 'ok') throw new Error(probe.kind);
  await access.signIn(probe, 'admin', 'pw');
  const scope = access.state.kind === 'signed_in' ? access.state.session.scope : null;
  return { server, sync: new ConversationSync(db, access, server.fetchFn, () => 1), key: { scope: scope!, botId: 'bot', sessionId: 's0' } };
}

describe('pageHasOlder', () => {
  it('uses the first turn position', () => {
    expect(pageHasOlder(turn(1))).toBe(false);
    expect(pageHasOlder(turn(7))).toBe(true);
    expect(pageHasOlder([])).toBe(false);
  });
});

describe('ConversationSync', () => {
  it('pages the session list into the cache', async () => {
    const { sync, key } = await setup(1, 45);
    const next = await sync.syncSessions('bot');
    expect(next).toBe('30');
    expect(await sync.syncSessions('bot', next)).toBe('');
    expect((await loadSessions(db, key.scope, 'bot', 100)).map((s) => s.id)).toHaveLength(45);
  });

  it('syncs a short session in one page and knows it is complete', async () => {
    const { sync, key } = await setup(3);
    expect(await sync.syncLatest(key)).toMatchObject({ hasOlder: false, newestTurnPosition: 3 });
    expect(await loadRecentTurns(db, key)).toHaveLength(6);
  });

  it('walks back through a long session page by page until the start', async () => {
    const { sync, key, server } = await setup(40);
    await sync.syncLatest(key);
    let checkpoint = await loadHistoryCheckpoint(db, key);
    expect(checkpoint).toMatchObject({ hasOlder: true, newestTurnPosition: 40 });
    let pages = 0;
    while (checkpoint?.hasOlder) {
      checkpoint = await sync.syncOlder(key);
      pages += 1;
      expect(pages).toBeLessThan(5);
    }
    const turns = await loadRecentTurns(db, key, 1000);
    expect(turns).toHaveLength(80);
    expect(turns[0]!.id).toBe('u1');
    expect(turns.at(-1)!.id).toBe('a40');
    // Nothing is fetched once the start is known.
    const before = server.calls.length;
    await sync.syncOlder(key);
    expect(server.calls.length).toBe(before);
    expect(HISTORY_PAGE_SIZE).toBe(30);
  });
});
