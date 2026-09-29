import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useServices } from '../../bootstrap/AppServices';
import type { AlertKind } from '../../core/home/alerts';
import type { MessageKey } from '../../core/i18n';
import { useT } from '../preferences';
import { fontSize, radius, spacing, useTheme } from '../theme';

const TEXT: Record<AlertKind, MessageKey> = {
  approval: 'alert.approval',
  question: 'alert.question',
  send_failed: 'alert.sendFailed',
  failed: 'alert.failed',
  completed: 'alert.completed',
};
const ICON: Record<AlertKind, keyof typeof Ionicons.glyphMap> = {
  approval: 'shield-checkmark-outline',
  question: 'help-circle-outline',
  send_failed: 'alert-circle-outline',
  failed: 'alert-circle-outline',
  completed: 'checkmark-circle-outline',
};
const VISIBLE_MS = 6_000;

/** NT-01: one foreground banner at the top of the app; tap opens the chat at its newest message. */
export function InAppAlertHost() {
  const { alerts } = useServices();
  const { colors } = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const alert = useSyncExternalStore(alerts.subscribe, alerts.getCurrent);

  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => alerts.dismiss(), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [alert, alerts]);

  if (!alert) return null;
  const urgent = alert.kind !== 'completed';
  const tint = alert.kind === 'failed' || alert.kind === 'send_failed' ? colors.danger : urgent ? colors.warning : colors.success;
  const open = () => {
    alerts.dismiss();
    router.push({ pathname: '/chat/[botId]/[sessionId]', params: { botId: alert.botId, sessionId: alert.sessionId, focus: 'latest' } });
  };
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + spacing.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${t(TEXT[alert.kind], { bot: alert.botName })}, ${alert.title}`}
        onPress={open}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Ionicons name={ICON[alert.kind]} size={20} color={tint} />
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{t(TEXT[alert.kind], { bot: alert.botName })}</Text>
          <Text numberOfLines={1} style={[styles.sub, { color: colors.textMuted }]}>{alert.title || t('common.untitledSession')}</Text>
        </View>
        <Text style={[styles.open, { color: colors.accent }]}>{t('alert.open')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('alert.dismiss')} hitSlop={10} onPress={() => alerts.dismiss()}>
          <Ionicons name="close" size={18} color={colors.textSubtle} />
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: spacing.md, right: spacing.md, zIndex: 100 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  flex: { flex: 1 },
  title: { fontSize: fontSize.body, fontWeight: '600' },
  sub: { fontSize: fontSize.small, marginTop: 2 },
  open: { fontSize: fontSize.small, fontWeight: '600' },
});
