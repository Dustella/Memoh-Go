import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import capturedHistory from '../../../contracts/fixtures/captured/markdown-turn.history.json';
import type { Turn } from '../../core/conversation/types';
import { scopeKey } from '../../core/identity/scope';
import { createOutboxEntry, markSent, onRunAccepted } from '../../core/operations/outbox';
import { openNodeDatabase } from '../../../tests/support/nodeDatabase';
import {
  loadBots,
  loadHistoryCheckpoint,
  loadRecentTurns,
  loadRuntimeCheckpoint,
  loadSessions,
  loadTurnsBefore,
  replaceBots,
  saveHistoryPage,
  saveRuntimeCheckpoint,
  upsertSessions,
  type SessionKey,
} from './conversationStore';
import { MIGRATIONS, SCHEMA_VERSION, UnsupportedSchemaError, migrate } from './migrations';
import { loadOutboxEntry, loadPendingOutbox, markOutboxColdStart, saveOutboxEntry } from './outboxStore';
import type { SqlDatabase } from './sql';
import {
  clearScope,
  loadCapabilities,
  loadDraft,
  loadReadingAnchor,
  saveCapabilities,
  saveDraft,
  saveReadingAnchor,
} from './userStateStore';

const scopeA = scopeKey({ deployment: 'https://a.example', accountId: 'u1', teamId: 'default' });
const scopeB = scopeKey({ deployment: 'https://b.example', accountId: 'u1', teamId: 'default' });
const key: SessionKey = { scope: scopeA, botId: 'bot1', sessionId: 'sess1' };

function turnPair(position: number): Turn[] {
  const turnId = `turn_${position}`;
  return [
    { turn_id: turnId, turn_position: position, role: 'user', text: `q${position}`, timestamp: 't', id: `m${position}u` },
    {
      turn_id: turnId,
      turn_position: position,
      role: 'assistant',
      messages: [{ id: 0, type: 'text', content: `a${position}` }],
      timestamp: 't',
      id: `m${position}a`,
    },
  ];
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => turnPair(from + i)).flat();

let db: SqlDatabase;
beforeEach(async () => {
  db = await openNodeDatabase();
});
afterEach(async () => {
  await db.close();
});

