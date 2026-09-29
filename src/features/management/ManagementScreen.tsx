import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { OSS_DEFAULT_TEAM_ID } from '../../core/identity/credential';
import { MOCK_TEAM_ID } from '../../core/identity/teams';
import { useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';

export function formatDateTime(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InfoRow({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: colors.border }]}>
      <Text style={[styles.rowLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text selectable numberOfLines={wrap ? undefined : 1} style={[styles.rowValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export function LinkRow({ icon, label, value, href }: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string; href: Href }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.link, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={[styles.linkText, { color: colors.text }]}>{label}</Text>
      {value ? <Text numberOfLines={1} style={[styles.linkValue, { color: colors.textMuted }]}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
    </Pressable>
  );
}

export function teamName(teamId: string, t: ReturnType<typeof useT>['t']) {
  if (teamId === OSS_DEFAULT_TEAM_ID) return t('management.teamDefault');
  if (teamId === MOCK_TEAM_ID) return 'Research (mock)';
  return teamId;
}

export function ManagementScreen() {
  const { colors } = useTheme();
  const { t } = useT();
  const { access } = useServices();
  const state = useAccessState();
  const [signingOut, setSigningOut] = useState(false);
  if (state.kind !== 'signed_in') return null;
  const { connection, credential } = state.session;

  const confirmSignOut = () =>
    Alert.alert(t('management.signOutTitle'), t('management.signOutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('management.signOutConfirm'),
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          void access.signOut().finally(() => setSigningOut(false));
        },
      },
    ]);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.section, { color: colors.textMuted }]}>{t('management.account')}</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="person" size={20} color={colors.accent} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.name, { color: colors.text }]}>{connection.displayName}</Text>
            <Text style={[styles.sub, { color: colors.textMuted }]}>@{connection.username}</Text>
          </View>
        </View>
        <InfoRow label={t('management.server')} value={connection.deployment} />
        <InfoRow label={t('management.serverVersion')} value={connection.serverVersion || t('common.unknown')} />
        <InfoRow label={t('management.expires')} value={formatDateTime(credential.expiresAt)} />
      </View>

      <LinkRow icon="people-outline" label={t('management.team')} value={teamName(connection.teamId, t)} href="/team" />
      <View style={styles.gap} />
      <LinkRow icon="options-outline" label={t('nav.settings')} href="/settings" />
      <View style={styles.gap} />
      <LinkRow icon="pulse-outline" label={t('nav.diagnostics')} href="/diagnostics-log" />

      <Pressable
        accessibilityRole="button"
        disabled={signingOut}
        onPress={confirmSignOut}
        style={({ pressed }) => [
          styles.signOut,
          { backgroundColor: colors.surface, borderColor: colors.border },
          (pressed || signingOut) && styles.pressed,
        ]}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={[styles.signOutText, { color: colors.danger }]}>{t('management.signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  section: {
    fontSize: fontSize.small,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: fontSize.lead, fontWeight: '600' },
  sub: { fontSize: fontSize.small, marginTop: 2 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  rowLabel: { fontSize: fontSize.body },
  rowValue: { fontSize: fontSize.body, flexShrink: 1, textAlign: 'right' },
  gap: { height: spacing.sm },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  signOutText: { fontSize: fontSize.body, fontWeight: '600' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkText: { flex: 1, fontSize: fontSize.body },
  linkValue: { fontSize: fontSize.small, flexShrink: 1, maxWidth: '55%' },
  pressed: { opacity: 0.6 },
});
