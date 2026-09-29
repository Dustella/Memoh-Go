import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Turn } from '../../core/conversation/types';
import { newId } from '../../core/ids';
import { createOutboxEntry } from '../../core/operations/outbox';
import { loadOutboxEntry, loadPendingOutbox, saveOutboxEntry } from '../../data/local/outboxStore';
import { loadRecentTurns } from '../../data/local/conversationStore';
import type { SqlDatabase } from '../../data/local/sql';
import type { FetchFn } from '../../data/remote/memohClient';
import type { SocketFactory, SocketLike } from '../../data/remote/runtimeSocket';
import { openNodeDatabase } from '../../../tests/support/nodeDatabase';
import { ConnectionManager, probeServer, type CredentialVault } from '../access/connectService';
import { ConversationSync } from './conversationSync';
import { LiveSessionPool, OutboxPump } from './livePool';
import { LiveSession, type LiveDeps } from './liveSession';
import { RuntimeHub } from './runtimeHub';

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
};

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(readonly url: string, readonly token: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

/** Server-side history and invocation ledger the fake REST endpoints read. */
function fakeRest(options: { lookup: boolean }) {
  const history: Turn[] = [];
  const ledger = new Map<string, { run_id: string; turn_id: string }>();
  const json = (status: number, body: unknown) => ({
    status,
    headers: { get: (n: string) => (n === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
  });
  const fetchFn: FetchFn = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/ping') return json(200, { status: 'ok', version: 'v0.20.0', commit_hash: 'x' });
    if (u.pathname === '/auth/login')
      return json(200, { access_token: 'tok', token_type: 'Bearer', expires_at: '2099-01-01T00:00:00Z', user_id: 'u1' });
    if (u.pathname === '/users/me') return json(200, { id: 'u1', username: 'admin' });
    if (u.pathname === '/bots/bot/messages') return json(200, { items: history });
    const m = /^\/bots\/bot\/sessions\/s1\/invocations\/(.+)$/.exec(u.pathname);
    if (m && options.lookup) {
      const hit = ledger.get(m[1]!);
      return json(200, hit ? { found: true, invocation_id: m[1], session_id: 's1', ...hit, state: 'completed' } : { found: false, invocation_id: m[1], session_id: 's1' });
    }
    return json(404, { message: 'Not Found' });
  };
  return { fetchFn, history, ledger };
}

const memoryVault = (): CredentialVault => {
  const m = new Map();
  return { load: async (id) => m.get(id) ?? null, save: async (id, c) => void m.set(id, c), remove: async (id) => void m.delete(id) };
};

let db: SqlDatabase;
beforeEach(async () => {
  db = await openNodeDatabase();
});
afterEach(async () => {
  await db.close();
});

async function setup(options: { lookup: boolean; readAttachment?: LiveDeps['readAttachment'] } = { lookup: true }) {
  const rest = fakeRest(options);
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = (url, token) => {
    const s = new FakeSocket(url, token);
    sockets.push(s);
    return s;
  };
  let clock = 1_000;
  const access = new ConnectionManager({ db, vault: memoryVault(), fetchFn: rest.fetchFn, now: () => clock, newId });
  const probe = await probeServer({ fetchFn: rest.fetchFn }, 'http://memoh.test');
  if (probe.kind !== 'ok') throw new Error(probe.kind);
  await access.signIn(probe, 'admin', 'pw');
  const sync = new ConversationSync(db, access, rest.fetchFn, () => clock);
  const hub = new RuntimeHub(access, factory);
  const deps = { db, access, sync, hub, fetchFn: rest.fetchFn, now: () => clock, newId, tickMs: 60_000, readAttachment: options.readAttachment };
  const live = new LiveSession(deps, 'bot', 's1');
  const socket = () => sockets.at(-1)!;
  const snapshot = (seq = 1, run: unknown = null) =>
    socket().emit({ type: 'runtime_snapshot', session_id: 's1', epoch: 'e1', seq, snapshot: { bot_id: 'bot', session_id: 's1', epoch: 'e1', seq, current_run_view: run, updated_at: 'x' } });
  return { rest, sockets, socket, access, live, deps, hub, snapshot, tick: (ms: number) => (clock += ms) };
}

const runView = (invocationId: string, status: string, text = '') => ({
  run_id: 'r1',
  turn_id: 't1',
  invocation_id: invocationId,
  status,
  started_at: 'a',
  updated_at: 'b',
  messages: text ? [{ id: 0, type: 'text', content: text }] : [],
});

describe('LiveSession', () => {
  const waitingRun = (approvalStatus: string) => ({
    ...runView('inv-a', approvalStatus === 'pending' ? 'waiting_decision' : 'running'),
    messages: [
      {
        id: 0,
        type: 'tool',
        name: 'exec',
        tool_call_id: 'call-1',
        input: { command: 'echo hi' },
        running: true,
        approval: { approval_id: 'appr-1', status: approvalStatus, can_approve: true },
      },
    ],
  });

  it('approves once; a lost ack is resent with the same control id; the server answer settles it', async () => {
    const { live, socket, snapshot, sockets, hub } = await setup();
    await live.start();
    await flush();
    socket().open();
    snapshot(1, waitingRun('pending'));
    await flush();

    expect(live.respondApproval('appr-1', 'approve')).toBe(true);
    expect(live.respondApproval('appr-1', 'approve')).toBe(false); // already in flight
    const first = socket().sent.find((f) => f.type === 'tool_approval_response')!;
    expect(first).toMatchObject({ run_id: 'r1', session_id: 's1', decision_id: 'appr-1', decision: 'approve' });

    socket().drop();
    await flush();
    expect(live.getSnapshot().controls[0]?.status).toBe('sending');
    hub.wake();
    await flush();
    socket().open();
    await flush();
    const resent = socket().sent.find((f) => f.type === 'tool_approval_response')!;
    expect(resent.control_id).toBe(first.control_id);
    expect(sockets.length).toBe(2);

    socket().emit({ type: 'control_ack', session_id: 's1', control: 'tool_approval_response', control_id: first.control_id, applied: true });
    await flush();
    expect(live.getSnapshot().controls[0]?.status).toBe('applied');
    live.stop();
  });

  it('a question answered on another device closes the local request', async () => {
    const { live, socket, snapshot } = await setup();
    await live.start();
    await flush();
    socket().open();
    const ask = (status: string) => ({
      ...runView('inv-a', 'waiting_decision'),
      messages: [{ id: 0, type: 'tool', name: 'ask_user', user_input: { user_input_id: 'ui-1', status, questions: [{ id: 'q1', text: 'Colour?', kind: 'single_select', options: [{ id: 'o1', label: 'Red' }] }] } }],
    });
    snapshot(1, ask('pending'));
    await flush();
    live.respondUserInput('ui-1', { answers: [{ question_id: 'q1', option_ids: ['o1'] }] });
    expect(socket().sent.find((f) => f.type === 'user_input_response')).toMatchObject({ decision_id: 'ui-1', answers: [{ question_id: 'q1', option_ids: ['o1'] }] });
    socket().emit({ type: 'runtime_delta', session_id: 's1', epoch: 'e1', seq: 2, delta: { current_run_view: ask('submitted') } });
    await flush();
    expect(live.getSnapshot().controls[0]?.status).toBe('stale');
    live.stop();
  });

  it('stop is sent once and reports a run that had already ended', async () => {
    const { live, socket, snapshot } = await setup();
    await live.start();
    await flush();
    socket().open();
    snapshot(1, runView('inv-a', 'running'));
    await flush();
    expect(live.abort()).toBe(true);
    expect(live.abort()).toBe(true);
    const aborts = socket().sent.filter((f) => f.type === 'abort');
    expect(aborts).toHaveLength(1);
    socket().emit({ type: 'control_ack', session_id: 's1', control: 'abort', control_id: aborts[0]!.control_id, applied: false });
    await flush();
    expect(live.getSnapshot().controls[0]?.status).toBe('stale');
    live.stop();
  });
  it('the pump sends a queued message with no screen open, then lets the session go', async () => {
    const { deps, socket, snapshot, rest, access } = await setup();
    const scope = access.state.kind === 'signed_in' ? access.state.session.scope : null!;
    await saveOutboxEntry(db, createOutboxEntry({ invocationId: 'inv-bg', scope, botId: 'bot', sessionId: 's1', payload: { text: 'from the background' }, now: 1 }));
    const pool = new LiveSessionPool(deps, 0);
    const pump = new OutboxPump(deps, pool);
    await pump.kick();
    await flush();
    expect(pool.isHeld('bot', 's1')).toBe(true);
    socket().open();
    snapshot();
    await flush();
    expect(socket().sent.find((f) => f.type === 'message')).toMatchObject({ invocation_id: 'inv-bg', text: 'from the background' });

    socket().emit({ type: 'run_accepted', session_id: 's1', invocation_id: 'inv-bg', run_id: 'r1', turn_id: 't1' });
    socket().emit({ type: 'runtime_delta', session_id: 's1', epoch: 'e1', seq: 2, delta: { current_run_view: runView('inv-bg', 'running') } });
    await flush();
    rest.history.push(
      { turn_id: 't1', turn_position: 1, role: 'user', text: 'from the background', timestamp: 'x', id: 'm1' },
      { turn_id: 't1', turn_position: 1, role: 'assistant', messages: [{ id: 0, type: 'text', content: 'ok' }], timestamp: 'x', id: 'm2' },
    );
    socket().emit({ type: 'runtime_delta', session_id: 's1', epoch: 'e1', seq: 3, delta: { run: { run_id: 'r1', status: 'completed' } } });
    await flush();
    expect((await loadOutboxEntry(db, 'inv-bg'))?.status).toBe('settled');
    expect(pool.isHeld('bot', 's1')).toBe(false);
    pump.stop();
    pool.stopAll();
  });
  it('connects with the token in a header, subscribes, and waits for a snapshot before sending', async () => {
    const { live, socket, snapshot } = await setup();
    await live.start();
    await flush();
    expect(socket().url).toBe('ws://memoh.test/bots/bot/web/ws');
    expect(socket().token).toBe('tok');
    socket().open();
    expect(socket().sent).toContainEqual({ type: 'runtime_subscribe', session_id: 's1' });

    await live.send('  hello  ');
    await flush();
    expect(socket().sent.filter((f) => f.type === 'message')).toHaveLength(0);
    expect(live.getSnapshot().pending[0]).toMatchObject({ status: 'queued', payload: { text: 'hello' } });

    snapshot();
    await flush();
    await live.send('');
    await flush();
    const messages = socket().sent.filter((f) => f.type === 'message');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ session_id: 's1', text: 'hello' });
    live.stop();
  });

  it('sends a retry or an edit of the latest turn as its own frame type (CH-14)', async () => {
    const { live, socket, snapshot } = await setup();
    await live.start();
    await flush();
    socket().open();
    snapshot();
    await flush();
    await live.send('same question', { replace: { kind: 'retry', turnId: 't9' } });
    await flush();
    const retry = socket().sent.find((f) => f.type === 'retry_message');
    expect(retry).toMatchObject({ session_id: 's1', turn_id: 't9' });
    expect(retry).not.toHaveProperty('text');
    expect(socket().sent.filter((f) => f.type === 'message')).toHaveLength(0);
    live.stop();
  });

  it('inlines staged attachments at send time and allows a message with no text (CH-16)', async () => {
    const read = async (a: { name: string }) => (a.name === 'a.png' ? 'QUJD' : 'aGk=');
    const { live, socket, snapshot } = await setup({ lookup: true, readAttachment: read });
    await live.start();
    await flush();
    socket().open();
    snapshot();
    await flush();
    const files = [
      { type: 'image' as const, uri: 'file:///doc/outbox/1/a.png', name: 'a.png', mime: 'image/png', size: 3 },
      { type: 'file' as const, uri: 'file:///doc/outbox/2/n.txt', name: 'n.txt', mime: 'text/plain', size: 2 },
    ];
    await live.send('', { attachments: files });
    await flush();
    const message = socket().sent.find((f) => f.type === 'message');
    expect(message).toMatchObject({
      text: '',
      attachments: [
        { type: 'image', base64: 'data:image/png;base64,QUJD', mime: 'image/png', name: 'a.png', size: 3 },
        { type: 'file', base64: 'data:text/plain;base64,aGk=', mime: 'text/plain', name: 'n.txt', size: 2 },
      ],
    });
    // The durable payload keeps only the file references, never the bytes.
    expect(JSON.stringify(live.getSnapshot().pending[0]?.payload ?? {})).not.toContain('QUJD');
    live.stop();
  });

  it('fails a message whose attachment file is gone instead of sending it without it', async () => {
    const { live, socket, snapshot } = await setup({ lookup: true, readAttachment: async () => Promise.reject(new Error('gone')) });
    await live.start();
    await flush();
    socket().open();
    snapshot();
    await flush();
    await live.send('see file', { attachments: [{ type: 'file', uri: 'file:///x', name: 'x.bin', mime: 'application/octet-stream', size: 1 }] });
    await flush();
    expect(socket().sent.filter((f) => f.type === 'message')).toHaveLength(0);
    expect(live.getSnapshot().failed[0]).toMatchObject({ status: 'failed', lastCode: 'attachment_unreadable' });
    live.stop();
  });

  it('binds model, effort and location to the intent and sends them with it (CH-17/18)', async () => {
    const { live, socket, snapshot } = await setup();
    await live.start();
    await flush();
    socket().open();
    snapshot();
    await flush();
    await live.send('plain');
    await flush();
    await live.send('tuned', { modelId: 'm-1', reasoningEffort: 'high', workspaceTargetId: 'native' });
    const [plain] = socket().sent.filter((f) => f.type === 'message');
    expect(plain).not.toHaveProperty('model_id');
    expect(plain).not.toHaveProperty('workspace_target_id');
    expect(live.getSnapshot().pending.at(-1)?.payload).toEqual({ text: 'tuned', modelId: 'm-1', reasoningEffort: 'high', workspaceTargetId: 'native' });
    live.stop();
  });

  it('streams the run, then settles the send once the turn is in history', async () => {
    const { live, socket, snapshot, rest } = await setup();
    await live.start();
    await flush();
    socket().open();
    snapshot();
    await live.send('hi');
    await flush();
    const inv = String(socket().sent.find((f) => f.type === 'message')!.invocation_id);

    socket().emit({ type: 'run_accepted', session_id: 's1', invocation_id: inv, run_id: 'r1', turn_id: 't1' });
    await flush();
    expect(live.getSnapshot().pending[0]?.status).toBe('accepted');

    socket().emit({ type: 'runtime_delta', session_id: 's1', epoch: 'e1', seq: 2, delta: { current_run_view: runView(inv, 'running') } });
    socket().emit({ type: 'runtime_delta', session_id: 's1', epoch: 'e1', seq: 3, delta: { message_appends: [{ id: 0, type: 'text', content: 'Hel' }] } });
    socket().emit({ type: 'runtime_delta', session_id: 's1', epoch: 'e1', seq: 4, delta: { message_appends: [{ id: 0, type: 'text', content: 'lo!' }] } });
    await flush();
    expect(live.getSnapshot().run?.messages[0]?.content).toBe('Hello!');

    rest.history.push(
      { turn_id: 't1', turn_position: 1, role: 'user', text: 'hi', timestamp: 'x', id: 'm1' },
      { turn_id: 't1', turn_position: 1, role: 'assistant', messages: [{ id: 0, type: 'text', content: 'Hello!' }], timestamp: 'x', id: 'm2' },
    );
    socket().emit({ type: 'runtime_delta', session_id: 's1', epoch: 'e1', seq: 5, delta: { run: { run_id: 'r1', status: 'completed' } } });
    await flush();
    expect(live.getSnapshot().pending).toHaveLength(0);
    expect((await loadOutboxEntry(db, inv))?.status).toBe('settled');
    expect(await loadRecentTurns(db, { scope: live['scope']!, botId: 'bot', sessionId: 's1' })).toHaveLength(2);
    live.stop();
  });

  it('asks the server after a lost ack instead of resending blindly', async () => {
    const { live, socket, snapshot, rest, sockets, tick } = await setup();
    await live.start();
    await flush();
    socket().open();
    snapshot();
    await live.send('once');
    await flush();
    const inv = String(socket().sent.find((f) => f.type === 'message')!.invocation_id);

    // The server admitted it, but the connection died before the ack.
    rest.ledger.set(inv, { run_id: 'r9', turn_id: 't9' });
    socket().drop();
    await flush();
    tick(5_000);
    await live['work']();
    await flush();
    // Settled from the lookup: accepted with the server's run, never resent.
    expect(live.getSnapshot().pending[0]).toMatchObject({ status: 'accepted', runId: 'r9' });
    const allMessages = sockets.flatMap((s) => s.sent).filter((f) => f.type === 'message');
    expect(allMessages).toHaveLength(1);
    live.stop();
  });

  it('on a server without lookup or proven dedup, waits for the user', async () => {
    const { live, socket, snapshot } = await setup({ lookup: false });
    await live.start();
    await flush();
    socket().open();
    snapshot();
    await live.send('maybe');
    await flush();
    socket().drop();
    await flush();
    await live['work']();
    await flush();
    const entry = live.getSnapshot().pending[0]!;
    expect(entry).toMatchObject({ status: 'unconfirmed', needsUser: true });

    await live.discard(entry.invocationId);
    await flush();
    expect(live.getSnapshot().pending).toHaveLength(0);
    live.stop();
  });

  it('backs off on session_busy and fails a conflicting invocation', async () => {
    const { live, socket, snapshot } = await setup();
    await live.start();
    await flush();
    socket().open();
    snapshot();
    await live.send('a');
    await flush();
    const inv = String(socket().sent.find((f) => f.type === 'message')!.invocation_id);
    socket().emit({ type: 'run_rejected', session_id: 's1', invocation_id: inv, code: 'session_busy' });
    await flush();
    expect(live.getSnapshot().pending[0]).toMatchObject({ status: 'queued', lastCode: 'session_busy' });

    socket().emit({ type: 'run_rejected', session_id: 's1', invocation_id: inv, code: 'session_invocation_conflict' });
    await flush();
    // Only a sent/queued entry reacts; it is queued, so it fails permanently.
    expect(live.getSnapshot().failed[0]).toMatchObject({ invocationId: inv, lastCode: 'session_invocation_conflict' });
    live.stop();
  });

  it('restores a queued send after a restart and sends it once live', async () => {
    const first = await setup();
    await first.live.start();
    await first.live.send('survive me');
    first.live.stop();
    await flush();

    const scope = first.access.state.kind === 'signed_in' ? first.access.state.session.scope : null;
    expect((await loadPendingOutbox(db, scope!)).map((e) => e.payload.text)).toEqual(['survive me']);

    const second = new LiveSession(
      { db, access: first.access, sync: new ConversationSync(db, first.access, first.rest.fetchFn, () => 1), hub: new RuntimeHub(first.access, (u, t) => {
        const s = new FakeSocket(u, t);
        first.sockets.push(s);
        return s;
      }), fetchFn: first.rest.fetchFn, now: () => 10_000, newId, tickMs: 60_000 },
      'bot',
      's1',
    );
    await second.start();
    await flush();
    first.socket().open();
    first.snapshot();
    await flush();
    expect(first.socket().sent.filter((f) => f.type === 'message').map((f) => f.text)).toEqual(['survive me']);
    second.stop();
  });

  it('settles a send that finished while the app was away, then sends the next one', async () => {
    const { live, socket, snapshot, rest, access } = await setup();
    const scope = access.state.kind === 'signed_in' ? access.state.session.scope : null;
    // Left behind by a killed process: accepted, and the server has since finished it.
    const { saveOutboxEntry } = await import('../../data/local/outboxStore');
    await saveOutboxEntry(db, {
      invocationId: 'old',
      scope: scope!,
      botId: 'bot',
      sessionId: 's1',
      payload: { text: 'earlier' },
      status: 'accepted',
      attempts: 1,
      nextAttemptAt: 0,
      createdAt: 1,
      updatedAt: 1,
      runId: 'r0',
      turnId: 't0',
    });
    rest.history.push(
      { turn_id: 't0', turn_position: 1, role: 'user', text: 'earlier', timestamp: 'x', id: 'm1' },
      { turn_id: 't0', turn_position: 1, role: 'assistant', messages: [{ id: 0, type: 'text', content: 'done' }], timestamp: 'x', id: 'm2' },
    );
    await live.start();
    await flush();
    socket().open();
    snapshot();
    await flush();
    await live.send('next');
    await flush();
    await live['work']();
    await flush();
    expect((await loadOutboxEntry(db, 'old'))?.status).toBe('settled');
    expect(socket().sent.filter((f) => f.type === 'message').map((f) => f.text)).toEqual(['next']);
    live.stop();
  });

  it('sends abort for the active run', async () => {
    const { live, socket, snapshot } = await setup();
    await live.start();
    await flush();
    socket().open();
    snapshot(1, runView('x', 'running', 'partial'));
    await flush();
    expect(live.abort()).toBe(true);
    expect(socket().sent.at(-1)).toMatchObject({ type: 'abort', run_id: 'r1', session_id: 's1' });
    live.stop();
  });
});
