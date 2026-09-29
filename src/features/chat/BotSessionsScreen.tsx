import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useServices } from '../../bootstrap/AppServices';
import type { SessionCreation } from '../../core/operations/sessionCreate';
import type { SessionRecord } from '../../data/local/conversationStore';
import { useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { relativeTime } from '../../ui/time';
import { useCreations } from './NewChatScreen';
import { useSessions } from './useConversation';

function SessionRow({ botId, session, active }: { botId: string; session: SessionRecord; active: boolean }) {
  const { colors } = useTheme();
  const { t } = useT();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/chat/[botId]/[sessionId]', params: { botId, sessionId: session.id } })}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderColor: colors.border }]}
    >
      <View>
        <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
        {active ? <View style={[styles.dot, { backgroundColor: colors.accent, borderColor: colors.surface }]} /> : null}
      </View>
      <View style={styles.flex}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>{session.title || t('common.untitledSession')}</Text>
        {session.updated_at ? <Text style={[styles.meta, { color: colors.textSubtle }]}>{relativeTime(session.updated_at)}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
    </Pressable>
  );
}

function CreationRow({ botId, creation }: { botId: string; creation: SessionCreation }) {
  const { colors } = useTheme();
  const { t } = useT();
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
      {failed ? <Ionicons name="alert-circle-outline" size={18} color={colors.danger} /> : <ActivityIndicator size="small" color={colors.textMuted} />}
      <View style={styles.flex}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>{creation.title}</Text>
        <Text style={[styles.meta, { color: failed ? colors.danger : colors.textSubtle }]}>
          {failed ? t('botSessions.creatingFailed') : t('botSessions.creating')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
    </Pressable>
  );
}

/**
 * One Bot's sessions, newest activity first. While the screen is open the
 * order stays put (SS-05): activity from the Bot's event stream marks rows
 * and shows a pill; tapping it re-reads the list and re-sorts.
 */
export function BotSessionsScreen({ botId }: { botId: string }) {
  const { colors } = useTheme();
  const { t, tn } = useT();
  const { events } = useServices();
  const { sessions, loaded, refreshing, error, hasMore, refresh, loadMore, reload } = useSessions(botId);
  const creations = useCreations().filter((c) => c.botId === botId);
  const open = creations.filter((c) => c.status !== 'created');
  const createdCount = creations.length - open.length;
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());

  // A session created here (or elsewhere in the app) shows up without a pull.
  useFocusEffect(
    useCallback(() => {
      setActive(new Set());
      void reload();
    }, [reload]),
  );
  useEffect(() => {
    if (createdCount > 0) void reload();
  }, [createdCount, reload]);

  useFocusEffect(
    useCallback(
      () =>
        events.subscribe(botId, (activity) => {
          if (activity.type === 'resync') return;
          setActive((prev) => (prev.has(activity.sessionId) ? prev : new Set(prev).add(activity.sessionId)));
        }),
      [events, botId],
    ),
  );

  const update = async () => {
    setActive(new Set());
    await refresh();
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <SessionRow botId={botId} session={item} active={active.has(item.id)} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void update()} colors={[colors.accent]} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={{ gap: spacing.sm, marginBottom: open.length || error ? spacing.sm : 0 }}>
            {error ? <Text style={[styles.error, { color: colors.warning }]}>{t('common.cachedError', { error })}</Text> : null}
            {open.map((c) => (
              <CreationRow key={c.requestId} botId={botId} creation={c} />
            ))}
          </View>
        }
        ListFooterComponent={hasMore ? <ActivityIndicator style={styles.footer} color={colors.textMuted} /> : null}
        ListEmptyComponent={
          loaded && !refreshing && open.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={[styles.empty, { color: colors.textMuted }]}>{t('botSessions.empty')}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/chat/[botId]/new', params: { botId } })}
                style={[styles.emptyButton, { backgroundColor: colors.accent }]}
              >
                <Text style={[styles.emptyButtonText, { color: colors.accentText }]}>{t('botSessions.start')}</Text>
              </Pressable>
            </View>
          ) : null
        }
      />
      {active.size > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLiveRegion="polite"
          onPress={() => void update()}
          style={[styles.pill, { backgroundColor: colors.accent }]}
        >
          <Ionicons name="arrow-up" size={14} color={colors.accentText} />
          <Text style={[styles.pillText, { color: colors.accentText }]}>{tn('botSessions.newActivity', active.size)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { position: 'absolute', top: -3, right: -4, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  title: { fontSize: fontSize.body, fontWeight: '500', lineHeight: 22 },
  meta: { fontSize: fontSize.caption, marginTop: 2 },
  error: { fontSize: fontSize.small, marginBottom: spacing.sm },
  footer: { marginVertical: spacing.lg },
  empty: { fontSize: fontSize.body, textAlign: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.lg, marginTop: spacing.xxl },
  emptyButton: { borderRadius: radius.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  emptyButtonText: { fontSize: fontSize.body, fontWeight: '600' },
  pill: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    elevation: 3,
  },
  pillText: { fontSize: fontSize.small, fontWeight: '600' },
});
