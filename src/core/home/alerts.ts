import type { HomeItem, HomeSections } from './home';

/**
 * NT-01: foreground alerts derived from successive home snapshots. An alert
 * fires on a transition the user did not see happen:
 *
 * - a session enters "needs you" for approval, question, failed send or
 *   failed task;
 * - a session that was running live finishes (it leaves "running" and is not
 *   in "needs you").
 *
 * Nothing fires for the first snapshot (app start is not news), for cached
 * (not live) running rows finishing, or for the session on screen.
 */
export type AlertKind = 'approval' | 'question' | 'send_failed' | 'failed' | 'completed';

export type InAppAlert = Readonly<{
  id: string;
  kind: AlertKind;
  botId: string;
  sessionId: string;
  botName: string;
  title: string;
}>;

const needsKind = (item: HomeItem): AlertKind | null => {
  switch (item.reason) {
    case 'approval':
      return 'approval';
    case 'question':
      return 'question';
    case 'send_failed':
      return 'send_failed';
    case 'run_failed':
      return 'failed';
    default:
      return null;
  }
};

export function diffAlerts(prev: HomeSections | null, next: HomeSections, viewingKey: string | null): InAppAlert[] {
  if (!prev) return [];
  const out: InAppAlert[] = [];
  const make = (item: HomeItem, kind: AlertKind): InAppAlert => ({
    id: `${item.key}:${kind}:${item.updatedAt}`,
    kind,
    botId: item.botId,
    sessionId: item.sessionId,
    botName: item.botName,
    title: item.title,
  });
  const prevNeeds = new Map(prev.needsYou.map((i) => [i.key, i.reason]));
  const nextNeeds = new Set(next.needsYou.map((i) => i.key));
  for (const item of next.needsYou) {
    const kind = needsKind(item);
    if (!kind || item.key === viewingKey || prevNeeds.get(item.key) === item.reason) continue;
    out.push(make(item, kind));
  }
  const nextRunning = new Set(next.running.map((i) => i.key));
  const all = [...next.newResults, ...next.recent, ...(next.continueWith ? [next.continueWith] : [])];
  for (const was of prev.running) {
    if (was.cached || nextRunning.has(was.key) || nextNeeds.has(was.key) || was.key === viewingKey) continue;
    const now = all.find((i) => i.key === was.key) ?? was;
    out.push(make(now, 'completed'));
  }
  return out;
}
