import { describe, expect, it } from 'vitest';

import { createSseParser, toActivity } from './sessionEvents';

// Verbatim chunk recorded from the dev stack (two events in one read).
const RECORDED =
  'data: {"cache_invalidation":true,"session_id":"","type":"activity_ready"}\n\ndata: {"session_id":"","session_ids":[],"type":"session_compaction"}\n\n';

describe('createSseParser', () => {
  it('emits each event, across arbitrary chunk boundaries', () => {
    const out: string[] = [];
    const parser = createSseParser((d) => out.push(d));
    for (const ch of RECORDED) parser.feed(ch);
    expect(out.map((d) => JSON.parse(d).type)).toEqual(['activity_ready', 'session_compaction']);
  });

  it('joins multi-line data, ignores comments and CRLF', () => {
    const out: string[] = [];
    const parser = createSseParser((d) => out.push(d));
    parser.feed(': keep-alive\r\ndata: a\r\ndata:b\r\nevent: x\r\n\r\n');
    expect(out).toEqual(['a\nb']);
  });
});

describe('toActivity', () => {
  it('maps the frames the app acts on', () => {
    expect(toActivity({ type: 'session_touched', session_id: 's1', updated_at: 't' })).toEqual({ type: 'touched', sessionId: 's1', updatedAt: 't' });
    expect(toActivity({ type: 'session_invalidated', session_id: 's1' })).toEqual({ type: 'touched', sessionId: 's1', updatedAt: undefined });
    expect(toActivity({ type: 'session_created', session_id: 's2', title: 'x' })).toEqual({ type: 'created', sessionId: 's2', title: 'x' });
    expect(toActivity({ type: 'session_title_changed', session_id: 's2', title: 'y' })).toEqual({ type: 'title', sessionId: 's2', title: 'y' });
    expect(toActivity({ type: 'dropped', count: 3 })).toEqual({ type: 'resync' });
    expect(toActivity({ type: 'activity_ready', cache_invalidation: true, session_id: '' })).toEqual({ type: 'resync' });
  });

  it('ignores heartbeats, compaction and malformed frames', () => {
    expect(toActivity({ type: 'ping' })).toBeNull();
    expect(toActivity({ type: 'session_compaction', session_ids: [] })).toBeNull();
    expect(toActivity({ type: 'session_touched' })).toBeNull();
    expect(toActivity('nope')).toBeNull();
  });
});
