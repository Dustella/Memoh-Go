import type { ScopeKey } from '../../core/identity/scope';
import { onColdStart, type MessagePayload, type OutboxEntry, type OutboxStatus } from '../../core/operations/outbox';
import type { SqlDatabase, SqlExecutor } from './sql';

type OutboxRow = {
  invocation_id: string;
  scope: string;
  bot_id: string;
  session_id: string;
  payload_json: string;
  status: string;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
  updated_at: number;
  run_id: string | null;
  turn_id: string | null;
  last_code: string | null;
  needs_user: number;
};

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    invocationId: row.invocation_id,
    scope: row.scope as ScopeKey,
    botId: row.bot_id,
    sessionId: row.session_id,
    payload: JSON.parse(row.payload_json) as MessagePayload,
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    ...(row.last_code ? { lastCode: row.last_code } : {}),
    ...(row.needs_user ? { needsUser: true } : {}),
  };
}

/**
 * Persist an entry. The payload is immutable for the life of the entry, so an
 * existing row keeps its stored payload even if a caller passes another one.
 */
export async function saveOutboxEntry(db: SqlExecutor, entry: OutboxEntry): Promise<void> {
  await db.run(
    `INSERT INTO outbox (invocation_id, scope, bot_id, session_id, payload_json, status, attempts,
       next_attempt_at, created_at, updated_at, run_id, turn_id, last_code, needs_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (invocation_id) DO UPDATE SET
       status = excluded.status, attempts = excluded.attempts, next_attempt_at = excluded.next_attempt_at,
       updated_at = excluded.updated_at, run_id = excluded.run_id, turn_id = excluded.turn_id,
       last_code = excluded.last_code, needs_user = excluded.needs_user`,
    [
      entry.invocationId,
      entry.scope,
      entry.botId,
      entry.sessionId,
      JSON.stringify(entry.payload),
      entry.status,
      entry.attempts,
      entry.nextAttemptAt,
      entry.createdAt,
      entry.updatedAt,
      entry.runId,
      entry.turnId,
      entry.lastCode,
      Boolean(entry.needsUser),
    ],
  );
}

/** Unfinished entries of one scope, oldest first. */
export async function loadPendingOutbox(db: SqlExecutor, scope: ScopeKey): Promise<OutboxEntry[]> {
  const rows = await db.all<OutboxRow>(
    `SELECT * FROM outbox WHERE scope = ? AND status NOT IN ('settled', 'failed') ORDER BY created_at, invocation_id`,
    [scope],
  );
  return rows.map(toEntry);
}

export async function loadOutboxEntry(db: SqlExecutor, invocationId: string): Promise<OutboxEntry | null> {
  const row = await db.first<OutboxRow>('SELECT * FROM outbox WHERE invocation_id = ?', [invocationId]);
  return row ? toEntry(row) : null;
}

/** Failed entries the UI still shows; settled ones are history and can be pruned. */
export async function loadFailedOutbox(db: SqlExecutor, scope: ScopeKey, sessionId: string): Promise<OutboxEntry[]> {
  const rows = await db.all<OutboxRow>(
    `SELECT * FROM outbox WHERE scope = ? AND session_id = ? AND status = 'failed' ORDER BY created_at`,
    [scope, sessionId],
  );
  return rows.map(toEntry);
}

/** Cold start: every `sent` entry lost its ack with the old process. */
export async function markOutboxColdStart(db: SqlDatabase, now: number): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx.all<OutboxRow>(`SELECT * FROM outbox WHERE status = 'sent'`);
    const next = onColdStart(rows.map(toEntry), now);
    for (const entry of next) await saveOutboxEntry(tx, entry);
    return next.length;
  });
}

export async function pruneSettledOutbox(db: SqlExecutor, olderThan: number): Promise<number> {
  const { changes } = await db.run(`DELETE FROM outbox WHERE status = 'settled' AND updated_at < ?`, [olderThan]);
  return changes;
}


/**
 * CH-16: payloads whose staged files are still needed, in every scope: an
 * unfinished send, or a failed one the user can still resend. Settled and
 * discarded messages no longer need their files.
 */
export async function loadPayloadsWithAttachments(db: SqlExecutor): Promise<MessagePayload[]> {
  const rows = await db.all<{ payload_json: string }>(
    `SELECT payload_json FROM outbox
     WHERE payload_json LIKE '%"attachments"%'
       AND status <> 'settled' AND NOT (status = 'failed' AND last_code = 'discarded')`,
  );
  return rows.map((r) => JSON.parse(r.payload_json) as MessagePayload);
}
