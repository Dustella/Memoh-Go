import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';

function formatDateTime(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: colors.border }]}>
      <Text style={[styles.rowLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text selectable numberOfLines={1} style={[styles.rowValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export function ManagementScreen() {
  const { colors } = useTheme();
  const { access } = useServices();
  const state = useAccessState();
  const [signingOut, setSigningOut] = useState(false);
  if (state.kind !== 'signed_in') return null;
  const { connection, credential } = state.session;

  const confirmSignOut = () =>
    Alert.alert('退出登录？', '将删除本机保存的登录凭据、会话缓存、草稿和未发送的消息。服务端上的数据不受影响。', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          void access.signOut().finally(() => setSigningOut(false));
        },
      },
    ]);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.section, { color: colors.textMuted }]}>账号</Text>
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
        <Row label="服务地址" value={connection.deployment} />
        <Row label="服务端版本" value={connection.serverVersion || '未知'} />
        <Row label="登录有效至" value={formatDateTime(credential.expiresAt)} />
      </View>

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
        <Text style={[styles.signOutText, { color: colors.danger }]}>退出登录</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg },
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
  pressed: { opacity: 0.6 },
});
