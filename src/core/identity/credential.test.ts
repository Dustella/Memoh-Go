import { describe, expect, it } from 'vitest';

import { newId } from '../ids';
import { EXPIRY_MARGIN_MS, credentialFromResponse, isExpired, refreshDue } from './credential';

describe('credential', () => {
  const issued = Date.parse('2026-09-28T00:00:00Z');
  const body = { access_token: 'tok', expires_at: '2026-09-29T00:00:00Z' };

  it('maps server expiry onto the device clock', () => {
    const inSync = credentialFromResponse(body, issued, new Date(issued).toUTCString());
    expect(inSync.expiresAt).toBe(Date.parse(body.expires_at));
    const ahead = credentialFromResponse(body, issued + 3_600_000, new Date(issued).toUTCString());
    expect(ahead.expiresAt).toBe(Date.parse(body.expires_at) + 3_600_000);
    expect(credentialFromResponse(body, issued, null).expiresAt).toBe(Date.parse(body.expires_at));
    expect(() => credentialFromResponse({ access_token: '', expires_at: 'x' }, issued)).toThrow();
  });

  it('refreshes in the last quarter and never after expiry', () => {
    const c = credentialFromResponse(body, issued);
    const hour = 3_600_000;
    expect(refreshDue(c, issued + 17 * hour)).toBe(false);
    expect(refreshDue(c, issued + 19 * hour)).toBe(true);
    expect(isExpired(c, c.expiresAt - EXPIRY_MARGIN_MS - 1)).toBe(false);
    expect(isExpired(c, c.expiresAt - EXPIRY_MARGIN_MS)).toBe(true);
    expect(refreshDue(c, c.expiresAt)).toBe(false);
  });
});

describe('newId', () => {
  it('produces distinct v4 UUIDs', () => {
    const ids = new Set(Array.from({ length: 500 }, newId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
