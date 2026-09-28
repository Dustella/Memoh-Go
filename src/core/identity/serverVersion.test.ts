import { describe, expect, it } from 'vitest';

import { MIN_SERVER_VERSION, checkServerCompatibility } from './serverVersion';

const ping = (version: string) => ({ status: 'ok', version });

describe('checkServerCompatibility', () => {
  it('accepts the minimum and anything newer', () => {
    expect(MIN_SERVER_VERSION).toBe('0.17.0');
    expect(checkServerCompatibility(ping('v0.17.0')).kind).toBe('supported');
    expect(checkServerCompatibility(ping('0.20.0')).kind).toBe('supported');
    expect(checkServerCompatibility(ping('v1.0.0-beta.2')).kind).toBe('supported');
  });

  it('rejects older releases, including pre-releases of the minimum', () => {
    expect(checkServerCompatibility(ping('v0.16.0'))).toEqual({ kind: 'too_old', version: 'v0.16.0', minimum: '0.17.0' });
    expect(checkServerCompatibility(ping('v0.9.1')).kind).toBe('too_old');
    expect(checkServerCompatibility(ping('v0.17.0-beta.1')).kind).toBe('too_old');
  });

  it('allows non-release builds as unverified', () => {
    expect(checkServerCompatibility(ping('dev'))).toEqual({ kind: 'unverified', version: 'dev' });
    expect(checkServerCompatibility({ status: 'ok' })).toEqual({ kind: 'unverified', version: '' });
  });

  it('rejects responses that are not from a Memoh server', () => {
    expect(checkServerCompatibility({ version: 'v0.20.0' }).kind).toBe('not_memoh');
  });

  it('follows a bumped minimum', () => {
    expect(checkServerCompatibility(ping('v0.18.0'), '0.19.0').kind).toBe('too_old');
  });
});
