import { describe, expect, it } from 'vitest';

import { createLogger, formatEntry, REDACTED, scrubFields } from './log';

describe('diagnostics log (PF-04)', () => {
  it('redacts credentials and user content by key, keeps identifiers', () => {
    const fields = scrubFields({
      access_token: 'eyJhbGciOi.eyJzdWIi.sig',
      password: 'admin123',
      Authorization: 'Bearer abc',
      text: 'my private question',
      payload: { text: 'x' },
      tool_output: 'rm -rf',
      invocation_id: 'inv-1',
      session_id: 's-1',
      status: 'unconfirmed',
      attempts: 3,
      empty_text: '',
    });
    expect(fields).toEqual({
      access_token: REDACTED,
      password: REDACTED,
      Authorization: REDACTED,
      text: REDACTED,
      payload: REDACTED,
      tool_output: REDACTED,
      invocation_id: 'inv-1',
      session_id: 's-1',
      status: 'unconfirmed',
      attempts: 3,
      empty_text: null,
    });
  });

  it('strips URL queries and bearer/JWT fragments from free text', () => {
    const { url, error } = scrubFields({
      url: 'wss://memoh.example:18080/bots/b/ws?token=secret#x',
      error: new Error('401 for Bearer abc.def and eyJa.eyJb.c'),
    });
    expect(url).toBe('wss://memoh.example:18080/bots/b/ws');
    expect(error).toBe(`Error: 401 for Bearer ${REDACTED} and ${REDACTED}`);
  });

  it('summarises nested values and cuts long strings', () => {
    const { list, obj, long } = scrubFields({ list: [1, 2, 3], obj: { a: 1, b: 2 }, long: 'a'.repeat(500) });
    expect(list).toBe('[array 3]');
    expect(obj).toBe('[object 2 keys]');
    expect(long).toMatch(/…\(500\)$/);
  });

  it('keeps the newest entries within capacity and notifies subscribers', () => {
    let t = 0;
    const log = createLogger({ capacity: 3, now: () => ++t });
    let calls = 0;
    log.subscribe(() => calls++);
    for (const n of [1, 2, 3, 4]) log.info('tick', { n });
    expect(log.entries().map((e) => e.fields.n)).toEqual([2, 3, 4]);
    expect(calls).toBe(4);
    expect(formatEntry(log.entries()[0]!)).toBe('1970-01-01T00:00:00.002Z INFO  tick n=2');
  });
});
