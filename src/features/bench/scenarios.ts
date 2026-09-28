import { splitBlocks, type BlockSplit } from '../../ui/markdown/blocks';
import { chunkText, createRandom, generateMarkdown } from '../../ui/markdown/sampleContent';

/** One list row: a user message, or one Markdown block of an assistant turn. */
export type ChatRow = Readonly<{
  key: string;
  turnId: string;
  role: 'user' | 'assistant';
  source: string;
  /** First row of its turn: renders the turn's top spacing. */
  first: boolean;
}>;

export type ScenarioId = 'stream100' | 'burst500' | 'history10k' | 'huge100k' | 'prepend';

export type Scenario = Readonly<{
  id: ScenarioId;
  label: string;
  historyTurns: number;
  historyChars: number;
  /** Streaming: increments per second and seconds to run (0 = no stream). */
  rate: number;
  streamSeconds: number;
  streamChars: number;
  /** Programmatic scroll sweep through the whole list. */
  sweep: boolean;
  /** Prepend pages of older turns while anchored mid-list. */
  prependPages: number;
}>;

export const SCENARIOS: readonly Scenario[] = [
  { id: 'stream100', label: '流式 100/s', historyTurns: 200, historyChars: 600, rate: 100, streamSeconds: 12, streamChars: 9000, sweep: false, prependPages: 0 },
  { id: 'burst500', label: '突发 500/s', historyTurns: 200, historyChars: 600, rate: 500, streamSeconds: 8, streamChars: 30000, sweep: false, prependPages: 0 },
  { id: 'history10k', label: '1 万条历史', historyTurns: 10000, historyChars: 160, rate: 0, streamSeconds: 0, streamChars: 0, sweep: true, prependPages: 0 },
  { id: 'huge100k', label: '10 万字单条', historyTurns: 0, historyChars: 0, rate: 0, streamSeconds: 0, streamChars: 0, sweep: true, prependPages: 0 },
  { id: 'prepend', label: '历史前插', historyTurns: 1000, historyChars: 400, rate: 0, streamSeconds: 0, streamChars: 0, sweep: false, prependPages: 5 },
];

export function scenarioById(id: string | undefined): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0]!;
}

export function rowsForTurn(turnId: string, role: 'user' | 'assistant', split: BlockSplit): ChatRow[] {
  if (role === 'user') {
    return [{ key: `${turnId}:u`, turnId, role, source: split.source, first: true }];
  }
  return split.blocks.map((block) => ({
    key: `${turnId}:${block.key}`,
    turnId,
    role,
    source: block.source,
    first: block.key === 0,
  }));
}

/** Deterministic history: alternating user / assistant turns. */
export function buildHistory(turns: number, charsPerAssistant: number, seed: number, idPrefix = 'h'): ChatRow[] {
  const random = createRandom(seed);
  const rows: ChatRow[] = [];
  for (let index = 0; index < turns; index += 1) {
    const turnId = `${idPrefix}${index}`;
    if (index % 2 === 0) {
      const text = random() < 0.5 ? '帮我检查一下最新的运行结果。' : 'Can you summarise what changed since yesterday?';
      rows.push(...rowsForTurn(turnId, 'user', splitBlocks(text)));
    } else {
      const size = Math.max(40, Math.round(charsPerAssistant * (0.5 + random())));
      rows.push(...rowsForTurn(turnId, 'assistant', splitBlocks(generateMarkdown(seed + index, size))));
    }
  }
  return rows;
}

export function buildHugeMessage(seed: number): ChatRow[] {
  return [
    ...rowsForTurn('big-u', 'user', splitBlocks('请输出完整的长报告。')),
    ...rowsForTurn('big-a', 'assistant', splitBlocks(generateMarkdown(seed, 100_000))),
  ];
}

export function streamChunks(scenario: Scenario, seed: number): string[] {
  if (scenario.rate === 0) return [];
  const total = Math.min(scenario.streamChars, scenario.rate * scenario.streamSeconds * 12);
  const chunks = chunkText(generateMarkdown(seed, total), seed);
  return chunks.slice(0, scenario.rate * scenario.streamSeconds);
}
