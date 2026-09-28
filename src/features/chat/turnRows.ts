import type { Block, Turn } from '../../core/conversation/types';
import { splitBlocks } from '../../ui/markdown/blocks';

/**
 * One virtualised row. Assistant text is split into Markdown blocks so long
 * answers virtualise block by block (docs/10-render-benchmark.md); tool,
 * reasoning and other non-text blocks become compact rows of their own.
 */
export type ChatRow =
  | Readonly<{ kind: 'edge'; key: string; turnId: ''; state: 'beginning' | 'loading' | 'more' }>
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
