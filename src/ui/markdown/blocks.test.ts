import { describe, expect, it } from 'vitest';

import { EMPTY_SPLIT, splitBlocks, updateBlocks } from './blocks';
import { chunkText, generateMarkdown } from './sampleContent';

describe('splitBlocks', () => {
  it('splits on blank lines but keeps fenced code intact', () => {
    const text = 'para one\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n- item';
    expect(splitBlocks(text).blocks.map((block) => block.source)).toEqual([
      'para one',
      '```ts\nconst a = 1;\n\nconst b = 2;\n```',
      '- item',
    ]);
  });

  it('treats an unclosed fence as one open tail block', () => {
    const split = splitBlocks('intro\n\n```\ncode\n\nmore');
    expect(split.blocks).toHaveLength(2);
    expect(split.blocks[1]?.source).toBe('```\ncode\n\nmore');
  });

  it('only closes a fence with the same marker of at least equal length', () => {
    const split = splitBlocks('````\n```\ninner\n```\n````\n\nafter');
    expect(split.blocks.map((block) => block.source)).toEqual(['````\n```\ninner\n```\n````', 'after']);
  });
});

describe('updateBlocks', () => {
  for (const seed of [1, 7, 42, 2026]) {
    it(`streams to the same result as a full split (seed ${seed})`, () => {
      const text = generateMarkdown(seed, 6000);
      let split = EMPTY_SPLIT;
      let reused = 0;
      for (const chunk of chunkText(text, seed)) {
        const before = split.blocks;
        split = updateBlocks(split, split.source + chunk);
        const full = splitBlocks(split.source);
        expect(split.blocks).toEqual(full.blocks);
        for (let i = 0; i < Math.min(before.length - 1, split.blocks.length); i += 1) {
          if (split.blocks[i] === before[i]) reused += 1;
        }
      }
      expect(split.source).toBe(text);
      expect(reused).toBeGreaterThan(0);
    });
  }

  it('falls back to a full split on a non-append edit', () => {
    const first = splitBlocks('a\n\nb');
    expect(updateBlocks(first, 'x\n\nb').blocks.map((block) => block.source)).toEqual(['x', 'b']);
  });
});
