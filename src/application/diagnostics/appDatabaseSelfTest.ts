import type { Turn } from '../../core/conversation/types';
import { scopeKey } from '../../core/identity/scope';
import { newId, randomSource } from '../../core/ids';
import { createOutboxEntry, markSent } from '../../core/operations/outbox';
import {
  loadHistoryCheckpoint,
  loadRecentTurns,
  saveHistoryPage,
  type SessionKey,
} from '../../data/local/conversationStore';
import { openExpoDatabase } from '../../data/local/expoDatabase';
import { SCHEMA_VERSION } from '../../data/local/migrations';
import { saveOutboxEntry, loadOutboxEntry, markOutboxColdStart } from '../../data/local/outboxStore';
import { clearScope, loadDraft, saveDraft } from '../../data/local/userStateStore';
import { installPlatformCrypto } from '../../platform/installPlatformCrypto';

installPlatformCrypto();

/**
 * Development-only check of the real stores through expo-sqlite, in its own
 * database file. The unit tests use Node's SQLite; this proves the device
 * driver, transactions and persistence across a process kill.
 */
export type SelfTestCheck = Readonly<{ name: string; ok: boolean; detail: string }>;

const FILE = 'memoh-go-selftest.db';
const scope = scopeKey({ deployment: 'https://selftest.invalid', accountId: 'selftest', teamId: 'selftest' });
const key: SessionKey = { scope, botId: 'bot', sessionId: 'session' };
const MARKER = 'launch-marker';

export async function runAppDatabaseSelfTest(): Promise<SelfTestCheck[]> {
  const checks: SelfTestCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const db = await openExpoDatabase(FILE);
  try {
    const version = await db.first<{ user_version: number }>('PRAGMA user_version');
    check('schema', version?.user_version === SCHEMA_VERSION, `user_version=${version?.user_version}`);
    const sample = newId();
    check(
      'id generator',
      randomSource() !== 'math' && /^[0-9a-f-]{36}$/.test(sample),
      `${randomSource()} · ${sample}`,
    );

    const previousMarker = await loadDraft(db, { ...key, sessionId: MARKER });
    const previousOutbox = await loadOutboxEntry(db, 'selftest-sent');
    const recovered = await markOutboxColdStart(db, Date.now());
    const afterColdStart = await loadOutboxEntry(db, 'selftest-sent');
    check(
      'survives restart',
      previousMarker === '' || previousMarker.startsWith('run@'),
      previousMarker ? `previous run: ${previousMarker}` : 'first run: kill the app and run again',
    );
    check(
      'cold start recovery',
      previousOutbox === null || afterColdStart?.status === 'unconfirmed',
      previousOutbox ? `sent → ${afterColdStart?.status} (${recovered} recovered)` : 'first run: no pending send yet',
    );

    await clearScope(db, scope);

    let rolledBack = false;
    try {
      await db.transaction(async (tx) => {
        await saveDraft(tx, key, 'must not persist', 1);
        throw new Error('rollback');
      });
    } catch {
      rolledBack = (await loadDraft(db, key)) === '';
    }
    check('transaction rollback', rolledBack, rolledBack ? 'write discarded' : 'write leaked');

    const turns: Turn[] = [1, 2, 3].flatMap((position) => [
      { turn_id: `t${position}`, turn_position: position, role: 'user' as const, text: `q${position}`, timestamp: 't', id: `u${position}` },
      {
        turn_id: `t${position}`,
        turn_position: position,
        role: 'assistant' as const,
        messages: [{ id: 0, type: 'text' as const, content: `答复 ${position} ✅` }],
        timestamp: 't',
        id: `a${position}`,
      },
    ]);
    await saveOutboxEntry(
      db,
      {
        ...markSent(createOutboxEntry({ invocationId: 'selftest-accepted', scope, botId: 'bot', sessionId: 'session', payload: { text: 'q3' }, now: 1 }), 2),
        status: 'accepted',
        runId: 'r3',
        turnId: 't3',
      },
    );
    const page = await saveHistoryPage(db, key, { turns, direction: 'latest', hasOlder: false }, Date.now());
    const loaded = await loadRecentTurns(db, key);
    const checkpoint = await loadHistoryCheckpoint(db, key);
    check(
      'history + checkpoint',
      JSON.stringify(loaded) === JSON.stringify(turns) && checkpoint?.newestTurnPosition === 3,
      `${loaded.length} rows, newest position ${checkpoint?.newestTurnPosition}`,
    );
    check(
      'outbox settled with history',
      page.settledOutbox === 1 && (await loadOutboxEntry(db, 'selftest-accepted'))?.status === 'settled',
      `settled ${page.settledOutbox}`,
    );

    // Leave state for the next launch: a marker and an in-flight send.
    const marker = `run@${new Date().toISOString()}`;
    await saveDraft(db, { ...key, sessionId: MARKER }, marker, Date.now());
    await saveOutboxEntry(
      db,
      markSent(createOutboxEntry({ invocationId: 'selftest-sent', scope, botId: 'bot', sessionId: 'session', payload: { text: 'in flight' }, now: Date.now() }), Date.now()),
    );
    check('state left for next launch', (await loadDraft(db, { ...key, sessionId: MARKER })) === marker, marker);
  } catch (error) {
    check('unexpected error', false, error instanceof Error ? error.message : String(error));
  } finally {
    await db.close();
  }
  return checks;
}
