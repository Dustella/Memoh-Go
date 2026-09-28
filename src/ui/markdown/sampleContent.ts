/**
 * Deterministic Markdown content for tests and render benchmarks: mixed
 * Chinese/English prose, lists, fenced code (sometimes left open mid-stream),
 * tables and emoji. Same seed, same output.
 */

export function createRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EN = [
  'The runtime keeps executing after the socket closes.',
  'Deltas must be contiguous within one epoch.',
  'We batch visible updates into short windows.',
  'Only the open tail block is parsed again.',
  'Check the **invocation id** before retrying.',
  'Use `turn_position` as the ordering key.',
];
const ZH = [
  '离开时放心，回来时接得上。',
  '服务端在断开连接后继续执行任务。',
  '只重新解析最后一个未闭合的块。',
  '阅读位置在冷启动后应当保持不变。',
  '同一个 **invocation** 不会重复执行。',
  '混排 English 与中文 😀 以及 emoji 🚀。',
];
const CODE = [
  'const next = applyRunDelta(run, delta);',
  'if (event.seq !== stream.seq + 1) resubscribe();',
  'for (const block of blocks) render(block);',
  'await outbox.send({ invocationId, payload });',
];

export function generateMarkdown(seed: number, targetChars: number): string {
  const random = createRandom(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const parts: string[] = [];
  let length = 0;
  let section = 1;

  while (length < targetChars) {
    const roll = random();
    let part: string;
    if (roll < 0.1) {
      part = `## ${section++}. ${pick(ZH).replace(/[。*]/g, '')}`;
    } else if (roll < 0.5) {
      const sentences = 2 + Math.floor(random() * 4);
      part = Array.from({ length: sentences }, () => pick(random() < 0.5 ? EN : ZH)).join(' ');
    } else if (roll < 0.68) {
      const items = 2 + Math.floor(random() * 4);
      const ordered = random() < 0.4;
      part = Array.from({ length: items }, (_, i) => `${ordered ? `${i + 1}.` : '-'} ${pick(random() < 0.5 ? EN : ZH)}`).join('\n');
    } else if (roll < 0.83) {
      const lines = 2 + Math.floor(random() * 6);
      part = ['```ts', ...Array.from({ length: lines }, () => pick(CODE)), '```'].join('\n');
    } else if (roll < 0.9) {
      part = `> ${pick(ZH)}\n> ${pick(EN)}`;
    } else {
      part = ['| 字段 | Value |', '| --- | --- |', `| seq | ${Math.floor(random() * 100)} |`, `| epoch | ep_${Math.floor(random() * 1000)} |`].join('\n');
    }
    parts.push(part);
    length += part.length + 2;
  }
  return parts.join('\n\n');
}

/** Cut `text` into streaming increments of 1..maxChunk characters. */
export function chunkText(text: string, seed: number, maxChunk = 12): string[] {
  const random = createRandom(seed);
  const chunks: string[] = [];
  const chars = Array.from(text); // never split a surrogate pair
  let index = 0;
  while (index < chars.length) {
    const size = 1 + Math.floor(random() * maxChunk);
    chunks.push(chars.slice(index, index + size).join(''));
    index += size;
  }
  return chunks;
}
