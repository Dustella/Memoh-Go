import { isRunActive, type RunView } from '../../core/conversation/types';
import { homeKey, summarizeRun, type HomeSession, type OutboxIssue, type RunSummary } from '../../core/home/home';
import type { ScopeKey } from '../../core/identity/scope';
import type { SqlExecutor } from './sql';

/** Cached sessions across every Bot of the scope, most recently active first. */
export async function loadHomeSessions(db: SqlExecutor, scope: ScopeKey, limit = 200): Promise<HomeSession[]> {
  const rows = await db.all<{ bot_id: string; session_id: string; title: string | null; server_updated_at: string | null; bot_name: string | null }>(
    `SELECT s.bot_id, s.session_id, s.title, s.server_updated_at, b.display_name AS bot_name
     FROM sessions s JOIN bots b ON b.scope = s.scope AND b.bot_id = s.bot_id
     WHERE s.scope = ?
     ORDER BY s.server_updated_at DESC, s.session_id LIMIT ?`,
    [scope, limit],
  );
  return rows.map((r) => ({
    botId: r.bot_id,
    botName: r.bot_name || r.bot_id,
    sessionId: r.session_id,
    // Empty when the server has no title; the UI shows its own placeholder.
    title: r.title ?? '',
    updatedAt: r.server_updated_at ?? '',
  }));
}

/** Last saved run view of every session (written by LiveSession while it ran). */
export async function loadSavedRuns(db: SqlExecutor, scope: ScopeKey): Promise<Map<string, RunSummary>> {
  const rows = await db.all<{ bot_id: string; session_id: string; run_json: string | null; saved_at: number }>(
    'SELECT bot_id, session_id, run_json, saved_at FROM runtime_checkpoint WHERE scope = ? AND run_json IS NOT NULL',
    [scope],
  );
  const runs = new Map<string, RunSummary>();
  for (const r of rows) {
    const run = JSON.parse(r.run_json!) as RunView | null;
    if (run) runs.set(homeKey(r.bot_id, r.session_id), summarizeRun(run, r.saved_at));
  }
  return runs;
}

/** Sends per session that need attention or are still waiting. */
export async function loadOutboxIssues(db: SqlExecutor, scope: ScopeKey): Promise<Map<string, OutboxIssue>> {
  const rows = await db.all<{ bot_id: string; session_id: string; unsure: number; failed: number; queued: number }>(
    `SELECT bot_id, session_id,
       SUM(CASE WHEN status = 'unconfirmed' AND needs_user = 1 THEN 1 ELSE 0 END) AS unsure,
       SUM(CASE WHEN status = 'failed' AND IFNULL(last_code, '') <> 'discarded' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status IN ('queued', 'sent') OR (status = 'unconfirmed' AND needs_user = 0) THEN 1 ELSE 0 END) AS queued
     FROM outbox WHERE scope = ? AND status NOT IN ('accepted', 'settled')
     GROUP BY bot_id, session_id`,
    [scope],
  );
  const issues = new Map<string, OutboxIssue>();
  for (const r of rows) {
    if (r.unsure + r.failed + r.queued > 0) {
      issues.set(homeKey(r.bot_id, r.session_id), { unsure: r.unsure, failed: r.failed, queued: r.queued });
    }
  }
  return issues;
}

export async function markSessionSeen(db: SqlExecutor, scope: ScopeKey, botId: string, sessionId: string, now: number) {
  await db.run(
    `INSERT INTO session_seen (scope, bot_id, session_id, seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (scope, bot_id, session_id) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)`,
    [scope, botId, sessionId, now],
  );
}

export async function loadSeen(db: SqlExecutor, scope: ScopeKey): Promise<Map<string, number>> {
  const rows = await db.all<{ bot_id: string; session_id: string; seen_at: number }>(
    'SELECT bot_id, session_id, seen_at FROM session_seen WHERE scope = ?',
    [scope],
  );
  return new Map(rows.map((r) => [homeKey(r.bot_id, r.session_id), r.seen_at]));
}

/** True when the saved copy says a run is still going (used to pick what to watch). */
export const isActiveSummary = (run: RunSummary | undefined) => Boolean(run && isRunActive(run.status));
