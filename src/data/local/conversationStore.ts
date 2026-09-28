import type { RunView, Turn } from '../../core/conversation/types';
import type { ScopeKey } from '../../core/identity/scope';
import type { SqlDatabase, SqlExecutor } from './sql';

export type SessionKey = Readonly<{ scope: ScopeKey; botId: string; sessionId: string }>;

// ---------------------------------------------------------------- bots

export type BotRecord = Readonly<{
  id: string;
  display_name?: string;
  name?: string;
  status?: string;
  is_active?: boolean;
}>;

/** Replace the scope's bot list with the server's (the list is not paginated). */
export async function replaceBots(db: SqlDatabase, scope: ScopeKey, bots: readonly BotRecord[], now: number) {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM bots WHERE scope = ?', [scope]);
    for (const bot of bots) {
      await tx.run(
        `INSERT INTO bots (scope, bot_id, display_name, status, is_active, raw_json, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [scope, bot.id, bot.display_name || bot.name || bot.id, bot.status, bot.is_active ?? true, JSON.stringify(bot), now],
      );
    }
  });
}

export async function loadBots(db: SqlExecutor, scope: ScopeKey): Promise<BotRecord[]> {
  const rows = await db.all<{ raw_json: string }>(
    'SELECT raw_json FROM bots WHERE scope = ? ORDER BY display_name COLLATE NOCASE, bot_id',
    [scope],
  );
  return rows.map((row) => JSON.parse(row.raw_json) as BotRecord);
}

// ---------------------------------------------------------------- sessions

export type SessionRecord = Readonly<{
  id: string;
  bot_id: string;
  title?: string;
  type?: string;
  updated_at?: string;
}>;

/** Upsert a page of the server's session list (newest first). */
export async function upsertSessions(
  db: SqlDatabase,
  scope: ScopeKey,
  botId: string,
  sessions: readonly SessionRecord[],
  now: number,
) {
  await db.transaction(async (tx) => {
    for (const session of sessions) {
      if (session.bot_id !== botId) throw new Error(`Session ${session.id} belongs to another bot`);
      await tx.run(
        `INSERT INTO sessions (scope, bot_id, session_id, title, type, server_updated_at, raw_json, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (scope, bot_id, session_id) DO UPDATE SET
           title = excluded.title, type = excluded.type, server_updated_at = excluded.server_updated_at,
           raw_json = excluded.raw_json, synced_at = excluded.synced_at`,
        [scope, botId, session.id, session.title, session.type, session.updated_at, JSON.stringify(session), now],
      );
    }
  });
}

export async function loadSessions(db: SqlExecutor, scope: ScopeKey, botId: string, limit = 50) {
  const rows = await db.all<{ raw_json: string }>(
    `SELECT raw_json FROM sessions WHERE scope = ? AND bot_id = ?
     ORDER BY server_updated_at DESC, session_id LIMIT ?`,
    [scope, botId, limit],
  );
  return rows.map((row) => JSON.parse(row.raw_json) as SessionRecord);
}

// ---------------------------------------------------------------- history

export type HistoryCheckpoint = Readonly<{
  newestTurnPosition: number | null;
  oldestMessageId: string | null;
  hasOlder: boolean;
  syncedAt: number;
}>;

export type HistoryPage = Readonly<{
  /** Persisted turns, old → new, as returned by `GET /bots/:bot/messages`. */
  turns: readonly Turn[];
  /** `latest`: the newest page. `older`: the page before the cached oldest message. */
  direction: 'latest' | 'older';
  /** More history exists before this page. */
  hasOlder: boolean;
}>;

async function readCheckpoint(db: SqlExecutor, key: SessionKey): Promise<HistoryCheckpoint | null> {
  const row = await db.first<{
    newest_turn_position: number | null;
    oldest_message_id: string | null;
    has_older: number;
    synced_at: number;
  }>(
    'SELECT * FROM history_checkpoint WHERE scope = ? AND bot_id = ? AND session_id = ?',
    [key.scope, key.botId, key.sessionId],
  );
  if (!row) return null;
  return {
    newestTurnPosition: row.newest_turn_position,
    oldestMessageId: row.oldest_message_id,
    hasOlder: Boolean(row.has_older),
    syncedAt: row.synced_at,
  };
}

export function loadHistoryCheckpoint(db: SqlExecutor, key: SessionKey) {
  return readCheckpoint(db, key);
}

const where = 'scope = ? AND bot_id = ? AND session_id = ?';
const keyParams = (key: SessionKey) => [key.scope, key.botId, key.sessionId];

/**
 * Merge one history page and its checkpoint in a single transaction, and
 * settle outbox entries whose turn is now persisted. The local copy never has
 * holes: a latest page that neither overlaps the cache nor reaches the start
 * of the session replaces the cache.
 */
export async function saveHistoryPage(db: SqlDatabase, key: SessionKey, page: HistoryPage, now: number) {
  for (const turn of page.turns) {
    if (typeof turn.turn_position !== 'number') throw new Error(`Turn ${turn.turn_id} is not persisted`);
  }

  return db.transaction(async (tx) => {
    const previous = await readCheckpoint(tx, key);
    const pageIds = [...new Set(page.turns.map((turn) => turn.turn_id))];

    let replace = false;
    if (previous && page.direction === 'latest' && page.hasOlder && pageIds.length > 0) {
      const marks = pageIds.map(() => '?').join(',');
      const overlap = await tx.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM turns WHERE ${where} AND turn_id IN (${marks})`,
        [...keyParams(key), ...pageIds],
      );
      replace = (overlap?.n ?? 0) === 0;
    }
    if (replace) await tx.run(`DELETE FROM turns WHERE ${where}`, keyParams(key));

    const rowInTurn = new Map<string, number>();
    for (const turn of page.turns) {
      const index = rowInTurn.get(turn.turn_id) ?? 0;
      rowInTurn.set(turn.turn_id, index + 1);
      await tx.run(
        `INSERT INTO turns (scope, bot_id, session_id, turn_id, role, turn_position, row_in_turn, message_id, body_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (scope, bot_id, session_id, turn_id, role) DO UPDATE SET
           turn_position = excluded.turn_position, row_in_turn = excluded.row_in_turn,
           message_id = excluded.message_id, body_json = excluded.body_json`,
        [...keyParams(key), turn.turn_id, turn.role, turn.turn_position!, index, turn.id, JSON.stringify(turn)],
      );
    }

    const pageNewest = page.turns.reduce<number | null>(
      (max, turn) => (max === null || turn.turn_position! > max ? turn.turn_position! : max),
      null,
    );
    const pageOldestId = page.turns[0]?.id ?? null;
    const fresh = !previous || replace;
    const checkpoint: HistoryCheckpoint = {
      newestTurnPosition:
        fresh || previous.newestTurnPosition === null
          ? pageNewest
          : pageNewest === null
            ? previous.newestTurnPosition
            : Math.max(previous.newestTurnPosition, pageNewest),
      oldestMessageId:
        fresh || page.direction === 'older' ? (pageOldestId ?? previous?.oldestMessageId ?? null) : previous.oldestMessageId,
      hasOlder: fresh || page.direction === 'older' ? page.hasOlder : previous.hasOlder,
      syncedAt: now,
    };
    await tx.run(
      `INSERT INTO history_checkpoint (scope, bot_id, session_id, newest_turn_position, oldest_message_id, has_older, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (scope, bot_id, session_id) DO UPDATE SET
         newest_turn_position = excluded.newest_turn_position, oldest_message_id = excluded.oldest_message_id,
         has_older = excluded.has_older, synced_at = excluded.synced_at`,
      [...keyParams(key), checkpoint.newestTurnPosition, checkpoint.oldestMessageId, checkpoint.hasOlder, now],
    );

    let settled = 0;
    if (pageIds.length > 0) {
      const marks = pageIds.map(() => '?').join(',');
      settled = (
        await tx.run(
          `UPDATE outbox SET status = 'settled', updated_at = ?
           WHERE ${where} AND status = 'accepted' AND turn_id IN (${marks})`,
          [now, ...keyParams(key), ...pageIds],
        )
      ).changes;
    }
    return { checkpoint, replaced: replace, settledOutbox: settled };
  });
}

