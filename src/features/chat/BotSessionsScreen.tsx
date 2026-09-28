import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import type { SessionRecord } from '../../data/local/conversationStore';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { relativeTime } from '../../ui/time';
import { useSessions } from './useConversation';

function SessionRow({ botId, session }: { botId: string; session: SessionRecord }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/chat/[botId]/[sessionId]', params: { botId, sessionId: session.id } })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderColor: colors.border },
      ]}
    >
      <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
      <View style={styles.flex}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>{session.title || '未命名会话'}</Text>
        {session.updated_at ? (
          <Text style={[styles.meta, { color: colors.textSubtle }]}>{relativeTime(session.updated_at)}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
    </Pressable>
  );
}

export function BotSessionsScreen({ botId }: { botId: string }) {
  const { colors } = useTheme();
  const { sessions, loaded, refreshing, error, hasMore, refresh, loadMore } = useSessions(botId);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={sessions}
      keyExtractor={(s) => s.id}
      renderItem={({ item }) => <SessionRow botId={botId} session={item} />}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.accent]} />}
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={
        error ? <Text style={[styles.error, { color: colors.warning }]}>无法刷新，显示的是本机缓存：{error}</Text> : null
      }
      ListFooterComponent={hasMore ? <ActivityIndicator style={styles.footer} color={colors.textMuted} /> : null}
      ListEmptyComponent={
        loaded && !refreshing ? (
          <Text style={[styles.empty, { color: colors.textMuted }]}>还没有会话。</Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: fontSize.body, fontWeight: '500', lineHeight: 22 },
  meta: { fontSize: fontSize.caption, marginTop: 2 },
  error: { fontSize: fontSize.small, marginBottom: spacing.sm },
  footer: { marginVertical: spacing.lg },
  empty: { fontSize: fontSize.body, textAlign: 'center', marginTop: spacing.xxl },
});
