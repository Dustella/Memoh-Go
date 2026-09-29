import { describe, expect, it } from 'vitest';

import { scopeKey } from '../identity/scope';
import {
  MAX_CREATE_ATTEMPTS,
  beginAttempt,
  newCreation,
  onCreateLost,
  onCreateRejected,
  onCreated,
  onCreationColdStart,
  onNotFound,
  reconcileCandidates,
  retryCreation,
  titleFromMessage,
} from './sessionCreate';

const scope = scopeKey({ deployment: 'https://a.example', accountId: 'u1', teamId: 'default' });
const T0 = Date.parse('2026-09-29T00:00:00Z');
const make = () => newCreation({ requestId: 'r1', invocationId: 'i1', scope, botId: 'b1', text: '  hello\n world  ', now: T0 });

describe('titleFromMessage', () => {
  it('collapses whitespace and keeps short text whole', () => {
    expect(titleFromMessage('  a\n\nb  c ')).toBe('a b c');
  });
  it('cuts to 40 code points with an ellipsis, without splitting emoji', () => {
    const text = '😀'.repeat(45);
    const title = titleFromMessage(text);
    expect(Array.from(title)).toHaveLength(40);
    expect(title).toBe(`${'😀'.repeat(39)}…`);
    expect(titleFromMessage('😀'.repeat(40))).toBe('😀'.repeat(40));
  });
});

describe('session creation', () => {
  it('rejects an empty first message', () => {
    expect(() => newCreation({ requestId: 'r', invocationId: 'i', scope, botId: 'b', text: '  ', now: T0 })).toThrow();
  });

  it('pending → creating → created keeps the first attempt time', () => {
    const c1 = beginAttempt(make(), T0 + 10);
    expect(c1).toMatchObject({ status: 'creating', attempts: 1, firstAttemptAt: T0 + 10, title: 'hello world', firstMessage: 'hello\n world' });
    const lost = onCreateLost(c1, T0 + 20);
    const again = beginAttempt(onNotFound(lost, T0 + 30), T0 + 40);
    expect(again).toMatchObject({ status: 'creating', attempts: 2, firstAttemptAt: T0 + 10 });
    expect(onCreated(again, 's1', T0 + 50)).toMatchObject({ status: 'created', sessionId: 's1' });
  });

  it('an unknown create never POSTs before reconciling', () => {
    const lost = onCreateLost(beginAttempt(make(), T0), T0 + 1);
    expect(lost.status).toBe('unknown');
    expect(lost.nextAttemptAt).toBeGreaterThan(T0 + 1);
    expect(beginAttempt(lost, T0 + 2)).toBe(lost);
  });

  it('a POST in flight at process death becomes unknown', () => {
    expect(onCreationColdStart(beginAttempt(make(), T0), T0 + 5).status).toBe('unknown');
    expect(onCreationColdStart(make(), T0 + 5).status).toBe('pending');
  });

  it('gives up after too many attempts, and a retry reconciles first', () => {
    let c = make();
    for (let i = 0; i < MAX_CREATE_ATTEMPTS; i++) c = onNotFound(onCreateLost(beginAttempt(c, T0 + i), T0 + i), T0 + i);
    expect(c.status).toBe('failed');
    expect(retryCreation(c, T0 + 100)).toMatchObject({ status: 'unknown', attempts: 0 });
  });

  it('a rejected create retries by POSTing when nothing was ever attempted', () => {
    const rejected = onCreateRejected(make(), 'forbidden', T0);
    expect(retryCreation(rejected, T0 + 1).status).toBe('pending');
  });
});

describe('reconcileCandidates', () => {
  const attempted = onCreateLost(beginAttempt(make(), T0), T0 + 1);
  const at = (ms: number) => new Date(ms).toISOString();

  it('matches title, owner and time, oldest first', () => {
    const found = reconcileCandidates(
      attempted,
      [
        { id: 'late', title: 'hello world', created_by_user_id: 'u1', created_at: at(T0 + 3000) },
        { id: 'first', title: 'hello world', created_by_user_id: 'u1', created_at: at(T0 + 500) },
        { id: 'other-title', title: 'nope', created_by_user_id: 'u1', created_at: at(T0 + 500) },
        { id: 'other-user', title: 'hello world', created_by_user_id: 'u2', created_at: at(T0 + 500) },
        { id: 'too-old', title: 'hello world', created_by_user_id: 'u1', created_at: at(T0 - 60_000) },
        { id: 'taken', title: 'hello world', created_by_user_id: 'u1', created_at: at(T0 + 500) },
      ],
      { accountId: 'u1', skewMs: 0, claimed: new Set(['taken']) },
    );
    expect(found.map((s) => s.id)).toEqual(['first', 'late']);
  });

  it('corrects for a device clock that runs ahead of the server', () => {
    // Device is 2 minutes ahead: the server stamped the row 2 minutes "earlier".
    const sessions = [{ id: 's', title: 'hello world', created_by_user_id: 'u1', created_at: at(T0 - 120_000 + 200) }];
    expect(reconcileCandidates(attempted, sessions, { accountId: 'u1', skewMs: 0, claimed: new Set() })).toEqual([]);
    expect(reconcileCandidates(attempted, sessions, { accountId: 'u1', skewMs: 120_000, claimed: new Set() })).toHaveLength(1);
  });

  it('never matches before any attempt', () => {
    const sessions = [{ id: 's', title: 'hello world', created_by_user_id: 'u1', created_at: at(T0) }];
    expect(reconcileCandidates(make(), sessions, { accountId: 'u1', skewMs: 0, claimed: new Set() })).toEqual([]);
  });
});
