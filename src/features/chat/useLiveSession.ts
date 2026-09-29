import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { LiveSnapshot } from '../../application/conversation/liveSession';
import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { loadDraft, saveDraft } from '../../data/local/userStateStore';

const IDLE: LiveSnapshot = { run: null, live: false, socket: 'closed', pending: [], failed: [], controls: [] };
const noopSubscribe = () => () => undefined;

/** The pooled LiveSession of one conversation, held while the screen is mounted. */
export function useLiveSession(botId: string, sessionId: string) {
  const { pool } = useServices();
  const live = useMemo(() => pool.get(botId, sessionId), [pool, botId, sessionId]);
  useEffect(() => pool.retain(live), [pool, live]);
  const snapshot = useSyncExternalStore(live?.subscribe ?? noopSubscribe, live ? live.getSnapshot : () => IDLE);
  return { live, snapshot };
}

/** Composer text persisted per session (debounced), restored on reopen. */
export function useDraft(botId: string, sessionId: string) {
  const { db } = useServices();
  const state = useAccessState();
  const scope = state.kind === 'signed_in' ? state.session.scope : null;
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef('');

  useEffect(() => {
    if (!scope) return;
    void loadDraft(db, { scope, botId, sessionId }).then((draft) => {
      latest.current = draft;
      setText(draft);
      setReady(true);
    });
  }, [db, scope, botId, sessionId]);

  const persist = (value: string) => {
    if (!scope) return;
    void saveDraft(db, { scope, botId, sessionId }, value, Date.now());
  };

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        persist(latest.current);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, botId, sessionId],
  );

  const update = (value: string) => {
    latest.current = value;
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      persist(value);
    }, 400);
  };

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    latest.current = '';
    setText('');
    persist('');
  };

  return { text, ready, update, clear };
}
