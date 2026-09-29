import { isRunActive, type Block, type RunView, type SteerTurn, type ToolApproval, type Turn, type UserInputRequest } from '../../core/conversation/types';
import { t } from '../../core/i18n';
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
  | Readonly<{ kind: 'user'; key: string; turnId: string; text: string; attachments: number; steer?: boolean }>
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
      return [{ kind: 'notice', key: base, turnId, text: block.content || block.code || t('chat.error'), tone: 'error', first }];
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

/**
 * The live run's assistant rows with steer messages (CH-13) placed where the
 * run took them: after the block named by `after_message_id` (at the start
 * for 0 or an unknown block). User turns the run added that are not steers
 * go after the output. The persisted history later groups the steer before
 * the whole reply; that is the server's layout, used once it is saved.
 */
function liveAssistantRows(run: RunView, primary: Turn | undefined, ctx: RowContext): ChatRow[] {
  const steers = [...(run.steer_turns ?? [])].sort((a, b) => a.after_message_id - b.after_message_id);
  const steerRow = (s: SteerTurn): ChatRow => ({
    kind: 'user',
    key: `${run.turn_id}:steer:${s.item_id}`,
    turnId: run.turn_id,
    text: s.text,
    attachments: 0,
    steer: true,
  });
  const byBlock = new Map<number, SteerTurn[]>();
  const blockIds = new Set(run.messages.map((b) => b.id));
  const leading: SteerTurn[] = [];
  for (const s of steers) {
    if (!blockIds.has(s.after_message_id)) leading.push(s);
    else byBlock.set(s.after_message_id, [...(byBlock.get(s.after_message_id) ?? []), s]);
  }
  const rows: ChatRow[] = leading.map(steerRow);
  for (const block of run.messages) {
    rows.push(...blockRows(run.turn_id, block, rows.every((r) => r.kind === 'user'), ctx));
    for (const s of byBlock.get(block.id) ?? []) rows.push(steerRow(s));
  }
  const steerTurnIds = new Set(steers.map((s) => s.turn_id).filter(Boolean));
  for (const turn of run.user_turns ?? []) {
    if (turn === primary || steerTurnIds.has(turn.turn_id) || !turn.text) continue;
    rows.push({ kind: 'user', key: `${turn.turn_id}:u`, turnId: turn.turn_id, text: turn.text, attachments: 0, steer: true });
  }
  return rows;
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
    rows.push(...liveAssistantRows(liveTurn, userTurn, { interactive: active && liveTurn.status !== 'aborting' && !stopping, controls }));
    if (active) {
      rows.push({
        kind: 'working',
        key: `${liveTurn.turn_id}:w`,
        turnId: liveTurn.turn_id,
        status: liveTurn.status,
        stopping: stopping || liveTurn.status === 'aborting',
      });
    } else if (liveTurn.status === 'aborted') rows.push({ kind: 'notice', key: `${liveTurn.turn_id}:x`, turnId: liveTurn.turn_id, text: t('chat.stopped'), tone: 'info', first: false });
    else if (liveTurn.status === 'errored' || liveTurn.status === 'lost') {
      rows.push({ kind: 'notice', key: `${liveTurn.turn_id}:x`, turnId: liveTurn.turn_id, text: liveTurn.error || t('chat.notCompleted'), tone: 'error', first: false });
    }
  }

  for (const p of pending) {
    if (p.turnId && (persisted.has(p.turnId) || p.turnId === liveTurn?.turn_id)) continue;
    rows.push({ kind: 'pending', key: `p:${p.invocationId}`, turnId: '', invocationId: p.invocationId, text: p.text, state: p.state });
  }
  return rows;
}


export type CopyChoice = Readonly<{ label: string; text: string }>;

/**
 * CH-12: what a long-press on `row` can copy. A reply is rendered as one row
 * per Markdown block, so an assistant block offers both the block and the
 * whole reply (every Markdown block of that turn, in order).
 */
export function copyChoices(rows: readonly ChatRow[], row: ChatRow): CopyChoice[] {
  switch (row.kind) {
    case 'user':
    case 'pending':
      return row.text ? [{ label: t('common.copy'), text: row.text }] : [];
    case 'markdown': {
      const reply = rows
        .filter((r): r is Extract<ChatRow, { kind: 'markdown' }> => r.kind === 'markdown' && r.turnId === row.turnId)
        .map((r) => r.source.trim())
        .filter(Boolean)
        .join('\n\n');
      const block = row.source.trim();
      return reply === block
        ? [{ label: t('chat.copy.reply'), text: reply }]
        : [
            { label: t('chat.copy.wholeReply'), text: reply },
            { label: t('chat.copy.paragraph'), text: block },
          ];
    }
    case 'reasoning':
      return row.text ? [{ label: t('chat.copy.thinking'), text: row.text }] : [];
    case 'tool':
      return [row.output ? { label: t('chat.copy.toolOutput'), text: row.output } : null, row.input ? { label: t('chat.copy.toolInput'), text: row.input } : null].filter(
        (c): c is CopyChoice => c !== null,
      );
    default:
      return [];
  }
}
