import { applyRunDelta } from '../conversation/applyRunDelta';
import type { RunView, RuntimeDelta, RuntimeSnapshot } from '../conversation/types';

export type RuntimeEvent =
  | Readonly<{ type: 'runtime_snapshot'; session_id: string; epoch: string; seq: number; snapshot: RuntimeSnapshot }>
  | Readonly<{ type: 'runtime_delta'; session_id: string; epoch: string; seq: number; delta: RuntimeDelta }>
  | Readonly<{ type: 'runtime_dropped'; session_id: string; epoch: string; seq: number; message?: string }>;

/** Live projection of one session's runtime, gated by (epoch, seq). */
export type SessionStream = Readonly<{
  sessionId: string;
  /** False until a snapshot has been adopted since the last (re)subscribe. */
  live: boolean;
  epoch: string;
  seq: number;
  run: RunView | null;
}>;

export type StreamStep = Readonly<{
  stream: SessionStream;
  /** `changed`: run view updated. `resubscribe`: send runtime_subscribe again and wait for a snapshot. */
  effect: 'none' | 'changed' | 'resubscribe';
}>;

export function createSessionStream(sessionId: string): SessionStream {
  return { sessionId, live: false, epoch: '', seq: 0, run: null };
}

/** Call when (re)subscribing: deltas are ignored until the next snapshot. */
export function awaitSnapshot(stream: SessionStream): SessionStream {
  return { ...stream, live: false };
}

/**
 * Reduce one runtime event. Rules (contracts/runtime-ws.md#epoch--seq-规则):
 * snapshots replace state unless stale; deltas must be strictly contiguous
 * within the same epoch; anything else asks for a fresh snapshot.
 */
export function receiveRuntimeEvent(stream: SessionStream, event: RuntimeEvent): StreamStep {
  if (event.session_id.trim() !== stream.sessionId) return { stream, effect: 'none' };

  switch (event.type) {
    case 'runtime_dropped':
      return { stream: awaitSnapshot(stream), effect: 'resubscribe' };

    case 'runtime_snapshot': {
      if (stream.live && stream.epoch === event.epoch && event.seq <= stream.seq) {
        return { stream, effect: 'none' };
      }
      return {
        stream: {
          sessionId: stream.sessionId,
          live: true,
          epoch: event.epoch,
          seq: event.seq,
          run: event.snapshot.current_run_view ?? null,
        },
        effect: 'changed',
      };
    }

    case 'runtime_delta': {
      if (!stream.live) return { stream, effect: 'none' };
      if (event.epoch !== stream.epoch) {
        return { stream: awaitSnapshot(stream), effect: 'resubscribe' };
      }
      if (event.seq <= stream.seq) return { stream, effect: 'none' };
      if (event.seq !== stream.seq + 1) {
        return { stream: awaitSnapshot(stream), effect: 'resubscribe' };
      }
      return {
        stream: { ...stream, seq: event.seq, run: applyRunDelta(stream.run, event.delta) },
        effect: 'changed',
      };
    }
  }
}
