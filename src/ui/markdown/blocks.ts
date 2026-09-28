/**
 * Split Markdown into top-level blocks so streamed text only re-parses the
 * open tail. A boundary is a blank line outside a fenced code block. The rule is
 * local (fence state + blank lines), so an incremental split always equals a
 * full split of the same text — the property the tests pin down.
 */

export type MarkdownBlock = Readonly<{
  /** Stable within one message: the block's index. */
  key: number;
  source: string;
}>;

export type BlockSplit = Readonly<{
  source: string;
  blocks: readonly MarkdownBlock[];
  /** Offset where the last (still open) block starts. */
  tailStart: number;
}>;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export const EMPTY_SPLIT: BlockSplit = { source: '', blocks: [], tailStart: 0 };

function scan(source: string, from: number, firstKey: number) {
  const blocks: MarkdownBlock[] = [];
  let fence: string | null = null;
  let blockStart = from;
  let lineStart = from;
  let lastBlockStart = from;

  const closeBlock = (end: number) => {
    const text = source.slice(blockStart, end).replace(/\n+$/, '');
    if (text.trim().length > 0) {
      lastBlockStart = blockStart;
      blocks.push({ key: firstKey + blocks.length, source: text });
    }
  };

  while (lineStart <= source.length) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline < 0 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd);
    const fenceMatch = FENCE.exec(line);

    if (fence) {
      if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length && line.trim() === fenceMatch[1]) {
        fence = null;
      }
    } else if (fenceMatch) {
      fence = fenceMatch[1]!;
    } else if (line.trim() === '' && newline >= 0) {
      closeBlock(lineStart);
      blockStart = newline + 1;
    }

    if (newline < 0) break;
    lineStart = newline + 1;
  }
  closeBlock(source.length);
  return { blocks, tailStart: blocks.length > 0 ? lastBlockStart : from };
}

export function splitBlocks(source: string): BlockSplit {
  const { blocks, tailStart } = scan(source, 0, 0);
  return { source, blocks, tailStart };
}

/**
 * Re-split after the text changed. When `next` extends `previous.source`
 * (the streaming case) only the open tail is rescanned and all earlier block
 * objects are reused by reference; any other edit falls back to a full split.
 */
export function updateBlocks(previous: BlockSplit, next: string): BlockSplit {
  if (next === previous.source) return previous;
  if (!next.startsWith(previous.source) || previous.blocks.length === 0) return splitBlocks(next);

  const stable = previous.blocks.slice(0, -1);
  const { blocks, tailStart } = scan(next, previous.tailStart, stable.length);
  return {
    source: next,
    blocks: [...stable, ...blocks],
    tailStart: blocks.length > 0 ? tailStart : previous.tailStart,
  };
}
