import type { ScopeKey } from '../identity/scope';
import { backoffMs } from './outbox';

/**
 * "New chat + first message" without duplicate sessions (contracts/u5).
 *
 * `POST /bots/:bot/sessions` is not idempotent on servers without U5, so a
 * create whose response was lost must never be blindly repeated. The intent
 * is saved first; a lost response moves it to `unknown`, and the recent
 * session list is checked for a session this attempt may have created
 * before another POST is made. The first message only enters the Outbox once
 * the server session id is known, so it can never be sent without one.
 *
 * `client_request_id` (= requestId) is sent on every attempt: servers with U5
 * return the existing row, older servers ignore the unknown field (verified
 * on the dev stack, which answers 201 and drops it).
 */
export type CreationStatus = 'pending' | 'creating' | 'unknown' | 'created' | 'failed';

export type SessionCreation = Readonly<{
  /** Local id; also sent as `client_request_id`. */
  requestId: string;
  scope: ScopeKey;
  botId: string;
  title: string;
  firstMessage: string;
  /** Invocation id of the first message, minted up front so a retry reuses it. */
  invocationId: string;
  status: CreationStatus;
  attempts: number;
  /** Device-clock ms of the first POST; every later attempt may also have created a row. */
  firstAttemptAt: number | null;
  nextAttemptAt: number;
  sessionId?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}>;

export const TITLE_MAX_CHARS = 40;
export const MAX_CREATE_ATTEMPTS = 8;
/** Slack before the first attempt when matching server `created_at`. */
export const RECONCILE_SLACK_MS = 5_000;

/** First 40 characters of the message on one line (code-point safe); longer text ends in "…". */
export function titleFromMessage(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(oneLine);
  return chars.length <= TITLE_MAX_CHARS ? oneLine : `${chars.slice(0, TITLE_MAX_CHARS - 1).join('').trimEnd()}…`;
}

export function newCreation(input: {
  requestId: string;
  invocationId: string;
  scope: ScopeKey;
  botId: string;
  text: string;
  now: number;
}): SessionCreation {
  const firstMessage = input.text.trim();
  if (!firstMessage) throw new Error('A new session needs a first message');
  return {
    requestId: input.requestId,
    invocationId: input.invocationId,
    scope: input.scope,
    botId: input.botId,
    title: titleFromMessage(firstMessage),
    firstMessage,
    status: 'pending',
    attempts: 0,
    firstAttemptAt: null,
    nextAttemptAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export const isCreationOpen = (c: SessionCreation) => c.status === 'pending' || c.status === 'creating' || c.status === 'unknown';

/** About to POST. Only a `pending` intent may POST; `unknown` must reconcile first. */
export function beginAttempt(c: SessionCreation, now: number): SessionCreation {
  if (c.status !== 'pending') return c;
  return { ...c, status: 'creating', attempts: c.attempts + 1, firstAttemptAt: c.firstAttemptAt ?? now, updatedAt: now };
}

export function onCreated(c: SessionCreation, sessionId: string, now: number): SessionCreation {
  if (c.status === 'created') return c;
  return { ...c, status: 'created', sessionId, lastError: undefined, updatedAt: now };
}

/** Timeout, network error, 5xx, or the process died mid-request: the row may exist. */
export function onCreateLost(c: SessionCreation, now: number, error?: string): SessionCreation {
  if (c.status !== 'creating' && c.status !== 'unknown') return c;
  return { ...c, status: 'unknown', nextAttemptAt: now + backoffMs(c.attempts), lastError: error, updatedAt: now };
}

/** A definite 4xx: nothing was created. */
export function onCreateRejected(c: SessionCreation, error: string, now: number): SessionCreation {
  if (c.status === 'created') return c;
  return { ...c, status: 'failed', lastError: error, updatedAt: now };
}

/** Reconcile found no session from any attempt: POSTing again is safe. */
export function onNotFound(c: SessionCreation, now: number): SessionCreation {
  if (c.status !== 'unknown') return c;
  if (c.attempts >= MAX_CREATE_ATTEMPTS) return { ...c, status: 'failed', lastError: c.lastError ?? 'too_many_attempts', updatedAt: now };
  return { ...c, status: 'pending', nextAttemptAt: now, updatedAt: now };
}

/** A POST that was in flight when the process died is unknown, not failed. */
export function onCreationColdStart(c: SessionCreation, now: number): SessionCreation {
  return c.status === 'creating' ? { ...c, status: 'unknown', nextAttemptAt: now, updatedAt: now } : c;
}

/** The user retries a failed create. A 4xx created nothing; an exhausted one was reconciled. */
export function retryCreation(c: SessionCreation, now: number): SessionCreation {
  if (c.status !== 'failed') return c;
  return { ...c, status: c.firstAttemptAt === null ? 'pending' : 'unknown', attempts: 0, nextAttemptAt: now, updatedAt: now };
}

export type CandidateSession = Readonly<{
  id: string;
  title?: string;
  created_by_user_id?: string;
  created_at?: string;
}>;

/**
 * Sessions this creation may have made, oldest first. `skewMs` is
 * device − server clock (from the list response's Date header). The caller
 * must still check a candidate has no history before adopting it.
 */
export function reconcileCandidates(
  c: SessionCreation,
  sessions: readonly CandidateSession[],
  options: { accountId: string; skewMs: number; claimed: ReadonlySet<string> },
): CandidateSession[] {
  if (c.firstAttemptAt === null) return [];
  const since = c.firstAttemptAt - options.skewMs - RECONCILE_SLACK_MS;
  return sessions
    .filter((s) => {
      if (options.claimed.has(s.id)) return false;
      if ((s.title ?? '') !== c.title) return false;
      if (s.created_by_user_id && s.created_by_user_id !== options.accountId) return false;
      const created = s.created_at ? Date.parse(s.created_at) : Number.NaN;
      return !Number.isNaN(created) && created >= since;
    })
    .sort((a, b) => Date.parse(a.created_at!) - Date.parse(b.created_at!));
}
