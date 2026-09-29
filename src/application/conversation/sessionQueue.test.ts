import { describe, expect, it } from 'vitest';

import type { FetchFn, FetchResponse } from '../../data/remote/memohClient';
import type { ConnectionManager } from '../access/connectService';
import { SessionQueueController } from './sessionQueue';

const json = (status: number, body: unknown): FetchResponse => ({
  status,
  headers: { get: (n) => (n === 'content-type' ? 'application/json' : null) },
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});
const problem = (status: number, code: string, detail = code) => json(status, { type: `urn:memoh:error:${code}`, status, detail, code });

type Handler = (method: string, path: string, body: unknown) => FetchResponse | 'network';

function setup(handler: Handler) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const path = url.replace('https://m.example', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body });
    const res = handler(init.method, path, body);
    if (res === 'network') throw new Error('Network request failed');
    return res;
  };
  const access = {
    withToken: <T,>(call: (token: string, session: { connection: { deployment: string } }) => Promise<T>) =>
      call('tok', { connection: { deployment: 'https://m.example' } }),
  } as unknown as ConnectionManager;
  let n = 0;
  const queue = new SessionQueueController({ access, fetchFn, newId: () => `inv-${++n}`, sleep: async () => undefined }, 'b1', 's1');
  return { queue, calls };
}

const QUEUE = '/bots/b1/sessions/s1/queue';
const FOLLOW = '/bots/b1/sessions/s1/follow-up-queue';
const STEER = '/bots/b1/sessions/s1/steer-queue';
const item = (id: string, text: string, status = 'accepted') => ({ item_id: id, status, position: 1, text });

describe('SessionQueueController (CH-13)', () => {
  it('queues a follow-up and lists pending items, steer first', async () => {
    const { queue, calls } = setup((method, path) => {
      if (method === 'POST' && path === FOLLOW) return json(202, item('f1', 'later'));
      if (path === QUEUE) return json(200, { steer_supported: true, steer: [item('s0', 'now'), item('s9', 'done', 'applied')], follow_up: [item('f1', 'later')] });
      return json(404, { message: 'Not Found' });
    });
    expect(await queue.submit('follow_up', 'later')).toEqual({ kind: 'queued' });
    expect(calls.find((c) => c.path === FOLLOW)?.body).toEqual({ invocation_id: 'inv-1', text: 'later' });
    await queue.refresh();
    expect(queue.getView()).toMatchObject({ support: 'yes', steerSupported: true });
    expect(queue.getView().items.map((i) => `${i.kind}:${i.item_id}`)).toEqual(['steer:s0', 'follow_up:f1']);
    queue.dispose();
  });

  it('retries a lost response with the same invocation id', async () => {
    let posts = 0;
    const { queue, calls } = setup((method, path) => {
      if (method === 'POST' && path === FOLLOW) return ++posts === 1 ? 'network' : json(202, item('f1', 'x'));
      return json(200, { steer_supported: false, steer: [], follow_up: [] });
    });
    expect(await queue.submit('follow_up', 'x')).toEqual({ kind: 'queued' });
    const ids = calls.filter((c) => c.path === FOLLOW).map((c) => (c.body as { invocation_id: string }).invocation_id);
    expect(ids).toEqual(['inv-1', 'inv-1']);
    queue.dispose();
  });

  it('falls back to a normal send on servers without the queue route', async () => {
    const { queue } = setup(() => json(404, { message: 'Not Found' }));
    expect(await queue.submit('follow_up', 'x')).toEqual({ kind: 'send_now' });
    expect(queue.getView().support).toBe('no');
    // Once known unsupported, nothing is posted any more.
    expect(await queue.submit('steer', 'y')).toEqual({ kind: 'send_now' });
    queue.dispose();
  });

  it('sends normally when the run already ended, but only if no earlier attempt may have landed', async () => {
    const clean = setup(() => problem(409, 'queue_no_active_run'));
    expect(await clean.queue.submit('follow_up', 'x')).toEqual({ kind: 'send_now' });

    let posts = 0;
    const lossy = setup((method, path) => (method === 'POST' && path === FOLLOW ? (++posts === 1 ? 'network' : problem(409, 'queue_no_active_run')) : json(200, {})));
    expect(await lossy.queue.submit('follow_up', 'x')).toEqual({ kind: 'returned' });
    expect(lossy.queue.getView().notice).toBe('任务已结束，消息已放回输入框');
  });

  it('turns an unsupported steer into a follow-up', async () => {
    const { queue, calls } = setup((method, path) => {
      if (path === QUEUE) return json(200, { steer_supported: true, steer: [], follow_up: [] });
      if (method === 'POST' && path === STEER) return problem(409, 'queue_steer_unsupported');
      if (method === 'POST' && path === FOLLOW) return json(202, item('f1', 'x'));
      return json(500, {});
    });
    await queue.refresh();
    expect(await queue.submit('steer', 'x')).toEqual({ kind: 'queued' });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([STEER, FOLLOW]);
    expect(queue.getView().notice).toBe('当前任务不支持立即引导，已改为回复结束后发送');
    queue.dispose();
  });

  it('never steers when the run does not support it', async () => {
    const { queue, calls } = setup((method, path) => {
      if (path === QUEUE) return json(200, { steer_supported: false, steer: [], follow_up: [] });
      return json(202, item('f1', 'x'));
    });
    await queue.refresh();
    await queue.submit('steer', 'x');
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([FOLLOW]);
    queue.dispose();
  });

  it('returns the text on a conflict or a full queue', async () => {
    const full = setup(() => problem(409, 'queue_capacity_exceeded'));
    expect(await full.queue.submit('follow_up', 'x')).toEqual({ kind: 'returned' });
    expect(full.queue.getView().notice).toBe('排队的消息太多了，请稍后再试');
  });

  it('cancels and promotes items', async () => {
    const { queue, calls } = setup((method) => (method === 'DELETE' ? json(204, undefined) : json(200, { steer_supported: true, steer: [], follow_up: [] })));
    await queue.cancel({ ...item('f1', 'x'), kind: 'follow_up' } as never);
    await queue.promote({ ...item('f2', 'y'), kind: 'follow_up' } as never);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /bots/b1/sessions/s1/follow-up-queue/f1',
      `GET ${QUEUE}`,
      'POST /bots/b1/sessions/s1/follow-up-queue/f2/steer',
      `GET ${QUEUE}`,
    ]);
    queue.dispose();
  });
});
