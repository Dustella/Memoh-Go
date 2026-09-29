import { describe, expect, it } from 'vitest';

import {
  admitAttachments,
  attachmentType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  referencedUris,
  safeFileName,
  toDataUrl,
  uniqueName,
} from './attachments';
import { joinPath } from './files';

const file = (name: string, size = 10) => ({ uri: `file:///c/${name}`, name, mime: 'text/plain', size });

describe('attachments (CH-16) and upload names (FL-04)', () => {
  it('classifies by MIME type', () => {
    expect(attachmentType('image/png')).toBe('image');
    expect(attachmentType('video/mp4')).toBe('video');
    expect(attachmentType('audio/mpeg')).toBe('audio');
    expect(attachmentType('application/pdf')).toBe('file');
  });

  it('rejects files over the size cap and past the count cap', () => {
    const big = file('big.bin', MAX_ATTACHMENT_BYTES + 1);
    const { accepted, rejected } = admitAttachments([file('a'), big, file('b')], MAX_ATTACHMENTS - 1);
    expect(accepted.map((f) => f.name)).toEqual(['a']);
    expect(rejected).toEqual([
      { name: 'big.bin', reason: 'too_large' },
      { name: 'b', reason: 'too_many' },
    ]);
  });

  it('builds data URLs with a fallback MIME type', () => {
    expect(toDataUrl('image/png', 'QQ==')).toBe('data:image/png;base64,QQ==');
    expect(toDataUrl('', 'QQ==')).toBe('data:application/octet-stream;base64,QQ==');
  });

  it('makes names safe and unique within a folder', () => {
    expect(safeFileName('a/b:c?.txt')).toBe('a_b_c_.txt');
    expect(safeFileName('..')).toBe('file');
    expect(uniqueName('notes.txt', new Set(['notes.txt', 'notes (1).txt']))).toBe('notes (2).txt');
    expect(uniqueName('Makefile', new Set(['Makefile']))).toBe('Makefile (1)');
    expect(uniqueName('new.md', new Set(['notes.txt']))).toBe('new.md');
    expect(joinPath('/data/reports/', 'x.md')).toBe('/data/reports/x.md');
    expect(joinPath('/', 'x.md')).toBe('/x.md');
  });

  it('collects the staged files still referenced by messages', () => {
    const keep = referencedUris([{ attachments: [{ type: 'file', uri: 'u1', name: 'a', mime: 'x', size: 1 }] }, {}]);
    expect([...keep]).toEqual(['u1']);
  });
});
