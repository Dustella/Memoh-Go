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
   * transaction; never mix in calls on the outer database from inside it.
   * Not re-entrant.
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
