import type { ScopeKey } from '../../core/identity/scope';
import { createOutboxEntry } from '../../core/operations/outbox';
import { onCreated, type CreationStatus, type SessionCreation } from '../../core/operations/sessionCreate';
import type { SessionRecord } from './conversationStore';
import { saveOutboxEntry } from './outboxStore';
import type { SqlDatabase, SqlExecutor } from './sql';

type Row = {
  request_id: string;
  scope: string;
  bot_id: string;
  title: string;
  first_message: string;
  invocation_id: string;
  status: string;
  attempts: number;
  first_attempt_at: number | null;
  next_attempt_at: number;
  session_id: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

function toCreation(row: Row): SessionCreation {
  return {
    requestId: row.request_id,
    scope: row.scope as ScopeKey,
    botId: row.bot_id,
    title: row.title,
    firstMessage: row.first_message,
    invocationId: row.invocation_id,
    status: row.status as CreationStatus,
    attempts: row.attempts,
    firstAttemptAt: row.first_attempt_at,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

/** The first message and ids never change after the intent is written. */
export async function saveCreation(db: SqlExecutor, c: SessionCreation) {
  await db.run(
    `INSERT INTO session_creations (request_id, scope, bot_id, title, first_message, invocation_id, status, attempts,
       first_attempt_at, next_attempt_at, session_id, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (request_id) DO UPDATE SET
       status = excluded.status, attempts = excluded.attempts, first_attempt_at = excluded.first_attempt_at,
       next_attempt_at = excluded.next_attempt_at, session_id = excluded.session_id,
       last_error = excluded.last_error, updated_at = excluded.updated_at`,
    [
      c.requestId,
      c.scope,
      c.botId,
      c.title,
      c.firstMessage,
      c.invocationId,
      c.status,
      c.attempts,
      c.firstAttemptAt,
      c.nextAttemptAt,
      c.sessionId,
      c.lastError,
      c.createdAt,
      c.updatedAt,
    ],
  );
}

export async function loadCreation(db: SqlExecutor, requestId: string): Promise<SessionCreation | null> {
  const row = await db.first<Row>('SELECT * FROM session_creations WHERE request_id = ?', [requestId]);
  return row ? toCreation(row) : null;
}

/** Everything not yet created (including failed, which the UI still offers to retry), oldest first. */
export async function loadUnfinishedCreations(db: SqlExecutor, scope: ScopeKey): Promise<SessionCreation[]> {
  const rows = await db.all<Row>(
    `SELECT * FROM session_creations WHERE scope = ? AND status != 'created' ORDER BY created_at, request_id`,
    [scope],
  );
  return rows.map(toCreation);
}

/** Server sessions already adopted by some creation of this scope, so two intents never share one. */
export async function loadClaimedSessionIds(db: SqlExecutor, scope: ScopeKey): Promise<Set<string>> {
  const rows = await db.all<{ session_id: string }>(
    `SELECT session_id FROM session_creations WHERE scope = ? AND session_id IS NOT NULL`,
    [scope],
  );
  return new Set(rows.map((r) => r.session_id));
}

export async function deleteCreation(db: SqlExecutor, requestId: string) {
  await db.run('DELETE FROM session_creations WHERE request_id = ?', [requestId]);
}

/**
 * The server session exists: cache it, queue the first message under its id,
 * and mark the intent created, all in one transaction. A crash can therefore
 * never leave a created session without its first message queued, or queue
 * the message twice.
 */
export async function finalizeCreation(db: SqlDatabase, c: SessionCreation, session: SessionRecord, now: number) {
  if (session.bot_id !== c.botId) throw new Error(`Session ${session.id} belongs to another bot`);
  return db.transaction(async (tx) => {
    const current = await loadCreation(tx, c.requestId);
    if (!current) throw new Error(`Creation ${c.requestId} vanished`);
    if (current.status === 'created') return current;
    await tx.run(
      `INSERT INTO sessions (scope, bot_id, session_id, title, type, server_updated_at, raw_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (scope, bot_id, session_id) DO UPDATE SET
         title = excluded.title, type = excluded.type, server_updated_at = excluded.server_updated_at,
         raw_json = excluded.raw_json, synced_at = excluded.synced_at`,
      [c.scope, c.botId, session.id, session.title, session.type, session.updated_at, JSON.stringify(session), now],
    );
    await saveOutboxEntry(
      tx,
      createOutboxEntry({
        invocationId: c.invocationId,
        scope: c.scope,
        botId: c.botId,
        sessionId: session.id,
        payload: { text: c.firstMessage },
        now,
      }),
    );
    const done = onCreated(current, session.id, now);
    await saveCreation(tx, done);
    return done;
  });
}
