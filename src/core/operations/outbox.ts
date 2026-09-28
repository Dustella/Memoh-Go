import type { ScopeKey } from '../identity/scope';

/**
 * Durable send intent (contracts/u4-invocation-lookup.md). An entry is written
 * before the first send and keeps its invocation id and payload for life.
 * `unconfirmed` means the ack was lost: the server may or may not have
 * admitted it, and it is only resent once that is known to be safe.
 */
export type OutboxStatus = 'queued' | 'sent' | 'unconfirmed' | 'accepted' | 'settled' | 'failed';

export type MessagePayload = Readonly<{
  text: string;
  modelId?: string;
  reasoningEffort?: string;
  workspaceTargetId?: string;
}>;

export type OutboxEntry = Readonly<{
  /** Client-minted invocation id; also the entry id. */
  invocationId: string;
  scope: ScopeKey;
  botId: string;
  /** Server session id; always known before an entry is created (contracts/u5). */
  sessionId: string;
  payload: MessagePayload;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms; a queued entry is not sent before this. */
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  runId?: string;
  turnId?: string;
  /** Last rejection / error code, for display and diagnostics. */
  lastCode?: string;
  /** Unconfirmed and no safe automatic path: the UI must ask resend / discard. */
  needsUser?: boolean;
}>;

export const MAX_ATTEMPTS = 20;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

export function createOutboxEntry(input: {
  invocationId: string;
  scope: ScopeKey;
  botId: string;
  sessionId: string;
  payload: MessagePayload;
  now: number;
}): OutboxEntry {
  if (!input.invocationId || !input.sessionId) throw new Error('Outbox entry needs invocationId and sessionId');
  const { now, ...fields } = input;
  return {
    ...fields,
    status: 'queued',
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export function markSent(entry: OutboxEntry, now: number): OutboxEntry {
  if (entry.status !== 'queued') return entry;
  return { ...entry, status: 'sent', attempts: entry.attempts + 1, updatedAt: now };
}

/** `run_accepted`, including `duplicate: true` (attached to the existing run). */
export function onRunAccepted(entry: OutboxEntry, ack: { run_id: string; turn_id: string }, now: number): OutboxEntry {
  if (entry.status === 'settled' || entry.status === 'failed') return entry;
  return {
    ...entry,
    status: 'accepted',
    runId: ack.run_id,
    turnId: ack.turn_id,
    lastCode: undefined,
    needsUser: undefined,
    updatedAt: now,
  };
}

/** Rejections that must never be retried with the same invocation id. */
const TERMINAL_CODES = new Set(['session_invocation_conflict']);

/** `run_rejected`, or an `error` event carrying this invocation id. */
export function onRejected(entry: OutboxEntry, code: string | undefined, now: number): OutboxEntry {
  if (entry.status !== 'sent' && entry.status !== 'queued') return entry;
  const normalized = code || 'unknown';
  if (TERMINAL_CODES.has(normalized) || entry.attempts >= MAX_ATTEMPTS) {
    return { ...entry, status: 'failed', lastCode: normalized, updatedAt: now };
  }
  return { ...entry, status: 'queued', lastCode: normalized, nextAttemptAt: now + backoffMs(entry.attempts), updatedAt: now };
}

/** Socket closed or the process restarted before an ack: the outcome is unknown. */
export function onAckLost(entry: OutboxEntry, now: number): OutboxEntry {
  if (entry.status !== 'sent') return entry;
  return { ...entry, status: 'unconfirmed', nextAttemptAt: now, updatedAt: now };
}

/**
 * Settle an `unconfirmed` entry. Callers pick the step from the server's
 * proven capabilities (identity/capabilities.ts#recoveryMode):
 * - `lookup` outcomes come from operations/invocationLookup.ts;
 * - `resend` is only valid when admission dedup is proven;
 * - `confirm` waits for the user, who may resend or discard.
 * A runtime snapshot carrying the invocation id settles it in any mode
 * (onRunObserved).
 */
export type Recovery =
  | Readonly<{ kind: 'found'; runId: string; turnId: string }>
  | Readonly<{ kind: 'not_found' }>
  | Readonly<{ kind: 'retry_later' }>
  | Readonly<{ kind: 'resend' }>
  | Readonly<{ kind: 'await_user' }>
  | Readonly<{ kind: 'user_resend' }>
  | Readonly<{ kind: 'user_discard' }>
  /** The target is gone (e.g. session deleted); nothing can be sent. */
  | Readonly<{ kind: 'fail'; code: string }>;

export function recover(entry: OutboxEntry, step: Recovery, now: number): OutboxEntry {
  if (entry.status !== 'unconfirmed') return entry;
  switch (step.kind) {
    case 'fail':
      return { ...entry, status: 'failed', needsUser: undefined, lastCode: step.code, updatedAt: now };
    case 'found':
      return onRunAccepted(entry, { run_id: step.runId, turn_id: step.turnId }, now);
    case 'not_found':
    case 'resend':
    case 'user_resend':
      return { ...entry, status: 'queued', needsUser: undefined, nextAttemptAt: now, updatedAt: now };
    case 'retry_later':
      return { ...entry, nextAttemptAt: now + backoffMs(entry.attempts), updatedAt: now };
    case 'await_user':
      return entry.needsUser ? entry : { ...entry, needsUser: true, updatedAt: now };
    case 'user_discard':
      return { ...entry, status: 'failed', needsUser: undefined, lastCode: 'discarded', updatedAt: now };
  }
}

/** Unconfirmed entries whose recovery step is due (retry_later backoff respected). */
export function unconfirmedDue(entries: readonly OutboxEntry[], scope: ScopeKey, now: number): OutboxEntry[] {
  return entries.filter(
    (entry) => entry.scope === scope && entry.status === 'unconfirmed' && !entry.needsUser && entry.nextAttemptAt <= now,
  );
}

/** Cold start: anything still `sent` lost its ack with the old process. */
export function onColdStart(entries: readonly OutboxEntry[], now: number): OutboxEntry[] {
  return entries.map((entry) => onAckLost(entry, now));
}

/**
 * A runtime snapshot/delta whose run carries this invocation id proves
 * admission even if the ack itself was lost.
 */
export function onRunObserved(
  entry: OutboxEntry,
  run: { run_id: string; turn_id: string; invocation_id?: string },
  now: number,
): OutboxEntry {
  if (run.invocation_id !== entry.invocationId) return entry;
  return onRunAccepted(entry, run, now);
}

/** The accepted turn is now in durable history. */
export function onTurnPersisted(entry: OutboxEntry, turnId: string, now: number): OutboxEntry {
  if (entry.status !== 'accepted' || entry.turnId !== turnId) return entry;
  return { ...entry, status: 'settled', updatedAt: now };
}

/**
 * Entries to send now for the active scope. A session admits one active run,
 * so per session only the oldest unfinished entry may be in flight; later
 * entries wait until it settles or fails.
 */
export function dueEntries(entries: readonly OutboxEntry[], scope: ScopeKey, now: number): OutboxEntry[] {
  const bySession = new Map<string, OutboxEntry>();
  const ordered = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  for (const entry of ordered) {
    if (entry.scope !== scope) continue;
    if (entry.status === 'settled' || entry.status === 'failed') continue;
    if (!bySession.has(entry.sessionId)) bySession.set(entry.sessionId, entry);
  }
  return [...bySession.values()].filter((entry) => entry.status === 'queued' && entry.nextAttemptAt <= now);
}
