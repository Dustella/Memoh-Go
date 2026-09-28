import type { ScopeKey } from '../identity/scope';

/**
 * Durable send intent (contracts/u4-invocation-lookup.md). An entry is written
 * before the first send and keeps its invocation id and payload for life, so
 * every retry is the same intent and the server's admission idempotency
 * guarantees at most one run.
 */
export type OutboxStatus = 'queued' | 'sent' | 'accepted' | 'settled' | 'failed';

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
  return {
    ...input,
    status: 'queued',
    attempts: 0,
    nextAttemptAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function markSent(entry: OutboxEntry, now: number): OutboxEntry {
  if (entry.status !== 'queued') return entry;
  return { ...entry, status: 'sent', attempts: entry.attempts + 1, updatedAt: now };
}

/** `run_accepted`, including `duplicate: true` (attached to the existing run). */
export function onRunAccepted(entry: OutboxEntry, ack: { run_id: string; turn_id: string }, now: number): OutboxEntry {
  if (entry.status === 'settled' || entry.status === 'failed') return entry;
  return { ...entry, status: 'accepted', runId: ack.run_id, turnId: ack.turn_id, lastCode: undefined, updatedAt: now };
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

/** Socket closed or the process restarted before an ack: resend the same intent. */
export function onAckLost(entry: OutboxEntry, now: number): OutboxEntry {
  if (entry.status !== 'sent') return entry;
  return { ...entry, status: 'queued', nextAttemptAt: now, updatedAt: now };
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
