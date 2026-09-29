import type { LanguagePreference } from '../../core/i18n';
import type { SqlExecutor } from './sql';

export type AppearancePreference = 'system' | 'light' | 'dark';

/** Device-wide settings (AD-10). Stored outside any scope, so sign-out keeps them. */
export type AppPreferences = Readonly<{
  language: LanguagePreference;
  appearance: AppearancePreference;
  /** Foreground banners for finished and pending tasks (NT-01). */
  inAppAlerts: boolean;
}>;

export const DEFAULT_PREFERENCES: AppPreferences = { language: 'system', appearance: 'system', inAppAlerts: true };

const LANGUAGES: readonly LanguagePreference[] = ['system', 'zh', 'en'];
const APPEARANCES: readonly AppearancePreference[] = ['system', 'light', 'dark'];

/** Unknown or corrupt values fall back to the default for that field only. */
export function parsePreferences(raw: Readonly<Record<string, unknown>>): AppPreferences {
  const language = LANGUAGES.includes(raw.language as LanguagePreference)
    ? (raw.language as LanguagePreference)
    : DEFAULT_PREFERENCES.language;
  const appearance = APPEARANCES.includes(raw.appearance as AppearancePreference)
    ? (raw.appearance as AppearancePreference)
    : DEFAULT_PREFERENCES.appearance;
  const inAppAlerts = typeof raw.inAppAlerts === 'boolean' ? raw.inAppAlerts : DEFAULT_PREFERENCES.inAppAlerts;
  return { language, appearance, inAppAlerts };
}

export async function loadPreferences(db: SqlExecutor): Promise<AppPreferences> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM app_preferences');
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      raw[row.key] = JSON.parse(row.value);
    } catch {
      // Ignore a corrupt row; parsePreferences supplies the default.
    }
  }
  return parsePreferences(raw);
}

export async function savePreference<K extends keyof AppPreferences>(
  db: SqlExecutor,
  key: K,
  value: AppPreferences[K],
  now: number,
) {
  await db.run(
    `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), now],
  );
}