describe('migrations', () => {
  it('creates the current schema and is a no-op when rerun', async () => {
    expect((await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(SCHEMA_VERSION);
    await expect(migrate(db)).resolves.toBe(SCHEMA_VERSION);
  });

  it('refuses a file written by a newer app build', async () => {
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toBeInstanceOf(UnsupportedSchemaError);
  });

  it('rolls back a failed migration together with its version bump', async () => {
    const fresh = await openNodeDatabase(':memory:', { migrate: false });
    const broken = { version: SCHEMA_VERSION, up: `${MIGRATIONS[0]!.up}\nCREATE TABLE bots (x INTEGER);` };
    await expect(
      fresh.transaction(async (tx) => {
        await tx.exec(broken.up);
        await tx.exec(`PRAGMA user_version = ${broken.version}`);
      }),
    ).rejects.toThrow();
    expect((await fresh.first<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(0);
    expect(await fresh.first(`SELECT name FROM sqlite_master WHERE name = 'outbox'`)).toBeNull();
    await fresh.close();
  });

  it('keeps data across close and reopen of a file', async () => {
    const dir = mkdtempSync(`${tmpdir()}/memoh-go-db-`);
    try {
      const path = `${dir}/app.db`;
      const first = await openNodeDatabase(path);
      await saveDraft(first, key, 'half-written thought', 1);
      await first.close();
      const second = await openNodeDatabase(path);
      expect(await loadDraft(second, key)).toBe('half-written thought');
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('outbox store', () => {
  const entry = (id: string, scope = scopeA, now = 1) =>
    createOutboxEntry({ invocationId: id, scope, botId: 'bot1', sessionId: 'sess1', payload: { text: `hi ${id}` }, now });

  it('round-trips entries and keeps the payload immutable', async () => {
    const sent = markSent(entry('inv1'), 2);
    await saveOutboxEntry(db, sent);
    await saveOutboxEntry(db, { ...sent, payload: { text: 'tampered' }, attempts: 5 });
    expect(await loadOutboxEntry(db, 'inv1')).toEqual({ ...sent, attempts: 5 });
  });

  it('marks sent entries unconfirmed on cold start and lists only the active scope', async () => {
    await saveOutboxEntry(db, markSent(entry('inv1', scopeA, 1), 2));
    await saveOutboxEntry(db, entry('inv2', scopeA, 3));
    await saveOutboxEntry(db, markSent(entry('inv3', scopeB, 4), 5));
    expect(await markOutboxColdStart(db, 100)).toBe(2);

    const pending = await loadPendingOutbox(db, scopeA);
    expect(pending.map((e) => [e.invocationId, e.status])).toEqual([
      ['inv1', 'unconfirmed'],
      ['inv2', 'queued'],
    ]);
    expect((await loadPendingOutbox(db, scopeB)).map((e) => e.invocationId)).toEqual(['inv3']);
  });
});

describe('history', () => {
  it('stores a real captured page in server order', async () => {
    const turns = (capturedHistory as { items: Turn[] }).items;
    await saveHistoryPage(db, key, { turns, direction: 'latest', hasOlder: false }, 10);
    expect(await loadRecentTurns(db, key)).toEqual(turns);
    expect(await loadHistoryCheckpoint(db, key)).toEqual({
      newestTurnPosition: 1,
      oldestMessageId: turns[0]!.id,
      hasOlder: false,
      syncedAt: 10,
    });
  });

  it('extends the cache with newer and older pages without duplicates', async () => {
    await saveHistoryPage(db, key, { turns: range(5, 8), direction: 'latest', hasOlder: true }, 1);
    await saveHistoryPage(db, key, { turns: range(7, 10), direction: 'latest', hasOlder: true }, 2);
    await saveHistoryPage(db, key, { turns: range(1, 4), direction: 'older', hasOlder: false }, 3);

    const all = await loadRecentTurns(db, key, 100);
    expect(all.map((t) => `${t.turn_position}${t.role[0]}`)).toEqual(
      range(1, 10).map((t) => `${t.turn_position}${t.role[0]}`),
    );
    expect(await loadHistoryCheckpoint(db, key)).toMatchObject({ newestTurnPosition: 10, oldestMessageId: 'm1u', hasOlder: false });
    expect((await loadTurnsBefore(db, key, 3, 10)).map((t) => t.turn_position)).toEqual([1, 1, 2, 2]);
    expect((await loadRecentTurns(db, key, 3)).map((t) => t.id)).toEqual(['m9a', 'm10u', 'm10a']);
  });

  it('replaces the cache instead of leaving a hole when the latest page does not overlap', async () => {
    await saveHistoryPage(db, key, { turns: range(1, 4), direction: 'latest', hasOlder: false }, 1);
    const result = await saveHistoryPage(db, key, { turns: range(20, 23), direction: 'latest', hasOlder: true }, 2);
    expect(result.replaced).toBe(true);
    expect((await loadRecentTurns(db, key, 100)).map((t) => t.turn_position)).toEqual([20, 20, 21, 21, 22, 22, 23, 23]);
    expect(await loadHistoryCheckpoint(db, key)).toMatchObject({ oldestMessageId: 'm20u', hasOlder: true });
  });

  it('refuses live turns without a position and writes nothing', async () => {
    const live = { turn_id: 'x', role: 'assistant', timestamp: 't' } as Turn;
    await expect(saveHistoryPage(db, key, { turns: [live], direction: 'latest', hasOlder: false }, 1)).rejects.toThrow();
    expect(await loadHistoryCheckpoint(db, key)).toBeNull();
  });

  it('settles the accepted outbox entry in the same transaction that persists its turn', async () => {
    const accepted = onRunAccepted(
      markSent(createOutboxEntry({ invocationId: 'inv1', scope: scopeA, botId: 'bot1', sessionId: 'sess1', payload: { text: 'q3' }, now: 1 }), 2),
      { run_id: 'run3', turn_id: 'turn_3' },
      3,
    );
    await saveOutboxEntry(db, accepted);
    const result = await saveHistoryPage(db, key, { turns: range(1, 3), direction: 'latest', hasOlder: false }, 9);
    expect(result.settledOutbox).toBe(1);
    expect((await loadOutboxEntry(db, 'inv1'))?.status).toBe('settled');
  });
});

describe('bots, sessions and runtime checkpoints', () => {
  it('replaces bots per scope and pages sessions newest first', async () => {
    await replaceBots(db, scopeA, [{ id: 'b2', display_name: 'Zed' }, { id: 'b1', display_name: 'alpha' }], 1);
    await replaceBots(db, scopeB, [{ id: 'b9', name: 'other' }], 1);
    await replaceBots(db, scopeA, [{ id: 'b1', display_name: 'alpha' }, { id: 'b3', name: 'kitty' }], 2);
    expect((await loadBots(db, scopeA)).map((b) => b.id)).toEqual(['b1', 'b3']);
    expect((await loadBots(db, scopeB)).map((b) => b.id)).toEqual(['b9']);

    await upsertSessions(db, scopeA, 'b1', [
      { id: 's1', bot_id: 'b1', title: 'old', updated_at: '2026-09-01T00:00:00Z' },
      { id: 's2', bot_id: 'b1', title: 'new', updated_at: '2026-09-28T00:00:00Z' },
    ], 1);
    await upsertSessions(db, scopeA, 'b1', [{ id: 's1', bot_id: 'b1', title: 'renamed', updated_at: '2026-09-29T00:00:00Z' }], 2);
    expect((await loadSessions(db, scopeA, 'b1')).map((s) => s.title)).toEqual(['renamed', 'new']);
    await expect(upsertSessions(db, scopeA, 'b1', [{ id: 's3', bot_id: 'b2' }], 3)).rejects.toThrow();
    expect(await loadSessions(db, scopeA, 'b2')).toEqual([]);
  });

  it('keeps the last live projection', async () => {
    const run = { run_id: 'r', turn_id: 't', status: 'running', started_at: 's', updated_at: 'u', messages: [] };
    await saveRuntimeCheckpoint(db, key, { epoch: 'e1', seq: 7, run, savedAt: 1 });
    await saveRuntimeCheckpoint(db, key, { epoch: 'e1', seq: 9, run: null, savedAt: 2 });
    expect(await loadRuntimeCheckpoint(db, key)).toEqual({ epoch: 'e1', seq: 9, run: null, savedAt: 2 });
  });
});

describe('user state and scope isolation', () => {
  it('stores drafts and reading anchors per session', async () => {
    await saveDraft(db, key, 'draft', 1);
    expect(await loadDraft(db, { ...key, scope: scopeB })).toBe('');
    await saveDraft(db, key, '', 2);
    expect(await loadDraft(db, key)).toBe('');

    expect(await loadReadingAnchor(db, key)).toBeNull();
    await saveReadingAnchor(db, key, { atBottom: false, turnId: 'turn_3', role: 'assistant', blockId: 2, offsetPx: 118.5 }, 1);
    expect(await loadReadingAnchor(db, key)).toEqual({ atBottom: false, turnId: 'turn_3', role: 'assistant', blockId: 2, offsetPx: 118.5 });
    await saveReadingAnchor(db, key, { atBottom: true }, 2);
    expect(await loadReadingAnchor(db, key)).toEqual({ atBottom: true });
  });

  it('round-trips learned server capabilities', async () => {
    const caps = { serverKey: 'https://a.example|v0.20.0|abc', invocationLookup: 'no', admissionDedup: 'yes' } as const;
    await saveCapabilities(db, caps, 1);
    expect(await loadCapabilities(db, caps.serverKey)).toEqual(caps);
    expect(await loadCapabilities(db, 'other')).toBeUndefined();
  });

  it('clears one scope completely and leaves the other untouched', async () => {
    for (const scope of [scopeA, scopeB]) {
      const k = { ...key, scope };
      await replaceBots(db, scope, [{ id: 'bot1' }], 1);
      await saveHistoryPage(db, k, { turns: range(1, 2), direction: 'latest', hasOlder: false }, 1);
      await saveDraft(db, k, 'd', 1);
      await saveOutboxEntry(db, createOutboxEntry({ invocationId: `inv-${scope}`, scope, botId: 'bot1', sessionId: 'sess1', payload: { text: 'x' }, now: 1 }));
    }
    await clearScope(db, scopeA);
    expect(await loadRecentTurns(db, key)).toEqual([]);
    expect(await loadPendingOutbox(db, scopeA)).toEqual([]);
    expect(await loadDraft(db, key)).toBe('');
    expect(await loadRecentTurns(db, { ...key, scope: scopeB })).toHaveLength(4);
    expect(await loadPendingOutbox(db, scopeB)).toHaveLength(1);
  });

  it('rolls back every write of a failed transaction', async () => {
    await expect(
      db.transaction(async (tx) => {
        await saveDraft(tx, key, 'lost', 1);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await loadDraft(db, key)).toBe('');
  });

  it('queues concurrent transactions and keeps outside writes out of an open one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = db
      .transaction(async (tx) => {
        await saveDraft(tx, key, 'inside', 1);
        await gate;
        throw new Error('abort');
      })
      .catch(() => 'aborted');
    const outside = saveDraft(db, { ...key, sessionId: 'other' }, 'outside', 2);
    const second = db.transaction(async (tx) => saveDraft(tx, { ...key, sessionId: 'third' }, 'third', 3));
    release();
    expect(await slow).toBe('aborted');
    await Promise.all([outside, second]);
    expect(await loadDraft(db, key)).toBe('');
    expect(await loadDraft(db, { ...key, sessionId: 'other' })).toBe('outside');
    expect(await loadDraft(db, { ...key, sessionId: 'third' })).toBe('third');
  });
});
