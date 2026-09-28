import { describe, expect, it } from 'vitest';

import {
  capabilitiesFromPing,
  observeRunAccepted,
  reconcileCapabilities,
  type ServerCapabilities,
} from '../identity/capabilities';
import { scopeKey } from '../identity/scope';
import { classifyLookupResponse, lookupInvocation } from './invocationLookup';
import { createOutboxEntry, markSent, onAckLost, onColdStart, onRunObserved, recover, unconfirmedDue } from './outbox';
import { afterLookup, planRecovery } from './recovery';

const expected = { sessionId: 'sess_1', invocationId: 'inv_1' };
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json; charset=UTF-8', body: JSON.stringify(body) });

describe('classifyLookupResponse', () => {
  it('reads found / not found answers about this invocation', () => {
    expect(
      classifyLookupResponse(
        json(200, { found: true, invocation_id: 'inv_1', session_id: 'sess_1', run_id: 'r', turn_id: 't', state: 'completed' }),
        expected,
      ),
    ).toEqual({ kind: 'found', runId: 'r', turnId: 't', state: 'completed' });
    expect(classifyLookupResponse(json(200, { found: false, invocation_id: 'inv_1', session_id: 'sess_1' }), expected)).toEqual({
      kind: 'not_found',
    });
  });

  // Bodies below were recorded from the dev server (2026-09-28).
  it('treats the router 404 as an older server without the route', () => {
    expect(classifyLookupResponse(json(404, { message: 'Not Found' }), expected).kind).toBe('unsupported');
    expect(classifyLookupResponse(json(405, { message: 'Method Not Allowed' }), expected).kind).toBe('unsupported');
  });

  it('tells a missing session apart from a missing route', () => {
    expect(classifyLookupResponse(json(404, { message: 'session not found' }), expected)).toEqual({
      kind: 'unavailable',
      reason: 'session_not_found',
    });
  });

  it('never trusts a 200 that is not a lookup answer for this invocation', () => {
    const html = { status: 200, contentType: 'text/html', body: '<!doctype html><div id="app"></div>' };
    expect(classifyLookupResponse(html, expected).kind).toBe('unsupported');
    expect(classifyLookupResponse(json(200, { items: [] }), expected).kind).toBe('unsupported');
    expect(classifyLookupResponse(json(200, { found: false, invocation_id: 'other' }), expected).kind).toBe('unsupported');
    expect(classifyLookupResponse(json(200, { found: true, invocation_id: 'inv_1', session_id: 'x' }), expected).kind).toBe(
      'unavailable',
    );
    expect(classifyLookupResponse(json(200, { found: true, invocation_id: 'inv_1' }), expected)).toEqual({
      kind: 'unavailable',
      reason: 'malformed',
    });
  });

  it('keeps auth and server errors retryable', () => {
    expect(classifyLookupResponse(json(401, {}), expected)).toEqual({ kind: 'unavailable', reason: 'auth' });
    expect(classifyLookupResponse(json(503, {}), expected)).toEqual({ kind: 'unavailable', reason: 'http_503' });
  });
});

describe('lookupInvocation', () => {
  it('builds an encoded URL with a bearer header and maps network failures', async () => {
    const calls: { url: string; auth: string }[] = [];
    const ok = await lookupInvocation(
      async (url, init) => {
        calls.push({ url, auth: init.headers.authorization! });
        return { status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ found: false, invocation_id: 'inv 1' }) };
      },
      { baseUrl: 'https://m.example/', accessToken: 'tok', botId: 'b', sessionId: 's', invocationId: 'inv 1' },
    );
    expect(ok.kind).toBe('not_found');
    expect(calls).toEqual([{ url: 'https://m.example/bots/b/sessions/s/invocations/inv%201', auth: 'Bearer tok' }]);

    const down = await lookupInvocation(
      async () => {
        throw new Error('offline');
      },
      { baseUrl: 'https://m.example', accessToken: 't', botId: 'b', sessionId: 's', invocationId: 'i' },
    );
    expect(down).toEqual({ kind: 'unavailable', reason: 'network' });
  });
});

