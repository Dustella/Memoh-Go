import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useServices } from '../../bootstrap/AppServices';
import type { SessionCreation } from '../../core/operations/sessionCreate';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { Composer } from './components/Composer';

/** Draft key for the composer of a chat that has no server session yet. */
export const NEW_CHAT_DRAFT = '__new__';

export function useCreations(): readonly SessionCreation[] {
  const { creator } = useServices();
  return useSyncExternalStore(creator.subscribe, creator.getSnapshot);
}

function statusText(c: SessionCreation) {
  switch (c.status) {
    case 'pending':
    case 'creating':
      return '正在创建会话…';
    case 'unknown':
      return '网络不稳定，正在确认会话是否已创建…';
    case 'failed':
      return `创建失败：${c.lastError ?? '未知错误'}`;
    default:
      return '';
  }
}

/**
 * New chat: the first message creates the session (contracts/u5) and then
 * goes out through the Outbox. Opening an unfinished intent from the session
 * list shows its progress here.
 */
export function NewChatScreen({ botId, requestId: initialRequest }: { botId: string; requestId?: string }) {
  const { colors } = useTheme();
  const { creator } = useServices();
  const creations = useCreations();
  const [requestId, setRequestId] = useState(initialRequest);
  const [error, setError] = useState<string | null>(null);
  const creation = requestId ? creations.find((c) => c.requestId === requestId) : undefined;

  useEffect(() => {
    if (creation?.status === 'created' && creation.sessionId) {
      router.replace({ pathname: '/chat/[botId]/[sessionId]', params: { botId, sessionId: creation.sessionId } });
    }
  }, [creation?.status, creation?.sessionId, botId]);

  const send = (text: string) => {
    setError(null);
    creator.create(botId, text).then(
      (c) => setRequestId(c.requestId),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {creation ? (
        <View style={styles.flex}>
          <View style={styles.userRow}>
            <View style={[styles.userBubble, { backgroundColor: colors.userBubble }]}>
              <Text selectable style={[styles.userText, { color: colors.userBubbleText }]}>{creation.firstMessage}</Text>
            </View>
            <View style={styles.meta}>
              {creation.status === 'failed' ? (
                <>
                  <Text style={[styles.metaText, { color: colors.danger }]} numberOfLines={2}>{statusText(creation)}</Text>
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void creator.retry(creation.requestId)}>
                    <Text style={[styles.metaAction, { color: colors.accent }]}>重试</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => void creator.discard(creation.requestId).then(() => router.back())}
                  >
                    <Text style={[styles.metaAction, { color: colors.textMuted }]}>删除</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <ActivityIndicator size="small" color={colors.textMuted} />
                  <Text style={[styles.metaText, { color: creation.status === 'unknown' ? colors.warning : colors.textSubtle }]}>
                    {statusText(creation)}
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>
      ) : (
        <View style={[styles.flex, styles.center]}>
          <Ionicons name="sparkles-outline" size={28} color={colors.textSubtle} />
          <Text style={[styles.hint, { color: colors.textMuted }]}>新的会话</Text>
          <Text style={[styles.subHint, { color: colors.textSubtle }]}>第一条消息会作为会话标题</Text>
          {error ? <Text style={[styles.subHint, { color: colors.danger }]}>{error}</Text> : null}
        </View>
      )}

      {creation ? null : <Composer botId={botId} draftKey={NEW_CHAT_DRAFT} autoFocus onSend={send} />}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.xl },
  hint: { fontSize: fontSize.body, fontWeight: '600', marginTop: spacing.sm },
  subHint: { fontSize: fontSize.small, textAlign: 'center' },
  userRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '85%',
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: { fontSize: fontSize.body, lineHeight: 23 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs, maxWidth: '85%' },
  metaText: { fontSize: fontSize.caption, flexShrink: 1 },
  metaAction: { fontSize: fontSize.caption, fontWeight: '600' },
});
