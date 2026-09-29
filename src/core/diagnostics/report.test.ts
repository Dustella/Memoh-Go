import { describe, expect, it } from 'vitest';

import { createOutboxEntry } from '../operations/outbox';
import { createLogger } from './log';
import { buildDiagnosticsReport } from './report';

describe('buildDiagnosticsReport (PF-04)', () => {
  it('summarises state without message content, credentials or URL queries', () => {
    const log = createLogger({ now: () => 0 });
    log.warn('outbox.failed', { invocation_id: 'inv-1', code: 'session_invocation_conflict', text: 'secret question' });
    log.error('js.uncaught', { error: new Error('boom with Bearer abc.def') });
    const entry = createOutboxEntry({
      invocationId: 'inv-2',
      scope: {} as never,
      botId: 'b',
      sessionId: 's',
      payload: { text: 'another private message' },
      now: 0,
    });

    const report = buildDiagnosticsReport({
      generatedAt: 0,
      app: { version: '0.1.0', build: '1', platform: 'android', osVersion: '35' },
      server: {
        deployment: 'http://172.22.2.106:18080/?token=zzz',
        version: 'dev',
        commit: 'abc123',
        invocationLookup: 'supported',
        admissionDedup: 'unknown',
        session: 'signed_in',
      },
      outbox: [entry, { ...entry, invocationId: 'inv-3', status: 'unconfirmed', needsUser: true }],
      entries: log.entries(),
    });

    expect(report).toContain('server: http://172.22.2.106:18080/ version=dev commit=abc123');
    expect(report).toContain('outbox: queued=1 unconfirmed=1 needs_user=1');
    expect(report).toContain('outbox.failed invocation_id=inv-1 code=session_invocation_conflict text=[redacted]');
    for (const leaked of ['secret question', 'private message', 'zzz', 'abc.def']) expect(report).not.toContain(leaked);
  });

  it('handles a signed-out app with an empty queue', () => {
    const report = buildDiagnosticsReport({
      generatedAt: 0,
      app: { version: '0.1.0', build: '1', platform: 'android', osVersion: '35' },
      server: null,
      outbox: [],
      entries: [],
    });
    expect(report).toContain('server: signed out');
    expect(report).toContain('outbox: empty');
  });
});
