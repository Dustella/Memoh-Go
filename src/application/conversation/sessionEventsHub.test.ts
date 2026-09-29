import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionActivity } from '../../core/sync/sessionEvents';
import type { ConnectionManager } from '../access/connectService';
import { SessionEventsHub, type EventStreamHandlers } from './sessionEventsHub';

type Stream = { url: string; headers: Readonly<Record<string, string>>; handlers: EventStreamHandlers; closed: boolean };

function setup() {
  const streams: Stream[] = [];
  const access = {
    ensureFresh: async () => ({ credential: { accessToken: 'tok' }, connection: { deployment: 'https://m.example/' } }),
  } as unknown as ConnectionManager;
  const hub = new SessionEventsHub(access, (url, headers, handlers) => {
    const s: Stream = { url, headers, handlers, closed: false };
    streams.push(s);
    return { close: () => void (s.closed = true) };
  });
  return { hub, streams };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('SessionEventsHub (SS-05)', () => {
  it('shares one authenticated stream per Bot and routes parsed activity', async () => {
    const { hub, streams } = setup();
    const a: SessionActivity[] = [];
    const b: SessionActivity[] = [];
    const offA = hub.subscribe('b1', (x) => a.push(x));
    const offB = hub.subscribe('b1', (x) => b.push(x));
    await flush();
    expect(streams).toHaveLength(1);
    expect(streams[0]!.url).toBe('https://m.example/bots/b1/sessions/events');
    expect(streams[0]!.headers.authorization).toBe('Bearer tok');

    streams[0]!.handlers.onChunk('data: {"type":"session_touched","session_id":"s1","updated_at":"t"}\n');
    streams[0]!.handlers.onChunk('\ndata: {"type":"ping"}\n\n');
    expect(a).toEqual([{ type: 'touched', sessionId: 's1', updatedAt: 't' }]);
    expect(b).toEqual(a);

    offA();
    expect(streams[0]!.closed).toBe(false);
    offB();
    expect(streams[0]!.closed).toBe(true);
  });

  it('reconnects with backoff, and gives up on servers without the route', async () => {
    const { hub, streams } = setup();
    hub.subscribe('b1', () => undefined);
    await flush();
    streams[0]!.handlers.onClose(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(streams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(streams).toHaveLength(2);

    streams[1]!.handlers.onClose(404);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(streams).toHaveLength(2);
  });

  it('closes everything on closeAll', async () => {
    const { hub, streams } = setup();
    hub.subscribe('b1', () => undefined);
    hub.subscribe('b2', () => undefined);
    await flush();
    hub.closeAll();
    expect(streams.every((s) => s.closed)).toBe(true);
  });
});
