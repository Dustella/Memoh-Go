import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scopeKey } from '../../core/identity/scope';
import { openNodeDatabase } from '../../../tests/support/nodeDatabase';
import { replaceBots, upsertSessions } from './conversationStore';
import { DEFAULT_PREFERENCES, loadPreferences, parsePreferences, savePreference } from './preferencesStore';
import type { SqlDatabase } from './sql';
import { cacheSummary, clearScope, clearSessionCache, loadDraft, saveDraft } from './userStateStore';

const scope = scopeKey({ deployment: 'https://a.example', accountId: 'u1', teamId: 'default' });

let db: SqlDatabase;
beforeEach(async () => {
  db = await openNodeDatabase();
});
afterEach(async () => {
  await db.close();
});

describe('preferencesStore', () => {
  it('starts from the defaults and round-trips each field', async () => {
    expect(await loadPreferences(db)).toEqual(DEFAULT_PREFERENCES);
    await savePreference(db, 'language', 'en', 1);
    await savePreference(db, 'appearance', 'dark', 2);
    await savePreference(db, 'inAppAlerts', false, 3);
    await savePreference(db, 'language', 'zh', 4);
    expect(await loadPreferences(db)).toEqual({ language: 'zh', appearance: 'dark', inAppAlerts: false });
  });

  it('falls back per field on unknown or corrupt values', async () => {
    expect(parsePreferences({ language: 'fr', appearance: 'dark', inAppAlerts: 'yes' })).toEqual({
      language: 'system',
      appearance: 'dark',
      inAppAlerts: true,
    });
    await db.run("INSERT INTO app_preferences (key, value, updated_at) VALUES ('language', '{oops', 0)");
    expect((await loadPreferences(db)).language).toBe('system');
  });

  it('survives sign-out, which only clears scoped tables', async () => {
    await savePreference(db, 'language', 'en', 1);
    await clearScope(db, scope);
    expect((await loadPreferences(db)).language).toBe('en');
  });
});

describe('clearSessionCache', () => {
  it('drops server data but keeps drafts', async () => {
    const key = { scope, botId: 'b1', sessionId: 's1' };
    await replaceBots(db, scope, [{ id: 'b1', name: 'Kitty' }], 0);
    await upsertSessions(db, scope, 'b1', [{ id: 's1', bot_id: 'b1', updated_at: '2026-09-29T01:00:00Z' }], 0);
    await saveDraft(db, key, 'half-written', 0);
    expect(await cacheSummary(db, scope)).toEqual({ sessions: 1, turns: 0 });

    await clearSessionCache(db, scope);

    expect(await cacheSummary(db, scope)).toEqual({ sessions: 0, turns: 0 });
    expect(await db.all('SELECT * FROM bots')).toEqual([]);
    expect(await loadDraft(db, key)).toBe('half-written');
  });
});
