import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { LiveSession, type LiveSnapshot } from '../../application/conversation/liveSession';
import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { newId } from '../../core/ids';
import { loadDraft, saveDraft } from '../../data/local/userStateStore';

const IDLE: LiveSnapshot = { run: null, live: false, socket: 'closed', pending: [], failed: [] };
const noopSubscribe = () => () => undefined;

/** One LiveSession per open chat screen, torn down when it closes. */
export function useLiveSession(botId: string, sessionId: string) {
  const services = useServices();
  const live = useMemo(
    () =>
      new LiveSession(
        { db: services.db, access: services.access, sync: services.sync, hub: services.hub, fetchFn: services.fetchFn, now: Date.now, newId },
        botId,
        sessionId,
      ),
    [services, botId, sessionId],
  );
  useEffect(() => {
    void live.start();
    return () => live.stop();
  }, [live]);
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