/** The newest `limit` persisted turns, old → new. */
export async function loadRecentTurns(db: SqlExecutor, key: SessionKey, limit = 60): Promise<Turn[]> {
  const rows = await db.all<{ body_json: string }>(
    `SELECT body_json FROM turns WHERE ${where}
     ORDER BY turn_position DESC, row_in_turn DESC LIMIT ?`,
    [...keyParams(key), limit],
  );
  return rows.reverse().map((row) => JSON.parse(row.body_json) as Turn);
}

/** Persisted turns strictly older than `turnPosition`, old → new. */
export async function loadTurnsBefore(db: SqlExecutor, key: SessionKey, turnPosition: number, limit = 60) {
  const rows = await db.all<{ body_json: string }>(
    `SELECT body_json FROM turns WHERE ${where} AND turn_position < ?
     ORDER BY turn_position DESC, row_in_turn DESC LIMIT ?`,
    [...keyParams(key), turnPosition, limit],
  );
  return rows.reverse().map((row) => JSON.parse(row.body_json) as Turn);
}

// ---------------------------------------------------------------- runtime

export type RuntimeCheckpoint = Readonly<{ epoch: string; seq: number; run: RunView | null; savedAt: number }>;

/**
 * Last live projection, for showing a running turn instantly after a cold
 * start. It is display state only: the stream must still resubscribe and
 * adopt a fresh snapshot before applying deltas (sync/runtimeStream.ts).
 */
export async function saveRuntimeCheckpoint(db: SqlExecutor, key: SessionKey, checkpoint: RuntimeCheckpoint) {
  await db.run(
    `INSERT INTO runtime_checkpoint (scope, bot_id, session_id, epoch, seq, run_json, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope, bot_id, session_id) DO UPDATE SET
       epoch = excluded.epoch, seq = excluded.seq, run_json = excluded.run_json, saved_at = excluded.saved_at`,
    [...keyParams(key), checkpoint.epoch, checkpoint.seq, checkpoint.run ? JSON.stringify(checkpoint.run) : null, checkpoint.savedAt],
  );
}

export async function loadRuntimeCheckpoint(db: SqlExecutor, key: SessionKey): Promise<RuntimeCheckpoint | null> {
  const row = await db.first<{ epoch: string; seq: number; run_json: string | null; saved_at: number }>(
    `SELECT epoch, seq, run_json, saved_at FROM runtime_checkpoint WHERE ${where}`,
    keyParams(key),
  );
  if (!row) return null;
  return {
    epoch: row.epoch,
    seq: row.seq,
    run: row.run_json ? (JSON.parse(row.run_json) as RunView) : null,
    savedAt: row.saved_at,
  };
}
