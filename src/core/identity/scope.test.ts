import { describe, expect, it } from 'vitest';

import { normaliseDeployment, sameScope, scopeKey } from './scope';

const DEFAULT_TEAM = '00000000-0000-0000-0000-000000000001';

describe('normaliseDeployment', () => {
  it('adds https, lowercases the host and drops trailing slashes', () => {
    expect(normaliseDeployment(' Memoh.Example.com/ ')).toBe('https://memoh.example.com');
    expect(normaliseDeployment('http://10.0.0.5:8080/api//')).toBe('http://10.0.0.5:8080/api');
  });

  it('rejects non-http schemes', () => {
    expect(() => normaliseDeployment('ftp://host')).toThrow(/Unsupported/);
  });

  it('folds full-width punctuation committed by a Chinese IME', () => {
    expect(normaliseDeployment('ＨＴＴＰ：／／192．168。1.5：18080／')).toBe('http://192.168.1.5:18080');
    expect(normaliseDeployment('\u3000memoh.example.com\u3000')).toBe('https://memoh.example.com');
  });
});

describe('scopeKey', () => {
  it('separates two deployments that share the default team id', () => {
    const a = { deployment: 'https://a.example', accountId: 'u1', teamId: DEFAULT_TEAM };
    const b = { deployment: 'https://b.example', accountId: 'u1', teamId: DEFAULT_TEAM };
    expect(scopeKey(a)).not.toBe(scopeKey(b));
    expect(sameScope(a, { ...a })).toBe(true);
  });

  it('cannot be forged by delimiter characters inside a part', () => {
    const a = { deployment: 'https://x', accountId: 'u|1', teamId: 't' };
    const b = { deployment: 'https://x|u', accountId: '1', teamId: 't' };
    expect(scopeKey(a)).not.toBe(scopeKey(b));
  });

  it('requires every part', () => {
    expect(() => scopeKey({ deployment: 'https://x', accountId: '', teamId: 't' })).toThrow();
  });
});
