import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import type { SessionCreation } from '../../core/operations/sessionCreate';
import type { SessionRecord } from '../../data/local/conversationStore';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { relativeTime } from '../../ui/time';
import { useCreations } from './NewChatScreen';
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

function CreationRow({ botId, creation }: { botId: string; creation: SessionCreation }) {
  const { colors } = useTheme();
  const failed = creation.status === 'failed';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/chat/[botId]/new', params: { botId, request: creation.requestId } })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderColor: failed ? colors.danger : colors.border },
      ]}
    >
      {failed ? (
        <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
      ) : (
        <ActivityIndicator size="small" color={colors.textMuted} />
      )}
      <View style={styles.flex}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>{creation.title}</Text>
        <Text style={[styles.meta, { color: failed ? colors.danger : colors.textSubtle }]}>
          {failed ? '创建失败，点按处理' : '正在创建…'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
    </Pressable>
  );
}

export function BotSessionsScreen({ botId }: { botId: string }) {
  const { colors } = useTheme();
  const { sessions, loaded, refreshing, error, hasMore, refresh, loadMore, reload } = useSessions(botId);
  const creations = useCreations().filter((c) => c.botId === botId);
  const open = creations.filter((c) => c.status !== 'created');
  const createdCount = creations.length - open.length;

  // A session created here (or elsewhere in the app) shows up without a pull.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  useEffect(() => {
    if (createdCount > 0) void reload();
  }, [createdCount, reload]);

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
        <View style={{ gap: spacing.sm, marginBottom: open.length || error ? spacing.sm : 0 }}>
          {error ? <Text style={[styles.error, { color: colors.warning }]}>无法刷新，显示的是本机缓存：{error}</Text> : null}
          {open.map((c) => (
            <CreationRow key={c.requestId} botId={botId} creation={c} />
          ))}
        </View>
      }
      ListFooterComponent={hasMore ? <ActivityIndicator style={styles.footer} color={colors.textMuted} /> : null}
      ListEmptyComponent={
        loaded && !refreshing && open.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={[styles.empty, { color: colors.textMuted }]}>还没有会话。</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/chat/[botId]/new', params: { botId } })}
              style={[styles.emptyButton, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.emptyButtonText, { color: colors.accentText }]}>开始新会话</Text>
            </Pressable>
          </View>
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
  empty: { fontSize: fontSize.body, textAlign: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.lg, marginTop: spacing.xxl },
  emptyButton: { borderRadius: radius.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  emptyButtonText: { fontSize: fontSize.body, fontWeight: '600' },
});
