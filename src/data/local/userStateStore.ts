import type { Known, ServerCapabilities } from '../../core/identity/capabilities';
import type { ScopeKey } from '../../core/identity/scope';
import type { SessionKey } from './conversationStore';
import type { SqlDatabase, SqlExecutor } from './sql';

const where = 'scope = ? AND bot_id = ? AND session_id = ?';
const keyParams = (key: SessionKey) => [key.scope, key.botId, key.sessionId];

// ---------------------------------------------------------------- drafts

/** Save the composer text; an empty draft is deleted. */
export async function saveDraft(db: SqlExecutor, key: SessionKey, text: string, now: number) {
  if (text.length === 0) {
    await db.run(`DELETE FROM drafts WHERE ${where}`, keyParams(key));
    return;
  }
  await db.run(
    `INSERT INTO drafts (scope, bot_id, session_id, text, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (scope, bot_id, session_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
    [...keyParams(key), text, now],
  );
}

export async function loadDraft(db: SqlExecutor, key: SessionKey): Promise<string> {
  const row = await db.first<{ text: string }>(`SELECT text FROM drafts WHERE ${where}`, keyParams(key));
  return row?.text ?? '';
}

// ---------------------------------------------------------------- reading position

export type ReadingAnchor =
  | Readonly<{ atBottom: true }>
  /** Top of the viewport sits `offsetPx` into this block. */
  | Readonly<{ atBottom: false; turnId: string; role: string; blockId: number; offsetPx: number }>;

export async function saveReadingAnchor(db: SqlExecutor, key: SessionKey, anchor: ReadingAnchor, now: number) {
  const detail = anchor.atBottom
    ? [null, null, null, null]
    : [anchor.turnId, anchor.role, anchor.blockId, anchor.offsetPx];
  await db.run(
    `INSERT INTO reading_anchor (scope, bot_id, session_id, at_bottom, turn_id, role, block_id, offset_px, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope, bot_id, session_id) DO UPDATE SET
       at_bottom = excluded.at_bottom, turn_id = excluded.turn_id, role = excluded.role,
       block_id = excluded.block_id, offset_px = excluded.offset_px, updated_at = excluded.updated_at`,
    [...keyParams(key), anchor.atBottom, ...detail, now],
  );
}

export async function loadReadingAnchor(db: SqlExecutor, key: SessionKey): Promise<ReadingAnchor | null> {
  const row = await db.first<{
    at_bottom: number;
    turn_id: string | null;
    role: string | null;
    block_id: number | null;
    offset_px: number | null;
  }>(`SELECT at_bottom, turn_id, role, block_id, offset_px FROM reading_anchor WHERE ${where}`, keyParams(key));
  if (!row) return null;
  if (row.at_bottom || row.turn_id === null || row.role === null || row.block_id === null) return { atBottom: true };
  return { atBottom: false, turnId: row.turn_id, role: row.role, blockId: row.block_id, offsetPx: row.offset_px ?? 0 };
}

// ---------------------------------------------------------------- capabilities

export async function saveCapabilities(db: SqlExecutor, caps: ServerCapabilities, now: number) {
  await db.run(
    `INSERT INTO server_capabilities (server_key, invocation_lookup, admission_dedup, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (server_key) DO UPDATE SET
       invocation_lookup = excluded.invocation_lookup, admission_dedup = excluded.admission_dedup,
       updated_at = excluded.updated_at`,
    [caps.serverKey, caps.invocationLookup, caps.admissionDedup, now],
  );
}

export async function loadCapabilities(db: SqlExecutor, serverKey: string): Promise<ServerCapabilities | undefined> {
  const row = await db.first<{ invocation_lookup: Known; admission_dedup: Known }>(
    'SELECT invocation_lookup, admission_dedup FROM server_capabilities WHERE server_key = ?',
    [serverKey],
  );
  return row ? { serverKey, invocationLookup: row.invocation_lookup, admissionDedup: row.admission_dedup } : undefined;
}

// ---------------------------------------------------------------- scope lifecycle

const SCOPED_TABLES = [
  'bots',
  'sessions',
  'turns',
  'history_checkpoint',
  'runtime_checkpoint',
  'drafts',
  'reading_anchor',
  'outbox',
  'session_creations',
] as const;

/**
 * Remove everything cached for one scope (logout). Unfinished outbox entries
 * are deleted with it: they must not be sent later under another identity.
 */
export async function clearScope(db: SqlDatabase, scope: ScopeKey) {
  await db.transaction(async (tx) => {
    for (const table of SCOPED_TABLES) await tx.run(`DELETE FROM ${table} WHERE scope = ?`, [scope]);
  });
}
