import { isRunActive, type Block, type RunView, type ToolApproval, type Turn, type UserInputRequest } from '../../core/conversation/types';
import type { ControlStatus } from '../../core/operations/controls';
import { splitBlocks } from '../../ui/markdown/blocks';

/** State of the local request answering a decision, if any. */
export type ControlView = Readonly<{ status: ControlStatus; code?: string }>;

/**
 * One virtualised row. Assistant text is split into Markdown blocks so long
 * answers virtualise block by block (docs/10-render-benchmark.md); tool,
 * reasoning and other non-text blocks become compact rows of their own.
 */
export type ChatRow =
  | Readonly<{ kind: 'edge'; key: string; turnId: ''; state: 'beginning' | 'loading' | 'more' }>
  | Readonly<{ kind: 'working'; key: string; turnId: string; status: string; stopping: boolean }>
  | Readonly<{ kind: 'pending'; key: string; turnId: ''; invocationId: string; text: string; state: 'sending' | 'unsure' | 'failed' }>
  | Readonly<{ kind: 'user'; key: string; turnId: string; text: string; attachments: number }>
  | Readonly<{ kind: 'markdown'; key: string; turnId: string; source: string; first: boolean }>
  | Readonly<{ kind: 'reasoning'; key: string; turnId: string; text: string; durationMs?: number; first: boolean }>
  | Readonly<{
      kind: 'tool';
      key: string;
      turnId: string;
      name: string;
      state: 'running' | 'done' | 'failed' | 'awaiting';
      first: boolean;
      /** One-line summary of the call (e.g. the command), when there is one. */
      summary?: string;
      input?: string;
      output?: string;
      approval?: ToolApproval;
      /** The run is live and active: pending decisions can be answered here. */
      interactive: boolean;
      control?: ControlView;
    }>
  | Readonly<{
      kind: 'question';
      key: string;
      turnId: string;
      request: UserInputRequest;
      interactive: boolean;
      control?: ControlView;
      first: boolean;
    }>
  | Readonly<{ kind: 'attachments'; key: string; turnId: string; count: number; first: boolean }>
  | Readonly<{ kind: 'notice'; key: string; turnId: string; text: string; tone: 'error' | 'info'; first: boolean }>;

const DETAIL_MAX_CHARS = 2_000;

/** Pretty, bounded text for a tool's input or output. */
export function detailText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  if (text === '{}' || text === '[]') return undefined;
  return text.length > DETAIL_MAX_CHARS ? `${text.slice(0, DETAIL_MAX_CHARS)}\n…（已截断）` : text;
}

/** The most telling single field of a tool call. */
function toolSummary(block: Block): string | undefined {
  const input = block.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== 'object') return undefined;
  for (const key of ['command', 'path', 'file_path', 'query', 'url', 'pattern']) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim();
  }
  return undefined;
}

type RowContext = Readonly<{ interactive: boolean; controls?: ReadonlyMap<string, ControlView> }>;
const STATIC: RowContext = { interactive: false };

function toolState(block: Block): 'running' | 'done' | 'failed' | 'awaiting' {
  if (block.approval && block.approval.status === 'pending') return 'awaiting';
  if (block.user_input && block.user_input.status === 'pending') return 'awaiting';
  if (block.running) return 'running';
  const output = block.output as { error?: unknown; is_error?: unknown } | undefined;
  if (output && (output.error || output.is_error === true)) return 'failed';
  return 'done';
}

function blockRows(turnId: string, block: Block, first: boolean, ctx: RowContext): ChatRow[] {
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
    case 'tool': {
      if (block.user_input) {
        return [
          {
            kind: 'question',
            key: base,
            turnId,
            request: block.user_input,
            interactive: ctx.interactive,
            control: ctx.controls?.get(block.user_input.user_input_id),
            first,
          },
        ];
      }
      return [
        {
          kind: 'tool',
          key: base,
          turnId,
          name: block.name || 'tool',
          state: toolState(block),
          first,
          summary: toolSummary(block),
          input: detailText(block.input),
          output: detailText(block.output),
          approval: block.approval,
          interactive: ctx.interactive,
          control: block.approval ? ctx.controls?.get(block.approval.approval_id) : undefined,
        },
      ];
    }
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

export function turnRows(turn: Turn, ctx: RowContext = STATIC): ChatRow[] {
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
  for (const block of turn.messages ?? []) rows.push(...blockRows(turn.turn_id, block, rows.length === 0, ctx));
  return rows;
}

export function historyRows(turns: readonly Turn[]): ChatRow[] {
  return turns.flatMap((t) => turnRows(t));
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
  /** Open or finished control requests by decision id, plus whether a stop is in flight. */
  controls?: ReadonlyMap<string, ControlView>;
  stopping?: boolean;
}>;

/**
 * History, then the live run if its turn is not persisted yet, then sends
 * the server has not attached to any visible turn. A turn is never shown
 * twice: once history contains it, the live copy and the pending bubble go.
 */
export function composeRows({ history, run, pending, controls, stopping = false }: ComposeInput): ChatRow[] {
  const rows = historyRows(history);
  const persisted = new Set(history.map((t) => t.turn_id));
  const liveTurn = run && !persisted.has(run.turn_id) ? run : null;

  if (liveTurn) {
    const mine = pending.find((p) => p.turnId === liveTurn.turn_id);
    const userTurn = liveTurn.user_turns?.find((t) => t.turn_id === liveTurn.turn_id) ?? liveTurn.user_turns?.[0];
    const text = userTurn?.text ?? mine?.text;
    const active = isRunActive(liveTurn.status);
    if (text !== undefined) rows.push({ kind: 'user', key: `${liveTurn.turn_id}:u`, turnId: liveTurn.turn_id, text, attachments: 0 });
    rows.push(
      ...turnRows(
        { turn_id: liveTurn.turn_id, role: 'assistant', timestamp: '', messages: liveTurn.messages },
        { interactive: active && liveTurn.status !== 'aborting' && !stopping, controls },
      ),
    );
    if (active) {
      rows.push({
        kind: 'working',
        key: `${liveTurn.turn_id}:w`,
        turnId: liveTurn.turn_id,
        status: liveTurn.status,
        stopping: stopping || liveTurn.status === 'aborting',
      });
    } else if (liveTurn.status === 'aborted') rows.push({ kind: 'notice', key: `${liveTurn.turn_id}:x`, turnId: liveTurn.turn_id, text: '已停止', tone: 'info', first: false });
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
