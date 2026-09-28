import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'memoh-go-diagnostics.db';

export type SqliteProbeRecord = Readonly<{
  probeId: string;
  publicValue: string;
  createdAt: number;
}>;

export type LifecycleRecord = Readonly<{
  id: number;
  kind: string;
  appState: string;
  recordedAt: number;
}>;

export type DiagnosticsDatabaseSnapshot = Readonly<{
  latestProbe: SqliteProbeRecord | null;
  probeCount: number;
  latestLifecycle: LifecycleRecord | null;
  lifecycleCount: number;
}>;

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function openDiagnosticsDatabase(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS storage_probe (
      probe_id TEXT PRIMARY KEY NOT NULL,
      public_value TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lifecycle_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      app_state TEXT NOT NULL,
      recorded_at INTEGER NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  return database;
}

function getDiagnosticsDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= openDiagnosticsDatabase();
  return databasePromise;
}

export async function writeSqliteProbe(record: SqliteProbeRecord): Promise<void> {
  const database = await getDiagnosticsDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      'INSERT INTO storage_probe (probe_id, public_value, created_at) VALUES (?, ?, ?)',
      record.probeId,
      record.publicValue,
      record.createdAt,
    );
  });
}

export async function recordLifecycleEvent(
  kind: 'mount' | 'change',
  appState: string,
  recordedAt = Date.now(),
): Promise<void> {
  const database = await getDiagnosticsDatabase();
  await database.runAsync(
    'INSERT INTO lifecycle_event (kind, app_state, recorded_at) VALUES (?, ?, ?)',
    kind,
    appState,
    recordedAt,
  );
}

export async function readDiagnosticsDatabaseSnapshot(): Promise<DiagnosticsDatabaseSnapshot> {
  const database = await getDiagnosticsDatabase();
  const latestProbe = await database.getFirstAsync<SqliteProbeRecord>(`
    SELECT probe_id AS probeId, public_value AS publicValue, created_at AS createdAt
    FROM storage_probe
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const probeCountRow = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM storage_probe',
  );
  const latestLifecycle = await database.getFirstAsync<LifecycleRecord>(`
    SELECT id, kind, app_state AS appState, recorded_at AS recordedAt
    FROM lifecycle_event
    ORDER BY id DESC
    LIMIT 1
  `);
  const lifecycleCountRow = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM lifecycle_event',
  );

  return {
    latestProbe,
    probeCount: probeCountRow?.count ?? 0,
    latestLifecycle,
    lifecycleCount: lifecycleCountRow?.count ?? 0,
  };
}

export async function sqliteContainsSecureValue(secureValue: string): Promise<boolean> {
  const database = await getDiagnosticsDatabase();
  const result = await database.getFirstAsync<{ count: number }>(
    `SELECT
      (SELECT COUNT(*) FROM storage_probe WHERE probe_id = ? OR public_value = ?) +
      (SELECT COUNT(*) FROM lifecycle_event WHERE kind = ? OR app_state = ?) AS count`,
    secureValue,
    secureValue,
    secureValue,
    secureValue,
  );
  return (result?.count ?? 0) > 0;
}

export async function clearDiagnosticsDatabase(): Promise<void> {
  const database = await getDiagnosticsDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync('DELETE FROM storage_probe; DELETE FROM lifecycle_event;');
  });
}
