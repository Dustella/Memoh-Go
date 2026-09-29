import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, ToastAndroid, View } from 'react-native';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import type { MessageKey } from '../../core/i18n';
import { MIN_SERVER_VERSION } from '../../core/identity/serverVersion';
import type { AppearancePreference } from '../../data/local/preferencesStore';
import { cacheSummary, clearSessionCache } from '../../data/local/userStateStore';
import { appPreferences, usePreferences, useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { InfoRow, LinkRow, styles as shared } from './ManagementScreen';

const SOURCE_URL = 'https://github.com/Dustella/Memoh-Go';

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.segmentText, { color: selected ? colors.text : colors.textMuted }, selected && styles.bold]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * AD-10: device-wide settings. Language and appearance apply immediately and
 * survive sign-out; "clear cache" only drops data that can be fetched again.
 */
export function SettingsScreen() {
  const { colors } = useTheme();
  const { t } = useT();
  const prefs = usePreferences();
  const { db, home } = useServices();
  const state = useAccessState();
  const scope = state.kind === 'signed_in' ? state.session.scope : null;
  const [summary, setSummary] = useState<{ sessions: number; turns: number } | null>(null);

  const readSummary = useCallback(async () => {
    if (scope) setSummary(await cacheSummary(db, scope));
  }, [db, scope]);
  useEffect(() => {
    void readSummary();
  }, [readSummary]);

  const confirmClear = () => {
    if (!scope) return;
    Alert.alert(t('settings.clearCacheTitle'), t('settings.clearCacheBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.clearCacheConfirm'),
        style: 'destructive',
        onPress: () =>
          void clearSessionCache(db, scope).then(async () => {
            home.restart();
            await readSummary();
            if (Platform.OS === 'android') ToastAndroid.show(t('settings.cacheCleared'), ToastAndroid.SHORT);
          }),
      },
    ]);
  };

  const language = (['system', 'zh', 'en'] as const).map((value) => ({ value, label: t(`settings.language.${value}` as MessageKey) }));
  const appearance = (['system', 'light', 'dark'] as const).map((value) => ({ value, label: t(`settings.appearance.${value}` as MessageKey) }));

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={shared.content}>
      <Text style={[shared.section, { color: colors.textMuted }]}>{t('settings.language')}</Text>
      <Segmented label={t('settings.language')} options={language} value={prefs.language} onChange={(v) => appPreferences.set('language', v)} />

      <Text style={[shared.section, styles.sectionGap, { color: colors.textMuted }]}>{t('settings.appearance')}</Text>
      <Segmented<AppearancePreference>
        label={t('settings.appearance')}
        options={appearance}
        value={prefs.appearance}
        onChange={(v) => appPreferences.set('appearance', v)}
      />

      <Text style={[shared.section, styles.sectionGap, { color: colors.textMuted }]}>{t('settings.notifications')}</Text>
      <View style={[shared.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.switchRow}>
          <Text style={[styles.switchLabel, { color: colors.text }]}>{t('settings.notifications.inApp')}</Text>
          <Switch
            accessibilityLabel={t('settings.notifications.inApp')}
            value={prefs.inAppAlerts}
            onValueChange={(v) => appPreferences.set('inAppAlerts', v)}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>
      <Text style={[styles.hint, { color: colors.textSubtle }]}>{t('settings.notifications.hint')}</Text>

      {scope ? (
        <>
          <Text style={[shared.section, styles.sectionGap, { color: colors.textMuted }]}>{t('settings.storage')}</Text>
          <View style={[shared.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.summary, { color: colors.textMuted }]}>
              {summary ? t('settings.cacheSummary', { sessions: summary.sessions, turns: summary.turns }) : ' '}
            </Text>
            <Pressable accessibilityRole="button" onPress={confirmClear} style={({ pressed }) => [styles.action, { borderTopColor: colors.border }, pressed && shared.pressed]}>
              <Text style={[styles.actionText, { color: colors.danger }]}>{t('settings.clearCache')}</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <LinkRow icon="pulse-outline" label={t('settings.diagnostics')} href="/diagnostics-log" />

      <Text style={[shared.section, styles.sectionGap, { color: colors.textMuted }]}>{t('settings.about')}</Text>
      <View style={[shared.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.aboutHead}>
          <Text style={[styles.appName, { color: colors.text }]}>Memoh Go</Text>
        </View>
        <InfoRow label={t('settings.version')} value={Constants.expoConfig?.version ?? '?'} />
        <InfoRow label={t('settings.build')} value={__DEV__ ? t('settings.build.dev') : t('settings.build.release')} />
        <InfoRow label={t('settings.minServer')} value={`v${MIN_SERVER_VERSION}`} />
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(SOURCE_URL)} style={({ pressed }) => [shared.row, { borderTopColor: colors.border }, pressed && shared.pressed]}>
          <Text style={[shared.rowLabel, { color: colors.textMuted }]}>{t('settings.source')}</Text>
          <Text numberOfLines={1} style={[shared.rowValue, { color: colors.accent }]}>github.com/Dustella/Memoh-Go</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: spacing.xl },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  segmentText: { fontSize: fontSize.body },
  bold: { fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  switchLabel: { flex: 1, fontSize: fontSize.body },
  hint: { fontSize: fontSize.caption, marginTop: spacing.xs, lineHeight: 18 },
  summary: { fontSize: fontSize.small, paddingVertical: spacing.md },
  action: { paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  actionText: { fontSize: fontSize.body, fontWeight: '500' },
  aboutHead: { paddingVertical: spacing.md },
  appName: { fontSize: fontSize.lead, fontWeight: '700' },
});
