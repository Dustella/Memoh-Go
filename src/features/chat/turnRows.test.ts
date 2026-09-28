import { describe, expect, it } from 'vitest';

import capturedHistory from '../../../contracts/fixtures/captured/markdown-turn.history.json';
import history from '../../../contracts/fixtures/history-page.json';
import type { Turn } from '../../core/conversation/types';
import { historyRows, turnRows } from './turnRows';

describe('turnRows', () => {
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
