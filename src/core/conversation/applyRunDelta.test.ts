import { describe, expect, it } from 'vitest';

import { applyRunDelta } from './applyRunDelta';
import type { RunView } from './types';

const base: RunView = {
  run_id: 'run_1',
  turn_id: 'turn_1',
  status: 'running',
  started_at: '2026-09-28T00:00:00Z',
  updated_at: '2026-09-28T00:00:00Z',
  messages: [
    { id: 0, type: 'text', content: 'Hello' },
    { id: 1, type: 'tool', name: 'x', tool_call_id: 'call_1', running: true },
  ],
};

describe('applyRunDelta', () => {
  it('returns null without a run view to patch', () => {
    expect(applyRunDelta(null, { message_appends: [{ id: 0, type: 'text', content: 'x' }] })).toBeNull();
  });

  it('keeps identity of untouched blocks and does not mutate the input', () => {
    const next = applyRunDelta(base, { message_appends: [{ id: 0, type: 'text', content: ', world' }] })!;
    expect(next.messages[0]?.content).toBe('Hello, world');
    expect(next.messages[1]).toBe(base.messages[1]);
    expect(base.messages[0]?.content).toBe('Hello');
  });

  it('matches upserted tool blocks by tool_call_id and preserves the original id', () => {
    const next = applyRunDelta(base, {
      message_upserts: [{ id: 7, type: 'tool', name: 'x', tool_call_id: 'call_1', running: false }],
    })!;
    expect(next.messages).toHaveLength(2);
    expect(next.messages[1]).toMatchObject({ id: 1, running: false });
  });

  it('ignores a run patch for another run and applies reset_messages', () => {
    const next = applyRunDelta(base, {
      run: { run_id: 'run_other', status: 'completed' },
      reset_messages: true,
      message_appends: [{ id: 3, type: 'text', content: 'fresh' }],
    })!;
    expect(next.status).toBe('running');
    expect(next.messages).toEqual([{ id: 3, type: 'text', content: 'fresh' }]);
  });

  it('upserts and removes steer turns by item id', () => {
    const withSteer = applyRunDelta(base, {
      steer_turn_upserts: [
        { item_id: 's1', status: 'claimed', text: 'also check tests', after_message_id: 0, timestamp: 't' },
      ],
    })!;
    expect(withSteer.steer_turns).toHaveLength(1);
    const removed = applyRunDelta(withSteer, { steer_turn_removals: ['s1'] })!;
    expect(removed.steer_turns).toHaveLength(0);
  });
});
