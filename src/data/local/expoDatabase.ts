import * as SQLite from 'expo-sqlite';

import { migrate } from './migrations';
import { bindable, type SqlDatabase, type SqlExecutor } from './sql';

type ExpoExecutor = Pick<SQLite.SQLiteDatabase, 'runAsync' | 'getAllAsync' | 'getFirstAsync' | 'execAsync'>;

function executor(db: ExpoExecutor): SqlExecutor {
  return {
    async run(sql, params) {
      const result = await db.runAsync(sql, bindable(params));
      return { changes: result.changes };
    },
    all: (sql, params) => db.getAllAsync(sql, bindable(params)),
    first: (sql, params) => db.getFirstAsync(sql, bindable(params)),
    exec: (sql) => db.execAsync(sql),
  };
}

/**
 * Open (and migrate) one local database file. `fileName` must not contain
 * account identifiers; callers derive it from an opaque local connection id.
 */
export async function openExpoDatabase(fileName: string): Promise<SqlDatabase> {
  const raw = await SQLite.openDatabaseAsync(fileName);
  await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  let inTransaction = false;
  const database: SqlDatabase = {
    ...executor(raw),
    async transaction(work) {
      if (inTransaction) throw new Error('Nested SQL transactions are not supported');
      inTransaction = true;
      try {
        let result!: Awaited<ReturnType<typeof work>>;
        // Exclusive: other queries on this connection wait until it commits.
        await raw.withExclusiveTransactionAsync(async (tx) => {
          result = await work(executor(tx));
        });
        return result;
      } finally {
        inTransaction = false;
      }
    },
    close: () => raw.closeAsync(),
  };
  await migrate(database);
  return database;
}
