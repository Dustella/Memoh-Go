import type { SqlDatabase } from './sql';

/**
 * Append-only schema history. Never edit a shipped migration; add a new one.
 * Every Team-owned table carries `scope` (identity/scope.ts#scopeKey) in its
 * primary key, because self-hosted deployments share default team ids.
 */
export const MIGRATIONS: readonly { version: number; up: string }[] = [
  {
    version: 1,
    up: `
      CREATE TABLE server_capabilities (
        server_key TEXT PRIMARY KEY NOT NULL,
        invocation_lookup TEXT NOT NULL,
        admission_dedup TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE bots (
        scope TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT,
        is_active INTEGER NOT NULL,
        raw_json TEXT NOT NULL,
        synced_at INTEGER NOT NULL,
        PRIMARY KEY (scope, bot_id)
      );

      CREATE TABLE sessions (
        scope TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        title TEXT,
        type TEXT,
        server_updated_at TEXT,
        raw_json TEXT NOT NULL,
        synced_at INTEGER NOT NULL,
        PRIMARY KEY (scope, bot_id, session_id)
      );
      CREATE INDEX sessions_recent ON sessions (scope, bot_id, server_updated_at DESC);

      -- Persisted history only: live turns stay in runtime_checkpoint until the
      -- run ends and the server writes them.
      CREATE TABLE turns (
        scope TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        role TEXT NOT NULL,
        turn_position INTEGER NOT NULL,
        row_in_turn INTEGER NOT NULL,
        message_id TEXT,
        body_json TEXT NOT NULL,
        PRIMARY KEY (scope, bot_id, session_id, turn_id, role)
      );
      CREATE INDEX turns_order ON turns (scope, bot_id, session_id, turn_position, row_in_turn);

      CREATE TABLE history_checkpoint (
        scope TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        newest_turn_position INTEGER,
        oldest_message_id TEXT,
        has_older INTEGER NOT NULL,
        synced_at INTEGER NOT NULL,
        PRIMARY KEY (scope, bot_id, session_id)
      );

      CREATE TABLE runtime_checkpoint (
        scope TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        epoch TEXT NOT NULL,
        seq INTEGER NOT NULL,
        run_json TEXT,
        saved_at INTEGER NOT NULL,
        PRIMARY KEY (scope, bot_id, session_id)
      );

      CREATE TABLE outbox (
        invocation_id TEXT PRIMARY KEY NOT NULL,
        scope TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        run_id TEXT,
        turn_id TEXT,
        last_code TEXT,
        needs_user INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX outbox_pending ON outbox (scope, status, created_at);

      CREATE TABLE drafts (
        scope TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        text TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (scope, bot_id, session_id)
      );

      CREATE TABLE reading_anchor (
        scope TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        at_bottom INTEGER NOT NULL,
        turn_id TEXT,
        role TEXT,
        block_id INTEGER,
        offset_px REAL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (scope, bot_id, session_id)
      );
    `,
  },
  {
    version: 2,
    up: `
      -- One row per signed-in (deployment, account). Credentials never live
      -- here: they are in SecureStore under credential_key.
      CREATE TABLE connections (
        connection_id TEXT PRIMARY KEY NOT NULL,
        deployment TEXT NOT NULL,
        account_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        server_version TEXT NOT NULL,
        server_commit TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        UNIQUE (deployment, account_id)
      );
    `,
  },
  {
    version: 3,
    up: `
      -- "New chat + first message" intents (core/operations/sessionCreate.ts).
      -- The first message lives here until the server session id is known.
      CREATE TABLE session_creations (
        request_id TEXT PRIMARY KEY NOT NULL,
        scope TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        title TEXT NOT NULL,
        first_message TEXT NOT NULL,
        invocation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        first_attempt_at INTEGER,
        next_attempt_at INTEGER NOT NULL,
        session_id TEXT,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX session_creations_open ON session_creations (scope, status, created_at);
    `,
  },
  {
    version: 4,
    up: `
      -- Reading position is a rendered row key (features/chat/turnRows.ts);
      -- rows without one restore to the bottom.
      ALTER TABLE reading_anchor ADD COLUMN row_key TEXT;

      -- Small per-scope UI state, e.g. the last open page for cold start.
      CREATE TABLE ui_state (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (scope, key)
      );
    `,
  },
  {
    version: 5,
    up: `
      -- When the user last had each session open on this device (home "new
      -- result" badges, core/home/home.ts). Local only; not synced.
      CREATE TABLE session_seen (
        scope TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (scope, bot_id, session_id)
      );
    `,
  },
  {
    version: 6,
    up: `
      -- Device-wide app settings (language, appearance, alerts; AD-10).
      -- Not scoped: they survive sign-out and apply before sign-in.
      CREATE TABLE app_preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** The file was written by a newer app build; this build must not touch it. */
export class UnsupportedSchemaError extends Error {
  constructor(readonly found: number, readonly supported: number) {
    super(`Local database schema ${found} is newer than supported ${supported}`);
    this.name = 'UnsupportedSchemaError';
  }
}

/**
 * Bring the file to SCHEMA_VERSION. Each migration and its version bump
 * commit together, so a crash mid-upgrade leaves the previous version intact.
 */
export async function migrate(database: SqlDatabase): Promise<number> {
  const row = await database.first<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) throw new UnsupportedSchemaError(current, SCHEMA_VERSION);

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await database.transaction(async (tx) => {
      await tx.exec(migration.up);
      await tx.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
  return SCHEMA_VERSION;
}
