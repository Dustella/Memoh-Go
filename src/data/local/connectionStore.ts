import type { SqlExecutor } from './sql';

/** A signed-in account on one deployment. Contains no credential. */
export type Connection = Readonly<{
  connectionId: string;
  deployment: string;
  accountId: string;
  teamId: string;
  username: string;
  displayName: string;
  serverVersion: string;
  serverCommit: string;
  createdAt: number;
  lastUsedAt: number;
}>;

type Row = {
  connection_id: string;
  deployment: string;
  account_id: string;
  team_id: string;
  username: string;
  display_name: string;
  server_version: string;
  server_commit: string;
  created_at: number;
  last_used_at: number;
};

const toConnection = (row: Row): Connection => ({
  connectionId: row.connection_id,
  deployment: row.deployment,
  accountId: row.account_id,
  teamId: row.team_id,
  username: row.username,
  displayName: row.display_name,
  serverVersion: row.server_version,
  serverCommit: row.server_commit,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

/**
 * Insert or refresh a connection. Signing in to the same account again keeps
 * its original connection id, so its credential key and cached data stay put.
 */
export async function upsertConnection(db: SqlExecutor, connection: Connection): Promise<Connection> {
  await db.run(
    `INSERT INTO connections (connection_id, deployment, account_id, team_id, username, display_name,
       server_version, server_commit, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (deployment, account_id) DO UPDATE SET
       team_id = excluded.team_id, username = excluded.username, display_name = excluded.display_name,
       server_version = excluded.server_version, server_commit = excluded.server_commit,
       last_used_at = excluded.last_used_at`,
    [
      connection.connectionId,
      connection.deployment,
      connection.accountId,
      connection.teamId,
      connection.username,
      connection.displayName,
      connection.serverVersion,
      connection.serverCommit,
      connection.createdAt,
      connection.lastUsedAt,
    ],
  );
  const stored = await db.first<Row>('SELECT * FROM connections WHERE deployment = ? AND account_id = ?', [
    connection.deployment,
    connection.accountId,
  ]);
  return toConnection(stored!);
}

export async function loadLastUsedConnection(db: SqlExecutor): Promise<Connection | null> {
  const row = await db.first<Row>('SELECT * FROM connections ORDER BY last_used_at DESC, connection_id LIMIT 1');
  return row ? toConnection(row) : null;
}

export async function listConnections(db: SqlExecutor): Promise<Connection[]> {
  return (await db.all<Row>('SELECT * FROM connections ORDER BY last_used_at DESC')).map(toConnection);
}

export async function touchConnection(db: SqlExecutor, connectionId: string, now: number) {
  await db.run('UPDATE connections SET last_used_at = ? WHERE connection_id = ?', [now, connectionId]);
}

export async function deleteConnection(db: SqlExecutor, connectionId: string) {
  await db.run('DELETE FROM connections WHERE connection_id = ?', [connectionId]);
}
