import { EMPTY_SPLIT, updateBlocks, type BlockSplit } from '../../ui/markdown/blocks';
import { rowsForTurn, type ChatRow } from './scenarios';

type Listener = () => void;

/**
 * Minimal external store that receives many small text increments and
 * publishes rows at most once per flush window. Stable blocks keep their row
 * object identity, so memoised rows skip re-rendering.
 */
export class StreamingRowsStore {
  private history: ChatRow[] = [];
  private streaming: ChatRow[] = [];
  private split: BlockSplit = EMPTY_SPLIT;
  private pending = '';
  private pendingSince: number[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private snapshot: ChatRow[] = [];
  /** enqueue → publish timestamps per flush, consumed by the latency probe. */
  readonly flushes: { enqueuedAt: number; publishedAt: number }[] = [];

  constructor(private readonly flushWindowMs: number) {}

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  setHistory(rows: ChatRow[]) {
    this.history = rows;
    this.publish();
  }

  prependHistory(rows: ChatRow[]) {
    this.history = [...rows, ...this.history];
    this.publish();
  }

  startStreamingTurn(turnId: string) {
    this.split = EMPTY_SPLIT;
    this.streamTurnId = turnId;
    this.streaming = [];
  }

  append(text: string) {
    this.pending += text;
    this.pendingSince.push(performance.now());
    if (!this.timer) this.timer = setTimeout(this.flush, this.flushWindowMs);
  }

  private streamTurnId = '';

  private flush = () => {
    this.timer = null;
    if (!this.pending) return;
    const enqueuedAt = this.pendingSince[0] ?? performance.now();
    this.split = updateBlocks(this.split, this.split.source + this.pending);
    this.pending = '';
    this.pendingSince = [];

    const nextRows = rowsForTurn(this.streamTurnId, 'assistant', this.split);
    // Reuse row objects whose block source did not change.
    this.streaming = nextRows.map((row, index) => {
      const previous = this.streaming[index];
      return previous && previous.key === row.key && previous.source === row.source ? previous : row;
    });
    this.publish();
    this.flushes.push({ enqueuedAt, publishedAt: performance.now() });
  };

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }

  private publish() {
    this.snapshot = this.streaming.length > 0 ? [...this.history, ...this.streaming] : this.history;
    for (const listener of this.listeners) listener();
  }
}
