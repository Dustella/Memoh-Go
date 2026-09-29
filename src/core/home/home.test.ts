import { describe, expect, it } from 'vitest';

import type { RunView } from '../conversation/types';
import { buildHome, homeKey, pickWatchSet, summarizeRun, type HomeInput, type HomeSession, type RunSummary } from './home';

const T = (min: number) => new Date(Date.UTC(2026, 8, 29, 2, min)).toISOString();
const ms = (min: number) => Date.parse(T(min));

const session = (id: string, min: number, botId = 'b1'): HomeSession => ({
  botId,
  botName: botId,
  sessionId: id,
  title: id,
  updatedAt: T(min),
});
const run = (status: string, decision: RunSummary['decision'] = null, min = 0): RunSummary => ({
  status,
  decision,
  updatedAt: T(min),
  observedAt: ms(min),
});

function input(patch: Partial<HomeInput>): HomeInput {
  return { sessions: [], runs: new Map(), liveKeys: new Set(), outbox: new Map(), seen: new Map(), baseline: 0, ...patch };
}

const ids = (items: readonly { sessionId: string }[]) => items.map((i) => i.sessionId);

describe('summarizeRun', () => {
  const view = (status: string, messages: RunView['messages']): RunView => ({
    run_id: 'r',
    turn_id: 't',
    status,
    started_at: T(0),
    updated_at: T(1),
    messages,
  });

  it('reports a pending approval ahead of a question, only on active runs', () => {
    const blocks = [
      { id: 0, type: 'tool', user_input: { user_input_id: 'q', status: 'pending' } },
      { id: 1, type: 'tool', approval: { approval_id: 'a', status: 'pending' } },
    ] as RunView['messages'];
    expect(summarizeRun(view('waiting_decision', blocks), 5).decision).toBe('approval');
    expect(summarizeRun(view('completed', blocks), 5).decision).toBeNull();
  });

  it('ignores decisions the user cannot act on', () => {
    const blocks = [{ id: 0, type: 'tool', approval: { approval_id: 'a', status: 'pending', can_approve: false } }] as RunView['messages'];
    expect(summarizeRun(view('waiting_decision', blocks), 5).decision).toBeNull();
  });
});

describe('buildHome (HM-02..HM-04)', () => {
  it('puts each session in exactly one section, most urgent first', () => {
    const k = (id: string) => homeKey('b1', id);
    const sections = buildHome(
      input({
        sessions: [session('ask', 10), session('run', 9), session('fresh', 8), session('old', 1), session('sendfail', 2)],
        runs: new Map([
          [k('ask'), run('waiting_decision', 'question')],
          [k('run'), run('running')],
          [k('fresh'), run('completed')],
        ]),
        outbox: new Map([[k('sendfail'), { failed: 1, unsure: 0, queued: 0 }]]),
        seen: new Map([
          [k('fresh'), ms(5)],
          [k('old'), ms(3)],
        ]),
      }),
    );
    expect(ids(sections.needsYou)).toEqual(['ask', 'sendfail']);
    expect(sections.needsYou.map((i) => i.reason)).toEqual(['question', 'send_failed']);
    expect(ids(sections.running)).toEqual(['run']);
    expect(sections.running[0]!.phase).toBe('running');
    expect(ids(sections.newResults)).toEqual(['fresh']);
    expect(ids(sections.recent)).toEqual(['old']);
  });

  it('never calls activity before the device baseline "new"', () => {
    const sections = buildHome(input({ sessions: [session('web', 4)], baseline: ms(6) }));
    expect(ids(sections.newResults)).toEqual([]);
    expect(ids(sections.recent)).toEqual(['web']);
  });

  it('shows a failed run until the user has opened the session after it', () => {
    const k = homeKey('b1', 'x');
    const base = { sessions: [session('x', 7)], runs: new Map([[k, run('errored', null, 7)]]) };
    expect(buildHome(input({ ...base, seen: new Map([[k, ms(6)]]) })).needsYou[0]?.reason).toBe('run_failed');
    expect(buildHome(input({ ...base, seen: new Map([[k, ms(8)]]) })).needsYou).toEqual([]);
  });

  it('marks run state from a saved copy as cached', () => {
    const k = homeKey('b1', 'x');
    const runs = new Map([[k, run('running')]]);
    expect(buildHome(input({ sessions: [session('x', 1)], runs })).running[0]!.cached).toBe(true);
    expect(buildHome(input({ sessions: [session('x', 1)], runs, liveKeys: new Set([k]) })).running[0]!.cached).toBe(false);
  });

  it('offers the last opened session to continue, unless it is already urgent (HM-01)', () => {
    const k = (id: string) => homeKey('b1', id);
    const sessions = [session('a', 10), session('b', 9)];
    const seen = new Map([
      [k('a'), ms(11)],
      [k('b'), ms(20)],
    ]);
    const calm = buildHome(input({ sessions, seen }));
    expect(calm.continueWith?.sessionId).toBe('b');
    expect(ids(calm.recent)).toEqual(['a']);

    const urgent = buildHome(input({ sessions, seen, runs: new Map([[k('b'), run('running')]]) }));
    expect(urgent.continueWith).toBeNull();
    expect(ids(urgent.running)).toEqual(['b']);

    // Replied to after it was last opened: it is a new result, not listed twice.
    const replied = buildHome(input({ sessions: [session('a', 10), session('b', 25)], seen }));
    expect(replied.continueWith).toBeNull();
    expect(ids(replied.newResults)).toEqual(['b']);
  });

  it('caps the recent section', () => {
    const sessions = Array.from({ length: 15 }, (_, i) => session(`s${i}`, i));
    expect(buildHome(input({ sessions, baseline: ms(59), recentLimit: 5 })).recent).toHaveLength(5);
  });
});

describe('pickWatchSet (U6 fallback)', () => {
  it('watches active and unsent sessions first, then recent ones, under the cap', () => {
    const sessions = [session('a', 50), session('b', 40), session('c', 30), session('old-run', 1), session('old', 0)];
    const keys = pickWatchSet({
      sessions,
      runs: new Map([[homeKey('b1', 'old-run'), run('running')]]),
      outbox: new Map([[homeKey('b1', 'old'), { failed: 0, unsure: 0, queued: 1 }]]),
      now: ms(55),
      limit: 4,
      windowMs: 20 * 60_000,
    });
    expect(keys).toEqual([homeKey('b1', 'old-run'), homeKey('b1', 'old'), homeKey('b1', 'a'), homeKey('b1', 'b')]);
  });
});
