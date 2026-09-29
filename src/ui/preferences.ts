import { useSyncExternalStore } from 'react';
import { Appearance, I18nManager } from 'react-native';

import { getLocale, resolveLocale, setLocale, t, tn, type Locale } from '../core/i18n';
import { DEFAULT_PREFERENCES, type AppPreferences } from '../data/local/preferencesStore';

/**
 * Process-wide app preferences (AD-10). Screens read them through hooks; the
 * AppServices boot loads the saved values and persists changes. Applying a
 * value has two side effects: the i18n locale (PF-06) and the native colour
 * scheme override, which `useColorScheme` and system dialogs both follow.
 */
type Listener = () => void;

let preferences: AppPreferences = DEFAULT_PREFERENCES;
let persist: ((next: AppPreferences, changed: keyof AppPreferences) => void) | undefined;
const listeners = new Set<Listener>();

/** The device language as a BCP-47-ish tag, without a native localization module. */
export function systemLanguageTag(): string | undefined {
  try {
    const fromIntl = Intl.DateTimeFormat().resolvedOptions().locale;
    if (fromIntl) return fromIntl;
  } catch {
    // Hermes without Intl: fall through to the native constant.
  }
  try {
    return I18nManager.getConstants().localeIdentifier ?? undefined;
  } catch {
    return undefined;
  }
}

function apply(next: AppPreferences) {
  setLocale(resolveLocale(next.language, systemLanguageTag()));
  Appearance.setColorScheme(next.appearance === 'system' ? 'unspecified' : next.appearance);
}

function emit() {
  for (const listener of listeners) listener();
}

// The system language applies from the first render, before storage opens.
apply(preferences);

export const appPreferences = {
  get: (): AppPreferences => preferences,
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Called once at boot with the saved values and a writer for later changes. */
  hydrate(saved: AppPreferences, writer: (next: AppPreferences, changed: keyof AppPreferences) => void) {
    preferences = saved;
    persist = writer;
    apply(saved);
    emit();
  },
  set<K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) {
    if (preferences[key] === value) return;
    preferences = { ...preferences, [key]: value };
    apply(preferences);
    persist?.(preferences, key);
    emit();
  },
};

export function usePreferences(): AppPreferences {
  return useSyncExternalStore(appPreferences.subscribe, appPreferences.get);
}

/** The active locale; subscribing re-renders the caller when the language changes. */
export function useLocale(): Locale {
  useSyncExternalStore(appPreferences.subscribe, appPreferences.get);
  return getLocale();
}

/**
 * Translation functions for a component. Calling it subscribes the component,
 * so its text updates when the language setting changes.
 */
export function useT() {
  useLocale();
  return { t, tn };
}
