import { describe, expect, it } from 'vitest';

import capturedHistory from '../../../contracts/fixtures/captured/markdown-turn.history.json';
import history from '../../../contracts/fixtures/history-page.json';
import type { Turn } from '../../core/conversation/types';
import { composeRows, copyChoices, historyRows, turnRows, type ChatRow } from './turnRows';

describe('turnRows', () => {
  it('live pending decisions are interactive and carry their control state; history ones are not', () => {
    const run = {
      run_id: 'r1',
      turn_id: 'live',
      status: 'waiting_decision',
      started_at: 'a',
      updated_at: 'b',
      messages: [
        { id: 0, type: 'tool' as const, name: 'exec', input: { command: 'ls -la' }, approval: { approval_id: 'ap', status: 'pending' } },
        { id: 1, type: 'tool' as const, name: 'ask_user', user_input: { user_input_id: 'ui', status: 'pending', questions: [] } },
      ],
    };
    const controls = new Map([['ap', { status: 'sent' as const }]]);
    const rows = composeRows({ history: [], run, pending: [], controls });
    const tool = rows.find((r) => r.kind === 'tool');
    expect(tool).toMatchObject({ interactive: true, summary: 'ls -la', control: { status: 'sent' } });
    expect(rows.find((r) => r.kind === 'question')).toMatchObject({ interactive: true, request: { user_input_id: 'ui' } });

    const stopping = composeRows({ history: [], run, pending: [], controls, stopping: true });
    expect(stopping.find((r) => r.kind === 'tool')).toMatchObject({ interactive: false });
    expect(stopping.find((r) => r.kind === 'working')).toMatchObject({ stopping: true });

    const persisted = turnRows({ turn_id: 'old', role: 'assistant', timestamp: 'x', messages: run.messages });
    expect(persisted.every((r) => !('interactive' in r) || r.interactive === false)).toBe(true);
  });
  it('maps a real captured turn to a user bubble and one markdown row', () => {
    const rows = historyRows((capturedHistory as { items: Turn[] }).items);
    expect(rows.map((r) => r.kind)).toEqual(['user', 'markdown']);
    expect(rows[1]).toMatchObject({ first: true, source: '- 🔴 Red\n- 🌊 Blue\n- 🌿 Green' });
  });

  it('splits long text into blocks with stable keys and keeps non-text blocks', () => {
    const turn: Turn = {
      turn_id: 't',
      role: 'assistant',
      timestamp: 'x',
      messages: [
        { id: 0, type: 'reasoning', content: 'thinking', reasoning_timing: { duration_ms: 1200 } },
        { id: 1, type: 'tool', name: 'shell', tool_call_id: 'c', running: false, output: { is_error: true } },
        { id: 2, type: 'text', content: '# Title\n\nPara one\n\n```js\na\n\nb\n```' },
        { id: 3, type: 'tool', name: 'x', approval: { approval_id: 'a', status: 'pending' } },
        { id: 4, type: 'error', code: 'model_error' },
        { id: 5, type: 'reasoning', content: '  ' },
      ],
    };
    const rows = turnRows(turn);
    expect(rows.map((r) => `${r.kind}${'first' in r && r.first ? '*' : ''}`)).toEqual([
      'reasoning*',
      'tool',
      'markdown',
      'markdown',
      'markdown',
      'tool',
      'notice',
    ]);
    expect(rows[1]).toMatchObject({ state: 'failed' });
    expect(rows[5]).toMatchObject({ state: 'awaiting' });
    expect(rows[4]).toMatchObject({ source: '```js\na\n\nb\n```' });
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(turnRows(turn).map((r) => r.key)).toEqual(rows.map((r) => r.key));
  });

  it('handles the derived fixture page with tools', () => {
    const rows = historyRows((history as { items: Turn[] }).items);
    expect(rows.filter((r) => r.kind === 'user')).toHaveLength(2);
    expect(rows.some((r) => r.kind === 'tool')).toBe(true);
  });
});


