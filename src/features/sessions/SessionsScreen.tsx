import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { BotRecord } from '../../data/local/conversationStore';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { useBots } from './useBots';

function initials(name: string) {
  const trimmed = name.trim();
  return (trimmed.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
}

function BotRow({ bot }: { bot: BotRecord }) {
  const { colors } = useTheme();
  const name = bot.display_name || bot.name || bot.id;
  const ready = bot.is_active !== false && (bot.status ?? 'ready') === 'ready';
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
        <Text style={[styles.avatarText, { color: colors.accent }]}>{initials(name)}</Text>
      </View>
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>{name}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: ready ? colors.success : colors.textSubtle }]} />
          <Text style={[styles.status, { color: colors.textMuted }]}>
            {bot.is_active === false ? '已停用' : ready ? '可用' : bot.status}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
    </View>
  );
}

export function SessionsScreen() {
  const { colors } = useTheme();
  const { bots, loaded, refreshing, error, refresh } = useBots();

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={bots}
        keyExtractor={(bot) => bot.id}
        renderItem={({ item }) => <BotRow bot={item} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.accent]} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.section, { color: colors.textMuted }]}>Bots</Text>
            {error ? (
              <Text style={[styles.error, { color: colors.warning }]}>无法刷新，显示的是本机缓存：{error}</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loaded && !refreshing ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>这个账号还没有可访问的 Bot。</Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.lg },
  header: { marginBottom: spacing.sm },
  section: { fontSize: fontSize.small, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  error: { fontSize: fontSize.small, marginTop: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.lead, fontWeight: '700' },
  name: { fontSize: fontSize.body, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  status: { fontSize: fontSize.small },
  empty: { fontSize: fontSize.body, textAlign: 'center', marginTop: spacing.xxl },
});
