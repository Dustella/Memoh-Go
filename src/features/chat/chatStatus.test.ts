import { describe, expect, it } from 'vitest';

import { abortControl } from '../../core/operations/controls';
import { createOutboxEntry, type OutboxEntry } from '../../core/operations/outbox';
import { chatStatus, type ChatStatusInput } from './chatStatus';

const scope = { deploymentId: 'd', accountId: 'a', teamId: 't' } as never;

function entry(id: string, patch: Partial<OutboxEntry> = {}): OutboxEntry {
  return { ...createOutboxEntry({ invocationId: id, scope, botId: 'b', sessionId: 's', payload: { text: id }, now: 0 }), ...patch };
}

const healthy: ChatStatusInput = {
  socket: 'open',
  live: true,
  historyLoaded: true,
  historyError: null,
  pending: [],
  failed: [],
  controls: [],
};

describe('chatStatus (CH-08)', () => {
  it('shows nothing for a healthy chat, or before the cache is read', () => {
    expect(chatStatus(healthy)).toEqual([]);
    expect(chatStatus({ ...healthy, socket: 'closed', historyLoaded: false })).toEqual([]);
  });

  it('keeps connection and sync problems apart', () => {
    const lines = chatStatus({ ...healthy, socket: 'closed', live: false, historyError: 'timeout' });
    expect(lines.map((l) => l.kind)).toEqual(['connection', 'sync']);
    expect(lines[1]).toMatchObject({ tone: 'warning', action: 'retry_sync' });
  });

  it('reports a socket that is up but has no snapshot yet as sync, not connection', () => {
    expect(chatStatus({ ...healthy, live: false })).toEqual([
      { kind: 'sync', tone: 'info', text: '正在获取最新状态…' },
    ]);
  });

  it('only mentions queued sends when they are stuck behind the connection', () => {
    const pending = [entry('q1'), entry('q2', { status: 'sent' })];
    expect(chatStatus({ ...healthy, pending })).toEqual([]);
    const offline = chatStatus({ ...healthy, socket: 'closed', pending });
    expect(offline[1]).toEqual({ kind: 'operations', tone: 'info', text: '2 条消息将在连接后发送' });
  });

  it('ranks failed above unsure, and counts each once', () => {
    const lines = chatStatus({
      ...healthy,
      pending: [entry('u', { status: 'unconfirmed', needsUser: true }), entry('q')],
      failed: [entry('f', { status: 'failed' })],
    });
    expect(lines).toEqual([
      { kind: 'operations', tone: 'error', text: '1 条消息发送失败 · 1 条消息可能未送达，请确认' },
    ]);
  });

  it('flags a stop request that did not reach the server', () => {
    const stop = { ...abortControl({ controlId: 'c', runId: 'r', sessionId: 's' }), status: 'failed' as const };
    expect(chatStatus({ ...healthy, controls: [stop] })).toEqual([
      { kind: 'operations', tone: 'warning', text: '停止请求未送达' },
    ]);
  });
});