describe('composeRows', () => {
  const persisted: Turn[] = [
    { turn_id: 't1', turn_position: 1, role: 'user', text: 'q1', timestamp: 'x', id: 'm1' },
    { turn_id: 't1', turn_position: 1, role: 'assistant', messages: [{ id: 0, type: 'text', content: 'a1' }], timestamp: 'x', id: 'm2' },
  ];
  const run = (status: string, turnId = 't2') => ({
    run_id: 'r2',
    turn_id: turnId,
    status,
    started_at: 's',
    updated_at: 'u',
    messages: [{ id: 0, type: 'text' as const, content: 'streaming' }],
    user_turns: [{ turn_id: turnId, role: 'user' as const, text: 'q2', timestamp: 'x' }],
  });
  const kinds = (rows: ReturnType<typeof composeRows>) => rows.map((r) => r.kind);

  it('appends the running turn with a working indicator', () => {
    const rows = composeRows({ history: persisted, run: run('running'), pending: [] });
    expect(kinds(rows)).toEqual(['user', 'markdown', 'user', 'markdown', 'working']);
  });

  it('never shows a turn twice once history has it', () => {
    const rows = composeRows({
      history: persisted,
      run: run('completed', 't1'),
      pending: [{ invocationId: 'i', text: 'q1', turnId: 't1', state: 'sending' }],
    });
    expect(kinds(rows)).toEqual(['user', 'markdown']);
  });

  it('shows unattached sends as pending bubbles and merges an accepted one into its live turn', () => {
    const rows = composeRows({
      history: persisted,
      run: run('running'),
      pending: [
        { invocationId: 'a', text: 'q2', turnId: 't2', state: 'sending' },
        { invocationId: 'b', text: 'next', state: 'unsure' },
      ],
    });
    expect(kinds(rows)).toEqual(['user', 'markdown', 'user', 'markdown', 'working', 'pending']);
    expect(rows.at(-1)).toMatchObject({ text: 'next', state: 'unsure' });
  });

  it('places steer messages after the block the run took them at, and shows a steer turn only once', () => {
    const live = {
      ...run('running'),
      messages: [
        { id: 1, type: 'text' as const, content: 'part one' },
        { id: 2, type: 'text' as const, content: 'part two' },
      ],
      steer_turns: [
        { item_id: 'st1', status: 'applied' as const, text: 'keep it short', turn_id: 't3', after_message_id: 1, timestamp: 'x' },
        { item_id: 'st0', status: 'claimed' as const, text: 'early', after_message_id: 0, timestamp: 'x' },
      ],
      user_turns: [
        { turn_id: 't2', role: 'user' as const, text: 'q2', timestamp: 'x' },
        { turn_id: 't3', role: 'user' as const, text: 'keep it short', timestamp: 'x' },
      ],
    };
    const rows = composeRows({ history: [], run: live, pending: [] });
    expect(rows.map((r) => (r.kind === 'user' ? `u:${r.text}${r.steer ? '*' : ''}` : r.kind === 'markdown' ? `m:${r.source.trim()}` : r.kind))).toEqual([
      'u:q2',
      'u:early*',
      'm:part one',
      'u:keep it short*',
      'm:part two',
      'working',
    ]);
  });

  it('hides the turn a retry replaces and shows its user text once (CH-14)', () => {
    const saved: Turn[] = [
      ...persisted,
      { turn_id: 't9', turn_position: 2, role: 'user', text: 'q9', timestamp: 'x', id: 'mu9' },
      { turn_id: 't9', turn_position: 2, role: 'assistant', messages: [{ id: 0, type: 'text', content: 'old answer' }], timestamp: 'x', id: 'ma9' },
    ];
    const retry = { ...run('running', 't10'), user_turns: [], operation: { kind: 'retry', replace_from_message_id: 'ma9' } };
    const rows = composeRows({ history: saved, run: retry, pending: [] });
    expect(rows.map((r) => (r.kind === 'user' ? `u:${r.text}` : r.kind === 'markdown' ? `m:${r.source.trim()}` : r.kind))).toEqual([
      'u:q1',
      'm:a1',
      'u:q9',
      'm:streaming',
      'working',
    ]);
    // Once the new turn is saved, history alone is shown.
    const done = [...persisted, { turn_id: 't10', turn_position: 3, role: 'user' as const, text: 'q9', timestamp: 'x', id: 'mu9' }];
    expect(composeRows({ history: done, run: { ...retry, status: 'completed' }, pending: [] }).map((r) => r.kind)).toEqual(['user', 'markdown', 'user']);
  });

  it('shows the edited text for an edit run', () => {
    const saved: Turn[] = [...persisted];
    const edit = { ...run('running', 't10'), user_turns: [], operation: { kind: 'edit', replace_from_message_id: 'm1', replacement_user_turn: { turn_id: 't10', role: 'user' as const, text: 'q1 fixed', timestamp: 'x' } } };
    const rows = composeRows({ history: saved, run: edit, pending: [] });
    expect(rows.map((r) => (r.kind === 'user' ? `u:${r.text}` : r.kind))).toEqual(['u:q1 fixed', 'markdown', 'working']);
  });

  it('marks stopped and failed runs', () => {
    expect(composeRows({ history: [], run: run('aborted'), pending: [] }).at(-1)).toMatchObject({ kind: 'notice', text: '已停止' });
    expect(composeRows({ history: [], run: { ...run('errored'), error: 'model down' }, pending: [] }).at(-1)).toMatchObject({
      tone: 'error',
      text: 'model down',
    });
  });
});

