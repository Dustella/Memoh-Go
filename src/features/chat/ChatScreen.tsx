import Ionicons from '@expo/vector-icons/Ionicons';
import { LegendList } from '@legendapp/list/react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { LiveSession } from '../../application/conversation/liveSession';
import { isRunActive } from '../../core/conversation/types';
import type { OutboxEntry } from '../../core/operations/outbox';
import { MarkdownBlockView } from '../../ui/markdown/MarkdownBlockView';
import { fontSize, monoFont, radius, spacing, useTheme } from '../../ui/theme';
import { composeRows, type ChatRow, type PendingSend } from './turnRows';
import { useHistory } from './useConversation';
import { useDraft, useLiveSession } from './useLiveSession';

const TOOL_LABEL = { running: '运行中', done: '已完成', failed: '失败', awaiting: '等待确认' } as const;
const WORKING_LABEL: Record<string, string> = {
  admitting: '准备中',
  running: '正在回复',
  waiting_decision: '等待你的确认',
  aborting: '正在停止',
  finishing: '收尾中',
};

function Reasoning({ text, durationMs }: { text: string; durationMs?: number }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const label = durationMs ? `思考了 ${Math.max(1, Math.round(durationMs / 1000))} 秒` : '思考过程';
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)}>
      <View style={styles.chipRow}>
        <Ionicons name="bulb-outline" size={14} color={colors.textMuted} />
        <Text style={[styles.chipText, { color: colors.textMuted }]}>{label}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSubtle} />
      </View>
      {open ? (
        <Text selectable style={[styles.reasoning, { color: colors.textMuted, borderLeftColor: colors.border }]}>{text}</Text>
      ) : null}
    </Pressable>
  );
}

function Working({ status }: { status: string }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={[styles.assistant, styles.chipRow]} accessibilityLiveRegion="polite">
      <Animated.View style={[styles.dot, { backgroundColor: colors.accent, opacity: pulse }]} />
      <Text style={[styles.chipText, { color: colors.textMuted }]}>{WORKING_LABEL[status] ?? '处理中'}</Text>
    </View>
  );
}

type RowActions = Readonly<{
  resend: (invocationId: string) => void;
  discard: (invocationId: string) => void;
  retry: (invocationId: string) => void;
}>;

const Row = memo(function Row({ row, actions }: { row: ChatRow; actions: RowActions }) {
  const { colors } = useTheme();
  const top = 'first' in row && row.first ? styles.turnStart : null;
  switch (row.kind) {
    case 'edge':
      return row.state === 'beginning' ? (
        <Text style={[styles.beginning, { color: colors.textSubtle }]}>会话开始</Text>
      ) : (
        <View style={styles.headerRow}>
          {row.state === 'loading' ? <ActivityIndicator color={colors.textMuted} /> : null}
        </View>
      );
    case 'user':
      return (
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: colors.userBubble }]}>
            <Text selectable style={[styles.userText, { color: colors.userBubbleText }]}>{row.text}</Text>
            {row.attachments > 0 ? (
              <Text style={[styles.userMeta, { color: colors.textMuted }]}>附件 {row.attachments} 个</Text>
            ) : null}
          </View>
        </View>
      );
    case 'pending': {
      const tone = row.state === 'failed' ? colors.danger : row.state === 'unsure' ? colors.warning : colors.textSubtle;
      return (
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: colors.userBubble, opacity: row.state === 'sending' ? 0.7 : 1 }]}>
            <Text selectable style={[styles.userText, { color: colors.userBubbleText }]}>{row.text}</Text>
          </View>
          <View style={styles.pendingMeta}>
            {row.state === 'sending' ? (
              <Text style={[styles.metaText, { color: tone }]}>发送中…</Text>
            ) : (
              <>
                <Text style={[styles.metaText, { color: tone }]}>{row.state === 'failed' ? '发送失败' : '可能未送达'}</Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => (row.state === 'failed' ? actions.retry : actions.resend)(row.invocationId)}
                >
                  <Text style={[styles.metaAction, { color: colors.accent }]}>重发</Text>
                </Pressable>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => actions.discard(row.invocationId)}>
                  <Text style={[styles.metaAction, { color: colors.textMuted }]}>{row.state === 'failed' ? '删除' : '放弃'}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      );
    }
    case 'working':
      return <Working status={row.status} />;
    case 'markdown':
      return (
        <View style={[styles.assistant, top]}>
          <MarkdownBlockView source={row.source} />
        </View>
      );
    case 'reasoning':
      return (
        <View style={[styles.assistant, top]}>
          <Reasoning text={row.text} durationMs={row.durationMs} />
        </View>
      );
    case 'tool': {
      const tone = row.state === 'failed' ? colors.danger : row.state === 'awaiting' ? colors.warning : colors.textMuted;
      return (
        <View style={[styles.assistant, top]}>
          <View style={[styles.tool, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons name="construct-outline" size={14} color={tone} />
            <Text numberOfLines={1} style={[styles.toolName, { color: colors.text, fontFamily: monoFont }]}>{row.name}</Text>
            <Text style={[styles.chipText, { color: tone }]}>{TOOL_LABEL[row.state]}</Text>
          </View>
        </View>
      );
    }
    case 'attachments':
      return (
        <View style={[styles.assistant, top]}>
          <View style={styles.chipRow}>
            <Ionicons name="attach" size={14} color={colors.textMuted} />
            <Text style={[styles.chipText, { color: colors.textMuted }]}>附件 {row.count} 个</Text>
          </View>
        </View>
      );
    case 'notice':
      return (
        <View style={[styles.assistant, top]}>
          <Text style={[styles.notice, { color: row.tone === 'error' ? colors.danger : colors.textMuted }]}>{row.text}</Text>
        </View>
      );
  }
});

