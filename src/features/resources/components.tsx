import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { EnvState } from '../../core/resources/environment';
import type { MessageKey } from '../../core/i18n';
import { useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme, type Palette } from '../../ui/theme';

export function envColor(colors: Palette, state: EnvState) {
  if (state === 'online') return colors.success;
  if (state === 'offline' || state === 'unknown') return colors.textSubtle;
  if (state === 'forbidden') return colors.textMuted;
  return colors.warning;
}

export function EnvBadge({ state }: { state: EnvState }) {
  const { colors } = useTheme();
  const { t } = useT();
  const color = envColor(colors, state);
  return (
    <View style={styles.badge}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color: state === 'online' ? colors.textMuted : color }]}>{t(`env.${state}` as MessageKey)}</Text>
    </View>
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{title}</Text>
        {right}
      </View>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

export function ListRow({
  icon,
  title,
  subtitle,
  right,
  onPress,
  first,
  accessibilityLabel,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={colors.textMuted} /> : null}
      <View style={styles.flex}>
        <Text numberOfLines={2} style={[styles.rowTitle, { color: colors.text }]}>{title}</Text>
        {subtitle ? <Text numberOfLines={2} style={[styles.rowSub, { color: colors.textSubtle }]}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} /> : null}
    </Pressable>
  );
}

export function Placeholder({ loading, text }: { loading?: boolean; text?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.placeholder}>
      {loading ? <ActivityIndicator color={colors.textMuted} /> : <Text style={[styles.placeholderText, { color: colors.textMuted }]}>{text}</Text>}
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { marginTop: spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionTitle: { fontSize: fontSize.small, fontWeight: '600', letterSpacing: 0.3 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  rowTitle: { fontSize: fontSize.body },
  rowSub: { fontSize: fontSize.caption, marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: fontSize.small },
  placeholder: { padding: spacing.xl, alignItems: 'center' },
  placeholderText: { fontSize: fontSize.small, textAlign: 'center' },
});