describe('copyChoices (CH-12)', () => {
  const md = (key: string, turnId: string, source: string): ChatRow => ({ kind: 'markdown', key, turnId, source, first: false });
  const rows: ChatRow[] = [
    { kind: 'user', key: 'u', turnId: 't1', text: 'hi', attachments: 0 },
    md('a', 't1', '# Title\n'),
    md('b', 't1', 'Body para.\n'),
    md('c', 't2', 'Other turn'),
  ];

  it('copies a user message as is', () => {
    expect(copyChoices(rows, rows[0]!)).toEqual([{ label: '复制', text: 'hi' }]);
  });

  it('offers the whole reply of the same turn and the single block', () => {
    expect(copyChoices(rows, rows[2]!)).toEqual([
      { label: '复制整条回复', text: '# Title\n\nBody para.' },
      { label: '复制本段', text: 'Body para.' },
    ]);
  });

  it('collapses to one choice when the reply is a single block', () => {
    expect(copyChoices(rows, rows[3]!)).toEqual([{ label: '复制回复', text: 'Other turn' }]);
  });

  it('offers nothing for structural rows', () => {
    expect(copyChoices(rows, { kind: 'edge', key: 'e', turnId: '', state: 'beginning' })).toEqual([]);
  });
});

describe('attachment rows (CH-15)', () => {
  it('keeps names and workspace paths from both attachment shapes', () => {
    const rows = turnRows({
      turn_id: 't',
      role: 'assistant',
      timestamp: 'x',
      messages: [
        {
          id: 0,
          type: 'attachments',
          attachments: [
            { type: 'file', name: 'report.md', path: '/data/reports/weekly.md' },
            { type: 'image', file_name: 'chart.png', file_path: '/data/reports/chart.png' } as never,
            { type: 'audio' },
          ],
        },
      ],
    });
    expect(rows[0]).toMatchObject({
      kind: 'attachments',
      count: 3,
      items: [
        { name: 'report.md', path: '/data/reports/weekly.md', type: 'file' },
        { name: 'chart.png', path: '/data/reports/chart.png', type: 'image' },
        { name: 'audio', path: undefined, type: 'audio' },
      ],
    });
  });
});
