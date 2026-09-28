import { describe, expect, it } from 'vitest';

// Recorded from a real Memoh dev server (see contracts/fixtures/README.md), not hand-written.
import capturedFrames from '../../../contracts/fixtures/captured/markdown-turn.frames.json';
import capturedHistory from '../../../contracts/fixtures/captured/markdown-turn.history.json';
import type { Turn } from '../conversation/types';
import { createSessionStream, receiveRuntimeEvent, type RuntimeEvent } from './runtimeStream';

const frames = capturedFrames as { type: string; session_id: string }[];
const history = capturedHistory as { items: Turn[] };

const RUNTIME_TYPES = new Set(['runtime_snapshot', 'runtime_delta', 'runtime_dropped']);

describe('captured server stream', () => {
  const sessionId = frames[0]!.session_id;
  const runtime = frames.filter((f) => RUNTIME_TYPES.has(f.type)) as unknown as RuntimeEvent[];

  function replay(events: RuntimeEvent[]) {
    let stream = createSessionStream(sessionId);
    const effects: string[] = [];
    for (const event of events) {
      const step = receiveRuntimeEvent(stream, event);
      stream = step.stream;
      effects.push(step.effect);
    }
    return { stream, effects };
  }

  it('applies every frame in order without asking to resubscribe', () => {
    const { effects } = replay(runtime);
    expect(effects).not.toContain('resubscribe');
    expect(effects.filter((e) => e === 'changed')).toHaveLength(runtime.length);
  });

  it('converges on the assistant turn the server persisted to history', () => {
    const { stream } = replay(runtime);
    expect(stream.run?.status).toBe('completed');

    const persisted = history.items.find((t) => t.turn_id === stream.run?.turn_id && t.role === 'assistant');
    expect(persisted).toBeDefined();
    const text = (blocks: readonly { type: string; content?: string }[] | undefined) =>
      (blocks ?? []).filter((b) => b.type === 'text').map((b) => b.content ?? '');
    expect(text(persisted?.messages).join('')).toMatch(/\S/);
    expect(text(stream.run?.messages)).toEqual(text(persisted?.messages));
  });

  it('recovers from a dropped delta by requesting a fresh snapshot', () => {
    const gapAt = runtime.findIndex((e, i) => i > 1 && e.type === 'runtime_delta');
    const { effects } = replay([...runtime.slice(0, gapAt), ...runtime.slice(gapAt + 1)]);
    expect(effects[gapAt]).toBe('resubscribe');
  });
});
