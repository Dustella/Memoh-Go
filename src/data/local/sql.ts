/**
 * Minimal SQL port used by the local stores. The app binds it to expo-sqlite
 * (expoDatabase.ts); unit tests bind it to Node's built-in SQLite, so store
 * logic runs against a real engine without React Native.
 */
export type SqlValue = string | number | null;
export type SqlParam = SqlValue | boolean | undefined;

export interface SqlExecutor {
  run(sql: string, params?: readonly SqlParam[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: readonly SqlParam[]): Promise<T[]>;
  first<T>(sql: string, params?: readonly SqlParam[]): Promise<T | null>;
  /** Several statements, no parameters (schema scripts). */
  exec(sql: string): Promise<void>;
}

export interface SqlDatabase extends SqlExecutor {
  /**
   * Run `work` atomically. Only statements issued through `tx` belong to the
   * transaction. Concurrent transactions are queued (FIFO); a transaction
   * must never call the outer database, or it waits on itself.
   */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Bind values both drivers accept: booleans become 0/1, undefined becomes NULL. */
export function bindable(params: readonly SqlParam[] = []): SqlValue[] {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

/**
 * FIFO lock. Independent flows (a sync, a send, a draft save) open
 * transactions concurrently; they run one after another instead of failing.
 * Calling the outer database from inside a transaction would wait on itself,
 * which is why `transaction` hands work its own executor.
 */
export function createLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return function runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work, work);
    tail = result.catch(() => undefined);
    return result;
  };
}
