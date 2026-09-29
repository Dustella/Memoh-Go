import * as SQLite from 'expo-sqlite';

import { migrate } from './migrations';
import { bindable, createLock, type SqlDatabase, type SqlExecutor } from './sql';

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
  // busy_timeout: expo-sqlite runs exclusive transactions on a second
  // connection, and a Fast Refresh in development opens another one; wait
  // for the lock instead of failing with "database is locked".
  await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const exclusive = createLock();
  const direct = executor(raw);
  const database: SqlDatabase = {
    // Outside a transaction every statement takes the same lock, so another
    // flow's writes cannot interleave with an open transaction.
    run: (sql, params) => exclusive(() => direct.run(sql, params)),
    all: (sql, params) => exclusive(() => direct.all(sql, params)),
    first: (sql, params) => exclusive(() => direct.first(sql, params)),
    exec: (sql) => exclusive(() => direct.exec(sql)),
    transaction(work) {
      return exclusive(async () => {
        let result!: Awaited<ReturnType<typeof work>>;
        // Exclusive: plain queries on this connection wait until it commits.
        await raw.withExclusiveTransactionAsync(async (tx) => {
          result = await work(executor(tx));
        });
        return result;
      });
    },
    close: () => raw.closeAsync(),
  };
  await migrate(database);
  return database;
}
