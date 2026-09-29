import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { homeKey } from '../../core/home/home';
import { scopeKey } from '../../core/identity/scope';
import { createOutboxEntry } from '../../core/operations/outbox';
import { openNodeDatabase } from '../../../tests/support/nodeDatabase';
import { replaceBots, saveRuntimeCheckpoint, upsertSessions } from './conversationStore';
import { loadHomeSessions, loadOutboxIssues, loadSavedRuns, loadSeen, markSessionSeen } from './homeStore';
import { saveOutboxEntry } from './outboxStore';
import type { SqlDatabase } from './sql';
import { clearScope } from './userStateStore';

const scope = scopeKey({ deployment: 'https://a.example', accountId: 'u1', teamId: 'default' });
const other = scopeKey({ deployment: 'https://b.example', accountId: 'u1', teamId: 'default' });

let db: SqlDatabase;
beforeEach(async () => {
  db = await openNodeDatabase();
});
afterEach(async () => {
  await db.close();
});

describe('homeStore', () => {
  it('lists sessions across bots, newest first, within the scope only', async () => {
    await replaceBots(db, scope, [{ id: 'b1', display_name: 'Kitty' }, { id: 'b2', name: 'Other' }], 0);
    await replaceBots(db, other, [{ id: 'b1', display_name: 'Elsewhere' }], 0);
    await upsertSessions(db, scope, 'b1', [{ id: 's1', bot_id: 'b1', title: 'one', updated_at: '2026-09-29T01:00:00Z' }], 0);
    await upsertSessions(db, scope, 'b2', [{ id: 's2', bot_id: 'b2', updated_at: '2026-09-29T02:00:00Z' }], 0);
    await upsertSessions(db, other, 'b1', [{ id: 'x', bot_id: 'b1', updated_at: '2026-09-29T03:00:00Z' }], 0);

    expect(await loadHomeSessions(db, scope)).toEqual([
      { botId: 'b2', botName: 'Other', sessionId: 's2', title: '', updatedAt: '2026-09-29T02:00:00Z' },
      { botId: 'b1', botName: 'Kitty', sessionId: 's1', title: 'one', updatedAt: '2026-09-29T01:00:00Z' },
    ]);
  });

  it('summarises saved runs and outbox issues per session', async () => {
    await saveRuntimeCheckpoint(db, { scope, botId: 'b1', sessionId: 's1' }, {
      epoch: 'e',
      seq: 1,
      savedAt: 10,
      run: {
        run_id: 'r',
        turn_id: 't',
        status: 'waiting_decision',
        started_at: '',
        updated_at: '2026-09-29T01:00:00Z',
        messages: [{ id: 0, type: 'tool', approval: { approval_id: 'a', status: 'pending' } }],
      },
    });
    const entry = (id: string, patch: object) => ({
      ...createOutboxEntry({ invocationId: id, scope, botId: 'b1', sessionId: 's2', payload: { text: 'x' }, now: 0 }),
      ...patch,
    });
    await saveOutboxEntry(db, entry('q', {}));
    await saveOutboxEntry(db, entry('u', { status: 'unconfirmed', needsUser: true }));
    await saveOutboxEntry(db, entry('f', { status: 'failed', lastCode: 'session_invocation_conflict' }));
    await saveOutboxEntry(db, entry('d', { status: 'failed', lastCode: 'discarded' }));
    await saveOutboxEntry(db, entry('ok', { status: 'settled' }));

    const runs = await loadSavedRuns(db, scope);
    expect(runs.get(homeKey('b1', 's1'))).toMatchObject({ status: 'waiting_decision', decision: 'approval', observedAt: 10 });
    expect(await loadOutboxIssues(db, scope)).toEqual(new Map([[homeKey('b1', 's2'), { queued: 1, unsure: 1, failed: 1 }]]));
  });

  it('keeps the latest seen time and clears with the scope', async () => {
    await markSessionSeen(db, scope, 'b1', 's1', 20);
    await markSessionSeen(db, scope, 'b1', 's1', 10);
    expect(await loadSeen(db, scope)).toEqual(new Map([[homeKey('b1', 's1'), 20]]));
    await clearScope(db, scope);
    expect((await loadSeen(db, scope)).size).toBe(0);
  });
});