describe('capabilities', () => {
  const ping = { status: 'ok', version: 'v0.20.0', commit_hash: 'abc1234' };

  it('starts unknown and only enables lookup from an explicit feature', () => {
    expect(capabilitiesFromPing('https://m.example', ping)).toMatchObject({ invocationLookup: 'unknown', admissionDedup: 'unknown' });
    expect(capabilitiesFromPing('https://m.example', { ...ping, features: ['invocation_lookup'] }).invocationLookup).toBe('yes');
  });

  it('keeps learned facts for the same build and forgets them after an upgrade', () => {
    const learned: ServerCapabilities = { ...observeRunAccepted(capabilitiesFromPing('https://m.example', ping)), invocationLookup: 'no' };
    expect(reconcileCapabilities(learned, capabilitiesFromPing('https://m.example/', ping))).toEqual(learned);
    expect(reconcileCapabilities(learned, capabilitiesFromPing('https://m.example', { ...ping, version: 'v0.21.0' }))).toMatchObject({
      invocationLookup: 'unknown',
      admissionDedup: 'unknown',
    });
  });
});

describe('recovering an unconfirmed send', () => {
  const scope = scopeKey({ deployment: 'https://m.example', accountId: 'u', teamId: 't' });
  const base = capabilitiesFromPing('https://m.example', { status: 'ok', version: 'v0.20.0', commit_hash: 'abc1234' });
  const withDedup = observeRunAccepted(base);
  const lost = onAckLost(
    markSent(createOutboxEntry({ invocationId: 'inv_1', scope, botId: 'b', sessionId: 'sess_1', payload: { text: 'hi' }, now: 1 }), 2),
    3,
  );

  it('marks a lost ack unconfirmed instead of resending blindly', () => {
    expect(lost.status).toBe('unconfirmed');
    expect(onColdStart([markSent(lost, 4)], 10).map((e) => e.status)).toEqual(['unconfirmed']);
  });

  it('probes the lookup first while support is unknown', () => {
    expect(planRecovery(base)).toBe('lookup');
  });

  it('settles from a lookup answer', () => {
    const found = afterLookup(base, { kind: 'found', runId: 'r', turnId: 't' });
    expect(found.caps.invocationLookup).toBe('yes');
    expect(recover(lost, found.step, 5)).toMatchObject({ status: 'accepted', runId: 'r', turnId: 't' });
    expect(recover(lost, afterLookup(base, { kind: 'not_found' }).step, 5).status).toBe('queued');
  });

  it('falls back to deduplicated resend on an older server that proved dedup', () => {
    const { caps, step } = afterLookup(withDedup, { kind: 'unsupported' });
    expect(caps.invocationLookup).toBe('no');
    expect(step).toEqual({ kind: 'resend' });
    expect(planRecovery(caps)).toEqual({ kind: 'resend' });
    expect(recover(lost, step, 5).status).toBe('queued');
  });

  it('asks the user when neither lookup nor dedup is proven', () => {
    const { caps, step } = afterLookup(base, { kind: 'unsupported' });
    expect(step).toEqual({ kind: 'await_user' });
    const waiting = recover(lost, step, 5);
    expect(waiting).toMatchObject({ status: 'unconfirmed', needsUser: true });
    expect(unconfirmedDue([waiting], scope, 100)).toHaveLength(0);
    expect(planRecovery(caps)).toEqual({ kind: 'await_user' });

    expect(recover(waiting, { kind: 'user_resend' }, 6)).toMatchObject({ status: 'queued', needsUser: undefined });
    expect(recover(waiting, { kind: 'user_discard' }, 6)).toMatchObject({ status: 'failed', lastCode: 'discarded' });
    // Seeing the run in a live snapshot settles it without asking.
    const seen = onRunObserved(waiting, { run_id: 'r', turn_id: 't', invocation_id: 'inv_1' }, 7);
    expect(seen).toMatchObject({ status: 'accepted', needsUser: undefined });
  });

  it('waits out transient lookup failures only when the lookup is proven', () => {
    const proven = { ...base, invocationLookup: 'yes' as const };
    const transient = { kind: 'unavailable', reason: 'network' } as const;
    expect(afterLookup(proven, transient).step).toEqual({ kind: 'retry_later' });
    expect(afterLookup(withDedup, transient).step).toEqual({ kind: 'resend' });
    expect(afterLookup(base, transient).step).toEqual({ kind: 'await_user' });
    expect(recover(lost, { kind: 'retry_later' }, 50).nextAttemptAt).toBeGreaterThan(50);
  });

  it('fails when the session no longer exists', () => {
    const { step } = afterLookup(base, { kind: 'unavailable', reason: 'session_not_found' });
    expect(recover(lost, step, 5)).toMatchObject({ status: 'failed', lastCode: 'session_not_found' });
  });
});
