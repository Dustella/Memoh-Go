import { describe, expect, it } from 'vitest';

import messages from '../../../contracts/fixtures/messages.json';
import { scopeKey } from '../identity/scope';
import {
  MAX_ATTEMPTS,
  backoffMs,
  createOutboxEntry,
  dueEntries,
  markSent,
  onAckLost,
  onRejected,
  onRunAccepted,
  onRunObserved,
  onTurnPersisted,
  type OutboxEntry,
} from './outbox';

const scope = scopeKey({ deployment: 'https://a.example', accountId: 'usr_0001', teamId: 't' });
const otherScope = scopeKey({ deployment: 'https://b.example', accountId: 'usr_0001', teamId: 't' });

function entry(id: string, sessionId = 'sess_0000aaaa', now = 1000, inScope = scope): OutboxEntry {
  return createOutboxEntry({ invocationId: id, scope: inScope, botId: 'bot_demo01', sessionId, payload: { text: 'hi' }, now });
}

describe('outbox lifecycle', () => {
  it('queued → sent → accepted → settled on the happy path', () => {
    let e = markSent(entry('inv_3333dddd'), 1001);
    expect(e).toMatchObject({ status: 'sent', attempts: 1 });
    e = onRunAccepted(e, messages.run_accepted, 1002);
    expect(e).toMatchObject({ status: 'accepted', runId: 'run_1111bbbb', turnId: 'turn_2222cccc' });
    expect(onTurnPersisted(e, 'other_turn', 1003).status).toBe('accepted');
    expect(onTurnPersisted(e, 'turn_2222cccc', 1003).status).toBe('settled');
  });

  it('treats a duplicate ack after a resend as the same admission', () => {
    const resent = markSent(onAckLost(markSent(entry('inv_3333dddd'), 1001), 5000), 5001);
    expect(resent.attempts).toBe(2);
    expect(onRunAccepted(resent, messages.run_accepted_duplicate, 5002)).toMatchObject({
      status: 'accepted',
      runId: 'run_1111bbbb',
    });
  });

  it('backs off on session_busy and fails permanently on invocation conflict', () => {
    const sent = markSent(entry('inv_4444eeee'), 1001);
    const busy = onRejected(sent, messages.run_rejected_busy.code, 2000);
    expect(busy).toMatchObject({ status: 'queued', lastCode: 'session_busy', nextAttemptAt: 2000 + backoffMs(1) });
    expect(onRejected(markSent(busy, 5000), 'session_invocation_conflict', 5001).status).toBe('failed');
  });

  it('gives up after MAX_ATTEMPTS retryable rejections', () => {
    let e = entry('inv_x');
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) e = onRejected(markSent(e, i), 'session_busy', i);
    expect(e.status).toBe('failed');
  });

  it('accepts via a runtime snapshot carrying the invocation id', () => {
    const sent = markSent(entry('inv_3333dddd'), 1001);
    const run = { run_id: 'run_1111bbbb', turn_id: 'turn_2222cccc', invocation_id: 'inv_3333dddd' };
    expect(onRunObserved(sent, { ...run, invocation_id: 'someone_else' }, 1002).status).toBe('sent');
    expect(onRunObserved(sent, run, 1002).status).toBe('accepted');
  });

  it('never revives a settled or failed entry', () => {
    const failed = onRejected(markSent(entry('inv_f'), 1), 'session_invocation_conflict', 2);
    expect(onRunAccepted(failed, messages.run_accepted, 3).status).toBe('failed');
    expect(onAckLost(failed, 3).status).toBe('failed');
  });
});

describe('dueEntries', () => {
  it('sends only the oldest unfinished entry per session, and only in the active scope', () => {
    const first = markSent(entry('a', 's1', 1), 2);
    const second = entry('b', 's1', 3);
    const otherSession = entry('c', 's2', 4);
    const foreign = entry('d', 's3', 5, otherScope);
    expect(dueEntries([second, first, otherSession, foreign], scope, 10).map((e) => e.invocationId)).toEqual(['c']);

    const firstDone = onTurnPersisted(onRunAccepted(first, { run_id: 'r', turn_id: 't' }, 6), 't', 7);
    expect(dueEntries([firstDone, second, otherSession], scope, 10).map((e) => e.invocationId)).toEqual(['b', 'c']);
  });

  it('respects the backoff time', () => {
    const busy = onRejected(markSent(entry('a'), 1), 'session_busy', 100);
    expect(dueEntries([busy], scope, 100)).toHaveLength(0);
    expect(dueEntries([busy], scope, 100 + backoffMs(1))).toHaveLength(1);
  });
});
