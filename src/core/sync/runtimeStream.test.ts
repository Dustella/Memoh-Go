import { describe, expect, it } from 'vitest';

import deltas from '../../../contracts/fixtures/runtime-deltas.json';
import history from '../../../contracts/fixtures/history-page.json';
import snapshot from '../../../contracts/fixtures/runtime-snapshot.json';
import type { Turn } from '../conversation/types';
import {
  awaitSnapshot,
  createSessionStream,
  receiveRuntimeEvent,
  type RuntimeEvent,
  type SessionStream,
} from './runtimeStream';

const SESSION = 'sess_0000aaaa';
const snapshotEvent = snapshot as RuntimeEvent;
const deltaEvents = deltas as RuntimeEvent[];

function feed(stream: SessionStream, events: RuntimeEvent[]) {
  const effects: string[] = [];
  let current = stream;
  for (const event of events) {
    const step = receiveRuntimeEvent(current, event);
    current = step.stream;
    effects.push(step.effect);
  }
  return { stream: current, effects };
}

describe('receiveRuntimeEvent', () => {
  it('ignores deltas until a snapshot arrives', () => {
    const { stream, effects } = feed(createSessionStream(SESSION), [deltaEvents[0]!]);
    expect(effects).toEqual(['none']);
    expect(stream.run).toBeNull();
  });

  it('applies the fixture stream and converges on the persisted history turn', () => {
    const { stream, effects } = feed(createSessionStream(SESSION), [snapshotEvent, ...deltaEvents]);
    expect(effects).toEqual(['changed', 'changed', 'changed', 'changed', 'changed', 'changed']);
    expect(stream.seq).toBe(17);
    expect(stream.run?.status).toBe('completed');

    const persisted = (history.items as Turn[]).find(
      (turn) => turn.turn_id === 'turn_2222cccc' && turn.role === 'assistant',
    );
    const strip = (blocks: readonly object[] | undefined) =>
      (blocks ?? []).map((block) => {
        const { progress: _progress, ...rest } = block as { progress?: unknown };
        return rest;
      });
    expect(strip(stream.run?.messages)).toEqual(strip(persisted?.messages));

    // Progress is live-only: the final tool upsert replaces the block wholesale.
    const midStream = feed(createSessionStream(SESSION), [snapshotEvent, ...deltaEvents.slice(0, 3)]).stream;
    expect(midStream.run?.messages[1]?.progress).toHaveLength(1);
    expect(stream.run?.messages[1]?.progress).toBeUndefined();
  });

  it('drops duplicate deltas and resubscribes on a gap', () => {
    const start = feed(createSessionStream(SESSION), [snapshotEvent, deltaEvents[0]!]).stream;
    expect(receiveRuntimeEvent(start, deltaEvents[0]!).effect).toBe('none');
    const gap = receiveRuntimeEvent(start, deltaEvents[2]!);
    expect(gap.effect).toBe('resubscribe');
    expect(gap.stream.live).toBe(false);
  });

  it('resubscribes when the epoch changes and adopts the next snapshot', () => {
    const start = feed(createSessionStream(SESSION), [snapshotEvent]).stream;
    const foreign = { ...deltaEvents[0]!, epoch: 'ep_new' } as RuntimeEvent;
    expect(receiveRuntimeEvent(start, foreign).effect).toBe('resubscribe');

    const fresh = { ...snapshotEvent, epoch: 'ep_new', seq: 1 } as RuntimeEvent;
    const adopted = receiveRuntimeEvent(awaitSnapshot(start), fresh);
    expect(adopted.effect).toBe('changed');
    expect(adopted.stream).toMatchObject({ live: true, epoch: 'ep_new', seq: 1 });
  });

  it('ignores stale snapshots while live but accepts any snapshot after resubscribe', () => {
    const live = feed(createSessionStream(SESSION), [snapshotEvent, deltaEvents[0]!]).stream;
    expect(receiveRuntimeEvent(live, snapshotEvent).effect).toBe('none');
    expect(receiveRuntimeEvent(awaitSnapshot(live), snapshotEvent).effect).toBe('changed');
  });

  it('treats runtime_dropped as a resubscribe request', () => {
    const live = feed(createSessionStream(SESSION), [snapshotEvent]).stream;
    const step = receiveRuntimeEvent(live, {
      type: 'runtime_dropped',
      session_id: SESSION,
      epoch: 'ep_7f3c',
      seq: 13,
    });
    expect(step.effect).toBe('resubscribe');
  });

  it('ignores events for other sessions', () => {
    const other = { ...snapshotEvent, session_id: 'sess_other' } as RuntimeEvent;
    expect(receiveRuntimeEvent(createSessionStream(SESSION), other).effect).toBe('none');
  });
});
