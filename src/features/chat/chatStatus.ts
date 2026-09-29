import { t, tn } from '../../core/i18n';
import type { ControlRequest } from '../../core/operations/controls';
import type { OutboxEntry } from '../../core/operations/outbox';
import type { SocketStatus } from '../../data/remote/runtimeSocket';

/**
 * CH-08: the chat screen reports four kinds of state separately, so one
 * problem never hides or impersonates another:
 *
 * - connection: is the live socket up?
 * - sync: is the local copy of history current?
 * - operations: what happened to things the user asked for (sends, stop)?
 * - run: what is the Bot doing? Shown in the message list (working row and
 *   run notices), not in this strip, because it belongs to a turn.
 *
 * Only abnormal states produce a line; a healthy chat shows nothing.
 */
export type StatusKind = 'connection' | 'sync' | 'operations';
export type StatusTone = 'info' | 'warning' | 'error';
export type StatusAction = 'retry_sync';

export type StatusLine = Readonly<{
  kind: StatusKind;
  tone: StatusTone;
  text: string;
  action?: StatusAction;
}>;

export type ChatStatusInput = Readonly<{
  socket: SocketStatus;
  /** A fresh server snapshot was adopted since the last (re)subscribe. */
  live: boolean;
  historyLoaded: boolean;
  historyError: string | null;
  pending: readonly OutboxEntry[];
  failed: readonly OutboxEntry[];
  controls: readonly ControlRequest[];
}>;

function connectionLine(input: ChatStatusInput): StatusLine | null {
  if (input.socket === 'connecting') return { kind: 'connection', tone: 'info', text: t('chat.status.connecting') };
  if (input.socket === 'closed') return { kind: 'connection', tone: 'warning', text: t('chat.status.offline') };
  return null;
}

function syncLine(input: ChatStatusInput): StatusLine | null {
  if (input.historyError) return { kind: 'sync', tone: 'warning', text: t('chat.status.historyFailed'), action: 'retry_sync' };
  // Socket up but the first snapshot is not in yet: a running reply may still be catching up.
  if (input.socket === 'open' && !input.live) return { kind: 'sync', tone: 'info', text: t('chat.status.fetchingLive') };
  return null;
}

function operationsLine(input: ChatStatusInput): StatusLine | null {
  const unsure = input.pending.filter((e) => e.status === 'unconfirmed' && e.needsUser).length;
  const waiting = input.pending.length - unsure;
  const failedSends = input.failed.length;
  const stopFailed = input.controls.some((c) => c.kind === 'abort' && c.status === 'failed');

  const parts: string[] = [];
  let tone: StatusTone = 'info';
  if (failedSends > 0) {
    parts.push(tn('chat.status.failedSends', failedSends));
    tone = 'error';
  }
  if (unsure > 0) {
    parts.push(tn('chat.status.unsureSends', unsure));
    if (tone !== 'error') tone = 'warning';
  }
  if (stopFailed) {
    parts.push(t('chat.status.stopUnsent'));
    if (tone !== 'error') tone = 'warning';
  }
  // Queued sends are normal while connected (they go out in a moment); only say so when they are stuck.
  if (waiting > 0 && input.socket !== 'open') parts.push(tn('chat.status.waitingSends', waiting));
  return parts.length > 0 ? { kind: 'operations', tone, text: parts.join(' · ') } : null;
}

/** Status lines to show above the conversation, most fundamental first. */
export function chatStatus(input: ChatStatusInput): StatusLine[] {
  if (!input.historyLoaded) return [];
  return [connectionLine(input), syncLine(input), operationsLine(input)].filter((l): l is StatusLine => l !== null);
}
