import type { Turn } from '../../core/conversation/types';
import {
  loadHistoryCheckpoint,
  saveHistoryPage,
  upsertSessions,
  type HistoryCheckpoint,
  type SessionKey,
} from '../../data/local/conversationStore';
import type { SqlDatabase } from '../../data/local/sql';
import { MemohClient, type FetchFn } from '../../data/remote/memohClient';
import type { ConnectionManager } from '../access/connectService';

export const HISTORY_PAGE_SIZE = 30;
export const SESSION_PAGE_SIZE = 30;

/**
 * Whether history exists before a page. Positions start at 1 per session
 * (observed on the dev stack), so a page starting at 1 is the beginning.
 * A later position only *suggests* more: an empty older page settles it.
 */
export function pageHasOlder(turns: readonly Turn[]): boolean {
  const first = turns[0]?.turn_position;
  return typeof first === 'number' && first > 1;
}

/** Server → local sync for sessions and persisted history. Reads stay local. */
export class ConversationSync {
  constructor(
    private readonly db: SqlDatabase,
    private readonly access: ConnectionManager,
    private readonly fetchFn: FetchFn,
    private readonly now: () => number,
  ) {}

  private client(deployment: string) {
    return new MemohClient(deployment, this.fetchFn);
  }

  /** Fetch one page of the session list into the cache. Returns the next cursor. */
  syncSessions(botId: string, cursor?: string): Promise<string> {
    return this.access.withToken(async (token, session) => {
      const page = await this.client(session.connection.deployment).listSessions(token, botId, {
        cursor,
        limit: SESSION_PAGE_SIZE,
      });
      await upsertSessions(this.db, session.scope, botId, page.items, this.now());
      return page.nextCursor;
    });
  }

  /** Newest history page. */
  syncLatest(key: Omit<SessionKey, 'scope'>): Promise<HistoryCheckpoint> {
    return this.access.withToken(async (token, session) => {
      const turns = await this.client(session.connection.deployment).listMessages(token, key.botId, key.sessionId, {
        limit: HISTORY_PAGE_SIZE,
      });
      const result = await saveHistoryPage(
        this.db,
        { ...key, scope: session.scope },
        { turns, direction: 'latest', hasOlder: pageHasOlder(turns) },
        this.now(),
      );
      return result.checkpoint;
    });
  }

  /** The page before the oldest cached message; no-op when nothing is older. */
  syncOlder(key: Omit<SessionKey, 'scope'>): Promise<HistoryCheckpoint | null> {
    return this.access.withToken(async (token, session) => {
      const full = { ...key, scope: session.scope };
      const checkpoint = await loadHistoryCheckpoint(this.db, full);
      if (!checkpoint?.hasOlder || !checkpoint.oldestMessageId) return checkpoint;
      const turns = await this.client(session.connection.deployment).listMessages(token, key.botId, key.sessionId, {
        limit: HISTORY_PAGE_SIZE,
        beforeMessageId: checkpoint.oldestMessageId,
      });
      const result = await saveHistoryPage(
        this.db,
        full,
        { turns, direction: 'older', hasOlder: turns.length > 0 && pageHasOlder(turns) },
        this.now(),
      );
      return result.checkpoint;
    });
  }
}
