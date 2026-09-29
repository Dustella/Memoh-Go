import { en } from './en';
import { zh, type MessageKey } from './zh';

export type { MessageKey } from './zh';

/**
 * UI text (PF-06). Chinese is the source language; English must define every
 * key (enforced by the `Record<MessageKey, string>` type in `en.ts`).
 *
 * The active locale is process state rather than React context so pure
 * helpers (`turnRows`, `chatStatus`, relative time) can translate too.
 * Components re-render on a change through `useT()` in `ui/preferences.ts`.
 */
export type Locale = 'zh' | 'en';
export type LanguagePreference = 'system' | Locale;

export type Params = Readonly<Record<string, string | number>>;

const TABLES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { zh, en };

let current: Locale = 'zh';

export function setLocale(locale: Locale) {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** `{name}` placeholders are replaced from `params`; unknown ones stay visible. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

export function t(key: MessageKey, params?: Params): string {
  return interpolate(TABLES[current][key] ?? zh[key], params);
}

/**
 * Count-dependent text: uses `<key>.one` when count is 1 and that key exists,
 * otherwise `<key>.other`. `{count}` is always available to the template.
 */
export function tn(key: string, count: number, params?: Params): string {
  const one = `${key}.one` as MessageKey;
  const other = `${key}.other` as MessageKey;
  const table = TABLES[current];
  const chosen = count === 1 && table[one] !== undefined ? one : other;
  return t(chosen, { ...params, count });
}

/** Map a preference and the device's BCP-47 tag to a supported locale. */
export function resolveLocale(preference: LanguagePreference, systemTag: string | undefined): Locale {
  if (preference !== 'system') return preference;
  const tag = (systemTag ?? '').toLowerCase();
  if (tag.startsWith('zh')) return 'zh';
  return tag ? 'en' : 'zh';
}
