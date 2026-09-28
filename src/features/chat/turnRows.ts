import { isRunActive, type Block, type RunView, type Turn } from '../../core/conversation/types';
import { splitBlocks } from '../../ui/markdown/blocks';

/**
 * One virtualised row. Assistant text is split into Markdown blocks so long
 * answers virtualise block by block (docs/10-render-benchmark.md); tool,
 * reasoning and other non-text blocks become compact rows of their own.
 */
export type ChatRow =
  | Readonly<{ kind: 'edge'; key: string; turnId: ''; state: 'beginning' | 'loading' | 'more' }>
  | Readonly<{ kind: 'working'; key: string; turnId: string; status: string }>
  | Readonly<{ kind: 'pending'; key: string; turnId: ''; invocationId: string; text: string; state: 'sending' | 'unsure' | 'failed' }>
  | Readonly<{ kind: 'user'; key: string; turnId: string; text: string; attachments: number }>
  | Readonly<{ kind: 'markdown'; key: string; turnId: string; source: string; first: boolean }>
  | Readonly<{ kind: 'reasoning'; key: string; turnId: string; text: string; durationMs?: number; first: boolean }>
  | Readonly<{ kind: 'tool'; key: string; turnId: string; name: string; state: 'running' | 'done' | 'failed' | 'awaiting'; first: boolean }>
  | Readonly<{ kind: 'attachments'; key: string; turnId: string; count: number; first: boolean }>
  | Readonly<{ kind: 'notice'; key: string; turnId: string; text: string; tone: 'error' | 'info'; first: boolean }>;

function toolState(block: Block): 'running' | 'done' | 'failed' | 'awaiting' {
  if (block.approval && block.approval.status === 'pending') return 'awaiting';
  if (block.user_input && block.user_input.status === 'pending') return 'awaiting';
  if (block.running) return 'running';
  const output = block.output as { error?: unknown; is_error?: unknown } | undefined;
  if (output && (output.error || output.is_error === true)) return 'failed';
  return 'done';
}

function blockRows(turnId: string, block: Block, first: boolean): ChatRow[] {
  const base = `${turnId}:a:${block.id}`;
  switch (block.type) {
    case 'text': {
      const split = splitBlocks(block.content ?? '');
      return split.blocks.map((md, i) => ({
        kind: 'markdown',
        key: `${base}:${md.key}`,
        turnId,
        source: md.source,
        first: first && i === 0,
      }));
    }
    case 'reasoning':
      if (!block.content?.trim()) return [];
      return [
        {
          kind: 'reasoning',
          key: base,
          turnId,
          text: block.content,
          durationMs: block.reasoning_timing?.duration_ms,
          first,
        },
      ];
    case 'tool':
      return [{ kind: 'tool', key: base, turnId, name: block.name || 'tool', state: toolState(block), first }];
    case 'attachments':
      return block.attachments?.length
        ? [{ kind: 'attachments', key: base, turnId, count: block.attachments.length, first }]
        : [];
    case 'error':
      return [{ kind: 'notice', key: base, turnId, text: block.content || block.code || '出错了', tone: 'error', first }];
    case 'notice':
      return block.content ? [{ kind: 'notice', key: base, turnId, text: block.content, tone: 'info', first }] : [];
    default:
      return [];
  }
}

export function turnRows(turn: Turn): ChatRow[] {
  if (turn.role === 'user') {
    return [
      {
        kind: 'user',
        key: `${turn.turn_id}:u`,
        turnId: turn.turn_id,
        text: turn.text ?? '',
        attachments: turn.attachments?.length ?? 0,
      },
    ];
  }
  const rows: ChatRow[] = [];
  for (const block of turn.messages ?? []) rows.push(...blockRows(turn.turn_id, block, rows.length === 0));
  return rows;
}

export function historyRows(turns: readonly Turn[]): ChatRow[] {
  return turns.flatMap(turnRows);
}

export type PendingSend = Readonly<{
  invocationId: string;
  text: string;
  turnId?: string;
  /** sending: queued/sent · unsure: lost ack, user must decide · failed: rejected. */
  state: 'sending' | 'unsure' | 'failed';
}>;

export type ComposeInput = Readonly<{
  history: readonly Turn[];
  run: RunView | null;
  pending: readonly PendingSend[];
}>;

/**
 * History, then the live run if its turn is not persisted yet, then sends
 * the server has not attached to any visible turn. A turn is never shown
 * twice: once history contains it, the live copy and the pending bubble go.
 */
export function composeRows({ history, run, pending }: ComposeInput): ChatRow[] {
  const rows = historyRows(history);
  const persisted = new Set(history.map((t) => t.turn_id));
  const liveTurn = run && !persisted.has(run.turn_id) ? run : null;

  if (liveTurn) {
    const mine = pending.find((p) => p.turnId === liveTurn.turn_id);
    const userTurn = liveTurn.user_turns?.find((t) => t.turn_id === liveTurn.turn_id) ?? liveTurn.user_turns?.[0];
    const text = userTurn?.text ?? mine?.text;
    if (text !== undefined) rows.push({ kind: 'user', key: `${liveTurn.turn_id}:u`, turnId: liveTurn.turn_id, text, attachments: 0 });
    rows.push(...turnRows({ turn_id: liveTurn.turn_id, role: 'assistant', timestamp: '', messages: liveTurn.messages }));
    if (isRunActive(liveTurn.status)) rows.push({ kind: 'working', key: `${liveTurn.turn_id}:w`, turnId: liveTurn.turn_id, status: liveTurn.status });
    else if (liveTurn.status === 'aborted') rows.push({ kind: 'notice', key: `${liveTurn.turn_id}:x`, turnId: liveTurn.turn_id, text: '已停止', tone: 'info', first: false });
    else if (liveTurn.status === 'errored' || liveTurn.status === 'lost') {
      rows.push({ kind: 'notice', key: `${liveTurn.turn_id}:x`, turnId: liveTurn.turn_id, text: liveTurn.error || '这一轮没有完成', tone: 'error', first: false });
    }
  }

  for (const p of pending) {
    if (p.turnId && (persisted.has(p.turnId) || p.turnId === liveTurn?.turn_id)) continue;
    rows.push({ kind: 'pending', key: `p:${p.invocationId}`, turnId: '', invocationId: p.invocationId, text: p.text, state: p.state });
  }
  return rows;
}
