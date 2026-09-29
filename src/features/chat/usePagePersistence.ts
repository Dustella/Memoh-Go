import { usePathname, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import {
  clearUiStateIf,
  loadReadingAnchor,
  loadUiState,
  saveReadingAnchor,
  saveUiState,
  type ReadingAnchor,
} from '../../data/local/userStateStore';

const SAVE_DELAY_MS = 400;
const LAST_PAGE = 'last_page';

type LastPage = Readonly<{ kind: 'chat'; botId: string; sessionId: string }> | Readonly<{ kind: 'none' }>;

function useScope() {
  const state = useAccessState();
  return state.kind === 'signed_in' ? state.session.scope : null;
}

/**
 * Where the user was reading in one conversation (CH-11). `anchor` is
 * undefined until loaded, so the list can wait and open at the right row.
 * Saves are debounced and flushed when the screen closes or the app leaves
 * the foreground, so a kill right after scrolling keeps the position.
 */
export function useReadingAnchor(botId: string, sessionId: string) {
  const { db } = useServices();
  const scope = useScope();
  const [anchor, setAnchor] = useState<ReadingAnchor | null | undefined>(undefined);
  const latest = useRef<ReadingAnchor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void loadReadingAnchor(db, { scope, botId, sessionId }).then((a) => {
      if (!cancelled) setAnchor(a);
    });
    return () => {
      cancelled = true;
    };
  }, [db, scope, botId, sessionId]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = latest.current;
    if (!scope || !value) return;
    latest.current = null;
    void saveReadingAnchor(db, { scope, botId, sessionId }, value, Date.now());
  }, [db, scope, botId, sessionId]);

  const update = useCallback(
    (next: ReadingAnchor) => {
      latest.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') flush();
    });
    return () => {
      sub.remove();
      flush();
    };
  }, [flush]);

  return { anchor, update };
}

/** Remember the open conversation, so a cold start can return to it (HM-06). */
export function useRememberChat(botId: string, sessionId: string) {
  const { db } = useServices();
  const scope = useScope();
  useEffect(() => {
    if (!scope) return;
    const page: LastPage = { kind: 'chat', botId, sessionId };
    void saveUiState(db, scope, LAST_PAGE, page, Date.now());
    // Leaving the chat on purpose (back) forgets it; a killed process never runs this.
    // Compare-and-clear: a chat opened meanwhile (replace) keeps its own entry.
    return () => void clearUiStateIf(db, scope, LAST_PAGE, page);
  }, [db, scope, botId, sessionId]);
}

let restoredThisProcess = false;

/** Once per process, on the home tab: reopen the conversation that was open when the app died. */
export function useRestoreLastPage() {
  const { db } = useServices();
  const scope = useScope();
  const pathname = usePathname();
  useEffect(() => {
    if (!scope || restoredThisProcess) return;
    restoredThisProcess = true;
    // A deep link or notification already chose a page: do not override it.
    if (pathname !== '/') return;
    void loadUiState<LastPage>(db, scope, LAST_PAGE).then((page) => {
      if (page?.kind === 'chat' && page.botId && page.sessionId) {
        router.push({ pathname: '/chat/[botId]/[sessionId]', params: { botId: page.botId, sessionId: page.sessionId } });
      }
    });
  }, [db, scope, pathname]);
}
