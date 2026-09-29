import type { HomeSession } from '../home/home';

/**
 * SS-04: session search. Memoh has no server-side session search: the list
 * endpoint only filters by type/parent/workdir, and the web client filters
 * the sessions it already loaded (apps/web session-search-dialog.vue). The
 * app does the same over every session cached on this device, across Bots,
 * within the current scope (deployment + account + Team).
 *
 * Every whitespace-separated term must match the title, the Bot name or the
 * session id (case- and width-insensitive). Newest activity first.
 */
export type SessionSearchInput = Readonly<{
  sessions: readonly HomeSession[];
  query: string;
  /** Only sessions of this Bot; null for all Bots. */
  botId?: string | null;
  limit?: number;
}>;

export const normaliseForSearch = (text: string) => text.normalize('NFKC').toLocaleLowerCase();

export function searchTerms(query: string): string[] {
  return normaliseForSearch(query).split(/\s+/).filter(Boolean);
}

export function searchSessions({ sessions, query, botId = null, limit = 50 }: SessionSearchInput): HomeSession[] {
  const terms = searchTerms(query);
  const scoped = botId ? sessions.filter((s) => s.botId === botId) : sessions;
  const hits =
    terms.length === 0
      ? [...scoped]
      : scoped.filter((s) => {
          const haystack = normaliseForSearch(`${s.title}\n${s.botName}\n${s.sessionId}`);
          return terms.every((term) => haystack.includes(term));
        });
  const time = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  };
  return hits.sort((a, b) => time(b.updatedAt) - time(a.updatedAt) || a.sessionId.localeCompare(b.sessionId)).slice(0, limit);
}

/** Bots whose name matches every term (for jumping straight to a Bot). */
export function searchBots<T extends { id: string; name?: string; display_name?: string }>(bots: readonly T[], query: string): T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  return bots.filter((b) => {
    const haystack = normaliseForSearch(`${b.display_name ?? ''}\n${b.name ?? ''}`);
    return terms.every((term) => haystack.includes(term));
  });
}