function toPending(entry: OutboxEntry): PendingSend {
  const state = entry.status === 'failed' ? 'failed' : entry.status === 'unconfirmed' && entry.needsUser ? 'unsure' : 'sending';
  return { invocationId: entry.invocationId, text: entry.payload.text, turnId: entry.turnId, state };
}

function Composer({ live, botId, sessionId, running }: { live: LiveSession; botId: string; sessionId: string; running: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const draft = useDraft(botId, sessionId);
  const canSend = draft.text.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    const text = draft.text;
    draft.clear();
    void live.send(text);
  };

  return (
    <View
      style={[
        styles.composer,
        { borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      <TextInput
        value={draft.text}
        onChangeText={draft.update}
        editable={draft.ready}
        placeholder="发消息…"
        placeholderTextColor={colors.textSubtle}
        multiline
        accessibilityLabel="消息输入框"
        style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
      />
      {running && !canSend ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="停止回复"
          onPress={() => live.abort()}
          style={[styles.sendButton, { backgroundColor: colors.text }]}
        >
          <Ionicons name="stop" size={16} color={colors.background} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发送"
          disabled={!canSend}
          onPress={send}
          style={[styles.sendButton, { backgroundColor: canSend ? colors.accent : colors.surfaceMuted }]}
        >
          <Ionicons name="arrow-up" size={18} color={canSend ? colors.accentText : colors.textSubtle} />
        </Pressable>
      )}
    </View>
  );
}

export function ChatScreen({ botId, sessionId }: { botId: string; sessionId: string }) {
  const { colors } = useTheme();
  const history = useHistory(botId, sessionId);
  const { live, snapshot } = useLiveSession(botId, sessionId);
  const running = Boolean(snapshot.run && isRunActive(snapshot.run.status));

  const rows = useMemo(() => {
    const pending = [...snapshot.pending, ...snapshot.failed].map(toPending);
    const body = composeRows({ history: history.turns, run: snapshot.run, pending });
    if (body.length === 0) return body;
    const state = !history.checkpoint?.hasOlder ? 'beginning' : history.loadingOlder ? 'loading' : 'more';
    return [{ kind: 'edge', key: 'edge', turnId: '', state } as const, ...body];
  }, [history.turns, history.checkpoint?.hasOlder, history.loadingOlder, snapshot]);

  const actions = useMemo<RowActions>(
    () => ({
      resend: (id) => void live.confirmResend(id),
      discard: (id) => void live.discard(id),
      retry: (id) => void live.retryFailed(id),
    }),
    [live],
  );
  const renderItem = useCallback(({ item }: { item: ChatRow }) => <Row row={item} actions={actions} />, [actions]);

  const offline = snapshot.socket !== 'open' || history.error;
  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {offline && history.loaded ? (
        <View style={[styles.banner, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name={snapshot.socket === 'connecting' ? 'sync-outline' : 'cloud-offline-outline'} size={14} color={colors.warning} />
          <Text numberOfLines={2} style={[styles.bannerText, { color: colors.warning }]}>
            {snapshot.socket === 'connecting' ? '正在连接…' : '未连接，显示的是本机保存的内容。消息会在连接后发送。'}
          </Text>
        </View>
      ) : null}

      {history.loaded && rows.length === 0 && !history.syncing ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>还没有消息，说点什么吧。</Text>
        </View>
      ) : !history.loaded || (rows.length === 0 && history.syncing) ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <LegendList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          extraData={actions}
          estimatedItemSize={80}
          recycleItems
          alignItemsAtEnd
          initialScrollAtEnd
          maintainScrollAtEnd
          maintainVisibleContentPosition
          onStartReached={() => void history.loadOlder()}
          onStartReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: spacing.lg }}
        />
      )}

      <Composer live={live} botId={botId} sessionId={sessionId} running={running} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: fontSize.body },
  headerRow: { height: 48, alignItems: 'center', justifyContent: 'center' },
  beginning: { fontSize: fontSize.caption, textAlign: 'center', paddingVertical: spacing.lg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  bannerText: { flex: 1, fontSize: fontSize.small },
  userRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '85%',
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: { fontSize: fontSize.body, lineHeight: 23 },
  userMeta: { fontSize: fontSize.caption, marginTop: spacing.xs },
  pendingMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  metaText: { fontSize: fontSize.caption },
  metaAction: { fontSize: fontSize.caption, fontWeight: '600' },
  assistant: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  turnStart: { paddingTop: spacing.lg },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  chipText: { fontSize: fontSize.small },
  dot: { width: 8, height: 8, borderRadius: 4 },
  reasoning: { fontSize: fontSize.small, lineHeight: 20, borderLeftWidth: 2, paddingLeft: spacing.md, marginTop: spacing.xs },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toolName: { fontSize: fontSize.small, flexShrink: 1 },
  notice: { fontSize: fontSize.small, lineHeight: 20 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  input: {
    flex: 1,
    maxHeight: 140,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: spacing.lg,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: fontSize.body,
  },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
