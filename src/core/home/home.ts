import { isRunActive, type RunView } from '../conversation/types';

/**
 * M3 home screen (HM-01..HM-04): one list of sessions across Bots, sorted
 * into sections by what they need from the user. A session appears in one
 * section only, the most urgent that applies:
 *
 *   needs_you  > running > new_result > recent
 *
 * Inputs are what the app can know without the U6 aggregate endpoint: the
 * per-Bot session lists (activity time), run views of the sessions it is
 * watching (or their last saved copy), the local Outbox, and when the user
 * last opened each session on this device.
 */
export type RunSummary = Readonly<{
  status: string;
  /** A pending approval or question the user can answer. */
  decision: 'approval' | 'question' | null;
  errorCode?: string;
  /** Server time of the run's last update (ISO). */
  updatedAt: string;
  /** When this summary was observed locally (epoch ms); older copies are shown as cached. */
  observedAt: number;
}>;

export type HomeSession = Readonly<{
  botId: string;
  botName: string;
  sessionId: string;
  title: string;
  /** Server `updated_at` (ISO): moves when a message is persisted. */
  updatedAt: string;
}>;

export type OutboxIssue = Readonly<{ unsure: number; failed: number; queued: number }>;

export type NeedsReason = 'approval' | 'question' | 'send_unsure' | 'send_failed' | 'run_failed';

export type HomeItem = HomeSession &
  Readonly<{
    key: string;
    /** Why it is in its section; `phase` for running items. */
    reason?: NeedsReason;
    phase?: string;
    /** The run summary came from a saved copy, not a live subscription. */
    cached?: boolean;
  }>;

export type HomeSections = Readonly<{
  /** HM-01: the session opened most recently on this device, unless it already sits in an urgent section. */
  continueWith: HomeItem | null;
  needsYou: HomeItem[];
  running: HomeItem[];
  newResults: HomeItem[];
  recent: HomeItem[];
}>;

export type HomeInput = Readonly<{
  sessions: readonly HomeSession[];
  runs: ReadonlyMap<string, RunSummary>;
  /** Keys whose run summary is live (subscribed and snapshotted now). */
  liveKeys: ReadonlySet<string>;
  outbox: ReadonlyMap<string, OutboxIssue>;
  /** Epoch ms the user last had the session open on this device. */
  seen: ReadonlyMap<string, number>;
  /** Activity before this (epoch ms) is never "new": the first home load on this device. */
  baseline: number;
  recentLimit?: number;
}>;

export const homeKey = (botId: string, sessionId: string) => `${botId}/${sessionId}`;

const FAILED_RUN = new Set(['errored', 'lost']);

/** Reduce a run view to what the home screen needs. */
export function summarizeRun(run: RunView, observedAt: number): RunSummary {
  let decision: RunSummary['decision'] = null;
  if (isRunActive(run.status)) {
    for (const block of run.messages) {
      if (block.approval?.status === 'pending' && block.approval.can_approve !== false) decision = 'approval';
      else if (block.user_input?.status === 'pending' && block.user_input.can_respond !== false && decision === null) decision = 'question';
    }
  }
  return { status: run.status, decision, errorCode: run.error_code, updatedAt: run.updated_at, observedAt };
}

const time = (iso: string | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

function needsReason(run: RunSummary | undefined, outbox: OutboxIssue | undefined, seenAt: number): NeedsReason | null {
  if (outbox?.failed) return 'send_failed';
  if (outbox?.unsure) return 'send_unsure';
  if (run && isRunActive(run.status) && run.decision) return run.decision;
  // A failed run is only news until the user has looked at it.
  if (run && FAILED_RUN.has(run.status) && time(run.updatedAt) > seenAt) return 'run_failed';
  return null;
}

const NEEDS_ORDER: Record<NeedsReason, number> = { approval: 0, question: 1, send_failed: 2, send_unsure: 3, run_failed: 4 };

export function buildHome(input: HomeInput): HomeSections {
  const needsYou: HomeItem[] = [];
  const running: HomeItem[] = [];
  const newResults: HomeItem[] = [];
  let recent: HomeItem[] = [];
  let continueWith: HomeItem | null = null;
  let continueSeen = 0;
  const byActivity = [...input.sessions].sort((a, b) => time(b.updatedAt) - time(a.updatedAt) || a.sessionId.localeCompare(b.sessionId));
  for (const session of byActivity) {
    const key = homeKey(session.botId, session.sessionId);
    const run = input.runs.get(key);
    const opened = input.seen.get(key) ?? 0;
    const seenAt = Math.max(opened, input.baseline);
    const cached = run ? !input.liveKeys.has(key) : undefined;
    const base = { ...session, key, cached };

    const reason = needsReason(run, input.outbox.get(key), seenAt);
    let item: HomeItem;
    if (reason) {
      needsYou.push((item = { ...base, reason }));
    } else if (run && isRunActive(run.status)) {
      running.push((item = { ...base, phase: run.status }));
    } else if (time(session.updatedAt) > seenAt) {
      newResults.push((item = base));
    } else {
      recent.push((item = base));
    }
    if (opened > continueSeen) {
      continueSeen = opened;
      continueWith = item;
    }
  }
  // Urgent and new-result sections already show it; only a quiet session is lifted out of recent.
  if (continueWith && !recent.some((i) => i.key === continueWith!.key)) continueWith = null;
  if (continueWith) recent = recent.filter((i) => i.key !== continueWith!.key);
  needsYou.sort((a, b) => NEEDS_ORDER[a.reason!] - NEEDS_ORDER[b.reason!]);
  recent.splice(input.recentLimit ?? 10);
  return { continueWith, needsYou, running, newResults, recent };
}

/**
 * Which sessions to subscribe to for live run state, under a hard cap (the
 * U6 fallback). Sessions with unsent messages or a known active run go
 * first, then the most recently active ones within `windowMs`.
 */
export function pickWatchSet(input: {
  sessions: readonly HomeSession[];
  runs: ReadonlyMap<string, RunSummary>;
  outbox: ReadonlyMap<string, OutboxIssue>;
  now: number;
  limit: number;
  windowMs: number;
}): string[] {
  const urgent: string[] = [];
  const recent: string[] = [];
  const byActivity = [...input.sessions].sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  for (const s of byActivity) {
    const key = homeKey(s.botId, s.sessionId);
    const run = input.runs.get(key);
    const issue = input.outbox.get(key);
    if ((run && isRunActive(run.status)) || (issue && issue.queued + issue.unsure > 0)) urgent.push(key);
    else if (input.now - time(s.updatedAt) <= input.windowMs) recent.push(key);
  }
  return [...urgent, ...recent].slice(0, input.limit);
}
