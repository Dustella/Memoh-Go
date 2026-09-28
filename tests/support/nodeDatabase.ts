import { DatabaseSync } from 'node:sqlite';

import { migrate } from '../../src/data/local/migrations';
import { bindable, type SqlDatabase, type SqlExecutor } from '../../src/data/local/sql';

/**
 * SqlDatabase over Node's built-in SQLite, for unit tests of the local stores.
 * Same SQL, real engine; only the driver differs from the device build.
 */
export function openNodeDatabase(path = ':memory:', options: { migrate?: boolean } = {}): Promise<SqlDatabase> {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON;');

  const exec: SqlExecutor = {
    async run(sql, params) {
      const result = raw.prepare(sql).run(...bindable(params));
      return { changes: Number(result.changes) };
    },
    async all<T>(sql: string, params?: Parameters<SqlExecutor['all']>[1]) {
      return raw.prepare(sql).all(...bindable(params)) as T[];
    },
    async first<T>(sql: string, params?: Parameters<SqlExecutor['first']>[1]) {
      return (raw.prepare(sql).get(...bindable(params)) as T | undefined) ?? null;
    },
    async exec(sql) {
      raw.exec(sql);
    },
  };

  let inTransaction = false;
  const database: SqlDatabase = {
    ...exec,
    async transaction(work) {
      if (inTransaction) throw new Error('Nested SQL transactions are not supported');
      inTransaction = true;
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(exec);
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    async close() {
      raw.close();
    },
  };

  return (options.migrate ?? true) ? migrate(database).then(() => database) : Promise.resolve(database);
}
