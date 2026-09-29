import Ionicons from '@expo/vector-icons/Ionicons';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { isRunActive } from '../../core/conversation/types';
import type { OutboxEntry } from '../../core/operations/outbox';
import { MarkdownBlockView } from '../../ui/markdown/MarkdownBlockView';
import { KeyboardAware } from '../../ui/components/KeyboardAware';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { chatStatus, type StatusAction } from './chatStatus';
import { Composer } from './components/Composer';
import { MessageMenu } from './components/MessageMenu';
import { StatusStrip } from './components/StatusStrip';
import { QuestionCard, ToolRow, type DecisionActions } from './components/DecisionCards';
import { composeRows, copyChoices, type ChatRow, type ControlView, type CopyChoice, type PendingSend } from './turnRows';
import { useHistory } from './useConversation';
import { useLiveSession } from './useLiveSession';
import { useReadingAnchor, useRememberChat } from './usePagePersistence';

/** Within this distance of the end the reader counts as "at the newest message". */
const AT_BOTTOM_SLACK_PX = 80;

const WORKING_LABEL: Record<string, string> = {
  admitting: '准备中',
  running: '正在回复',
  waiting_decision: '等待你的确认',
  aborting: '正在停止',
  finishing: '收尾中',
};

function Reasoning({ text, durationMs, onLongPress }: { text: string; durationMs?: number; onLongPress: () => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const label = durationMs ? `思考了 ${Math.max(1, Math.round(durationMs / 1000))} 秒` : '思考过程';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((v) => !v)}
      delayLongPress={LONG_PRESS_MS}
      onLongPress={onLongPress}
    >
      <View style={styles.chipRow}>
        <Ionicons name="bulb-outline" size={14} color={colors.textMuted} />
        <Text style={[styles.chipText, { color: colors.textMuted }]}>{label}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSubtle} />
      </View>
      {open ? (
        <Text style={[styles.reasoning, { color: colors.textMuted, borderLeftColor: colors.border }]}>{text}</Text>
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

type RowActions = DecisionActions &
  Readonly<{
    resend: (invocationId: string) => void;
    discard: (invocationId: string) => void;
    retry: (invocationId: string) => void;
    /** Long-press: open the copy menu for this row (CH-12). */
    menu: (row: ChatRow) => void;
  }>;

const LONG_PRESS_MS = 350;

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
          <Pressable
            delayLongPress={LONG_PRESS_MS}
            onLongPress={() => actions.menu(row)}
            accessibilityHint="长按可复制"
            style={[styles.userBubble, { backgroundColor: colors.userBubble }]}
          >
            <Text style={[styles.userText, { color: colors.userBubbleText }]}>{row.text}</Text>
            {row.attachments > 0 ? (
              <Text style={[styles.userMeta, { color: colors.textMuted }]}>附件 {row.attachments} 个</Text>
            ) : null}
          </Pressable>
        </View>
      );
    case 'pending': {
      const tone = row.state === 'failed' ? colors.danger : row.state === 'unsure' ? colors.warning : colors.textSubtle;
      return (
        <View style={styles.userRow}>
          <Pressable
            delayLongPress={LONG_PRESS_MS}
            onLongPress={() => actions.menu(row)}
            style={[styles.userBubble, { backgroundColor: colors.userBubble, opacity: row.state === 'sending' ? 0.7 : 1 }]}
          >
            <Text style={[styles.userText, { color: colors.userBubbleText }]}>{row.text}</Text>
          </Pressable>
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
      return <Working status={row.stopping ? 'aborting' : row.status} />;
    case 'markdown':
      return (
        <Pressable delayLongPress={LONG_PRESS_MS} onLongPress={() => actions.menu(row)} style={[styles.assistant, top]}>
          <MarkdownBlockView source={row.source} />
        </Pressable>
      );
    case 'reasoning':
      return (
        <View style={[styles.assistant, top]}>
          <Reasoning text={row.text} durationMs={row.durationMs} onLongPress={() => actions.menu(row)} />
        </View>
      );
    case 'tool':
      return (
        <View style={[styles.assistant, top]}>
          <ToolRow key={row.key} row={row} actions={actions} />
        </View>
      );
    case 'question':
      return (
        <View style={[styles.assistant, top]}>
          <QuestionCard key={row.request.user_input_id} row={row} actions={actions} />
        </View>
      );
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

export function ChatScreen({ botId, sessionId }: { botId: string; sessionId: string }) {
  const { colors } = useTheme();
  const history = useHistory(botId, sessionId);
  const { live, snapshot } = useLiveSession(botId, sessionId);
  const running = Boolean(snapshot.run && isRunActive(snapshot.run.status));
  const stopping =
    snapshot.run?.status === 'aborting' ||
    snapshot.controls.some((c) => c.kind === 'abort' && c.runId === snapshot.run?.run_id && (c.status === 'sending' || c.status === 'sent' || c.status === 'applied'));

  const rows = useMemo(() => {
    const pending = [...snapshot.pending, ...snapshot.failed].map(toPending);
    const controls = new Map<string, ControlView>();
    for (const c of snapshot.controls) if (c.decisionId) controls.set(c.decisionId, { status: c.status, code: c.code });
    const body = composeRows({ history: history.turns, run: snapshot.run, pending, controls, stopping });
    if (body.length === 0) return body;
    const state = !history.checkpoint?.hasOlder ? 'beginning' : history.loadingOlder ? 'loading' : 'more';
    return [{ kind: 'edge', key: 'edge', turnId: '', state } as const, ...body];
  }, [history.turns, history.checkpoint?.hasOlder, history.loadingOlder, snapshot, stopping]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [menu, setMenu] = useState<CopyChoice[] | null>(null);

  const actions = useMemo<RowActions>(
    () => ({
      resend: (id) => void live.confirmResend(id),
      discard: (id) => void live.discard(id),
      retry: (id) => void live.retryFailed(id),
      approve: (id, decision, optionId) => void live.respondApproval(id, decision, optionId),
      answer: (id, response) => void live.respondUserInput(id, response),
      menu: (row) => {
        const choices = copyChoices(rowsRef.current, row);
        if (choices.length > 0) setMenu(choices);
      },
    }),
    [live],
  );
  const renderItem = useCallback(({ item }: { item: ChatRow }) => <Row row={item} actions={actions} />, [actions]);

  useRememberChat(botId, sessionId);
  const { anchor, update: saveAnchor } = useReadingAnchor(botId, sessionId);
  const listRef = useRef<LegendListRef>(null);

  // Decided once, when the list first mounts: later rows must not move the reader.
  const initialScroll = useRef<{ initialScrollAtEnd: true } | { initialScrollIndex: { index: number; viewOffset: number } } | null>(null);
  if (initialScroll.current === null && anchor !== undefined && history.loaded && rows.length > 0) {
    const index = anchor && !anchor.atBottom ? rows.findIndex((r) => r.key === anchor.rowKey) : -1;
    // An anchor row outside the cached window (or gone) falls back to the newest message.
    initialScroll.current =
      index >= 0 && anchor && !anchor.atBottom
        ? { initialScrollIndex: { index, viewOffset: -anchor.offsetPx } }
        : { initialScrollAtEnd: true };
  }

  const onScroll = useCallback(() => {
    const state = listRef.current?.getState();
    if (!state || state.data.length === 0) return;
    const fromEnd = state.contentLength - (state.scroll + state.scrollLength);
    if (state.isAtEnd || fromEnd < AT_BOTTOM_SLACK_PX) {
      saveAnchor({ atBottom: true });
      return;
    }
    const index = Math.max(0, state.start);
    const row = state.data[index] as ChatRow | undefined;
    if (!row || row.kind === 'edge') return;
    saveAnchor({ atBottom: false, turnId: row.turnId || row.key, rowKey: row.key, offsetPx: Math.max(0, state.scroll - state.positionAtIndex(index)) });
  }, [saveAnchor]);

  const status = useMemo(
    () =>
      chatStatus({
        socket: snapshot.socket,
        live: snapshot.live,
        historyLoaded: history.loaded,
        historyError: history.error,
        pending: snapshot.pending,
        failed: snapshot.failed,
        controls: snapshot.controls,
      }),
    [snapshot, history.loaded, history.error],
  );
  const refreshHistory = history.refresh;
  const onStatusAction = useCallback((action: StatusAction) => {
    if (action === 'retry_sync') void refreshHistory();
  }, [refreshHistory]);

  return (
    <KeyboardAware style={[styles.flex, { backgroundColor: colors.background }]}>
      <StatusStrip lines={status} onAction={onStatusAction} />

      {history.loaded && rows.length === 0 && !history.syncing ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>还没有消息，说点什么吧。</Text>
        </View>
      ) : !history.loaded || anchor === undefined || (rows.length === 0 && history.syncing) ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <LegendList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          extraData={actions}
          estimatedItemSize={80}
          recycleItems
          alignItemsAtEnd
          {...initialScroll.current}
          maintainScrollAtEnd
          maintainVisibleContentPosition
          onScroll={onScroll}
          scrollEventThrottle={100}
          onStartReached={() => void history.loadOlder()}
          onStartReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: spacing.lg }}
        />
      )}

      <Composer
        botId={botId}
        draftKey={sessionId}
        running={running}
        onSend={(text) => {
          void live.send(text);
          // Sending means "take me to the newest message", even when reading older history.
          requestAnimationFrame(() => void listRef.current?.scrollToEnd({ animated: true }));
        }}
        onStop={() => live.abort()}
      />
      <MessageMenu choices={menu} onClose={() => setMenu(null)} />
    </KeyboardAware>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: fontSize.body },
  headerRow: { height: 48, alignItems: 'center', justifyContent: 'center' },
  beginning: { fontSize: fontSize.caption, textAlign: 'center', paddingVertical: spacing.lg },
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
  notice: { fontSize: fontSize.small, lineHeight: 20 },
});
