import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { SessionQueueController } from '../../application/conversation/sessionQueue';
import { useServices } from '../../bootstrap/AppServices';
import { newId } from '../../core/ids';

/**
 * The follow-up/steer queue of one session (CH-13). Re-read whenever the run
 * changes state or takes a steer, so pending items disappear as the run
 * claims them.
 */
export function useSessionQueue(botId: string, sessionId: string, runKey: string) {
  const { access, fetchFn } = useServices();
  const queue = useMemo(() => new SessionQueueController({ access, fetchFn, newId }, botId, sessionId), [access, fetchFn, botId, sessionId]);
  useEffect(() => () => queue.dispose(), [queue]);
  useEffect(() => {
    void queue.refresh();
  }, [queue, runKey]);
  const view = useSyncExternalStore(queue.subscribe, queue.getView);
  return { queue, view };
}
