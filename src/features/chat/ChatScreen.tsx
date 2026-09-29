import Ionicons from '@expo/vector-icons/Ionicons';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useFocusEffect } from 'expo-router';
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
import { useServices } from '../../bootstrap/AppServices';
import { t, tn, type MessageKey } from '../../core/i18n';
import type { OutboxEntry } from '../../core/operations/outbox';
import { MarkdownBlockView } from '../../ui/markdown/MarkdownBlockView';
import { KeyboardAware } from '../../ui/components/KeyboardAware';
import { useLocale, useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { chatStatus, type StatusAction } from './chatStatus';
import { Composer } from './components/Composer';
import { MessageMenu } from './components/MessageMenu';
import { QueueBar } from './components/QueueBar';
import { StatusStrip } from './components/StatusStrip';
import type { QueueMode } from '../../application/conversation/sessionQueue';
import { useSessionQueue } from './useSessionQueue';
import { QuestionCard, ToolRow, type DecisionActions } from './components/DecisionCards';
import { composeRows, copyChoices, historyRows, type ChatRow, type ControlView, type CopyChoice, type PendingSend } from './turnRows';
import { useHistory } from './useConversation';
import { useLiveSession } from './useLiveSession';
import { useMarkSeen, useReadingAnchor, useRememberChat } from './usePagePersistence';

/** Within this distance of the end the reader counts as "at the newest message". */
const AT_BOTTOM_SLACK_PX = 80;

const WORKING_LABEL: Record<string, MessageKey> = {
  admitting: 'phase.admitting',
  running: 'phase.running',
  waiting_decision: 'chat.waitingYourDecision',
  aborting: 'phase.aborting',
  finishing: 'phase.finishing',
};

function Reasoning({ text, durationMs, onLongPress }: { text: string; durationMs?: number; onLongPress: () => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const label = durationMs ? t('chat.thoughtFor', { seconds: Math.max(1, Math.round(durationMs / 1000)) }) : t('chat.thinking');
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
      <Text style={[styles.chipText, { color: colors.textMuted }]}>{t(WORKING_LABEL[status] ?? 'chat.working')}</Text>
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
  useT();
  const top = 'first' in row && row.first ? styles.turnStart : null;
  switch (row.kind) {
    case 'edge':
      return row.state === 'beginning' ? (
        <Text style={[styles.beginning, { color: colors.textSubtle }]}>{t('chat.beginning')}</Text>
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
            accessibilityHint={t('chat.longPressToCopy')}
            style={[styles.userBubble, { backgroundColor: colors.userBubble }]}
          >
            <Text style={[styles.userText, { color: colors.userBubbleText }]}>{row.text}</Text>
            {row.attachments > 0 ? (
              <Text style={[styles.userMeta, { color: colors.textMuted }]}>{tn('chat.attachments', row.attachments)}</Text>
            ) : null}
          </Pressable>
          {row.steer ? (
            <View style={styles.pendingMeta}>
              <Ionicons name="git-merge-outline" size={12} color={colors.textSubtle} />
              <Text style={[styles.metaText, { color: colors.textSubtle }]}>{t('queue.steerApplied')}</Text>
            </View>
          ) : null}
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
              <Text style={[styles.metaText, { color: tone }]}>{t('chat.sending')}</Text>
            ) : (
              <>
                <Text style={[styles.metaText, { color: tone }]}>{row.state === 'failed' ? t('chat.sendFailed') : t('chat.sendUnsure')}</Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => (row.state === 'failed' ? actions.retry : actions.resend)(row.invocationId)}
                >
                  <Text style={[styles.metaAction, { color: colors.accent }]}>{t('chat.resend')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => actions.discard(row.invocationId)}>
                  <Text style={[styles.metaAction, { color: colors.textMuted }]}>{row.state === 'failed' ? t('common.delete') : t('common.discard')}</Text>
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
            <Text style={[styles.chipText, { color: colors.textMuted }]}>{tn('chat.attachments', row.count)}</Text>
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

export function ChatScreen({ botId, sessionId, focusLatest = false }: { botId: string; sessionId: string; focusLatest?: boolean }) {
  const { colors } = useTheme();
  const locale = useLocale();
  const history = useHistory(botId, sessionId);
  const { live, snapshot } = useLiveSession(botId, sessionId);
  const running = Boolean(snapshot.run && isRunActive(snapshot.run.status));
  const stopping =
    snapshot.run?.status === 'aborting' ||
    snapshot.controls.some((c) => c.kind === 'abort' && c.runId === snapshot.run?.run_id && (c.status === 'sending' || c.status === 'sent' || c.status === 'applied'));
  const runKey = `${snapshot.run?.run_id ?? ''}:${snapshot.run?.status ?? ''}:${snapshot.run?.steer_turns?.length ?? 0}:${snapshot.run?.user_turns?.length ?? 0}`;
  const { queue, view: queueView } = useSessionQueue(botId, sessionId, runKey);
  const [queueMode, setQueueMode] = useState<QueueMode>('follow_up');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- locale: row text is translated
  const persistedRows = useMemo(() => historyRows(history.turns), [history.turns, locale]);
  const rows = useMemo(() => {
    const pending = [...snapshot.pending, ...snapshot.failed].map(toPending);
    const controls = new Map<string, ControlView>();
    for (const c of snapshot.controls) if (c.decisionId) controls.set(c.decisionId, { status: c.status, code: c.code });
    const body = composeRows({ history: history.turns, run: snapshot.run, pending, controls, stopping, persistedRows });
    if (body.length === 0) return body;
    const state = !history.checkpoint?.hasOlder ? 'beginning' : history.loadingOlder ? 'loading' : 'more';
    return [{ kind: 'edge', key: 'edge', turnId: '', state } as const, ...body];
    // Row text (notices, copy labels) is re-read when the language changes.
  }, [history.turns, history.checkpoint?.hasOlder, history.loadingOlder, snapshot, stopping, locale, persistedRows]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const latestRef = useRef<{ turnId: string; userText: string } | null>(null);
  // The latest turn as displayed: a just-finished live run counts before its history is re-read.
  const lastUserRow = [...rows].reverse().find((r): r is Extract<ChatRow, { kind: 'user' }> => r.kind === 'user' && !r.steer);
  latestRef.current = lastUserRow && lastUserRow.turnId ? { turnId: lastUserRow.turnId, userText: lastUserRow.text } : null;
  const runningRef = useRef(running);
  runningRef.current = running || snapshot.pending.length > 0;
  const [editing, setEditing] = useState<{ turnId: string; text: string; nonce: number } | null>(null);
  const [menu, setMenu] = useState<CopyChoice[] | null>(null);

  const actions = useMemo<RowActions>(
    () => ({
      resend: (id) => void live.confirmResend(id),
      discard: (id) => void live.discard(id),
      retry: (id) => void live.retryFailed(id),
      approve: (id, decision, optionId) => void live.respondApproval(id, decision, optionId),
      answer: (id, response) => void live.respondUserInput(id, response),
      menu: (row) => {
        const choices: CopyChoice[] = copyChoices(rowsRef.current, row);
        // CH-14: only the latest saved turn can be replaced, and not while a run is active.
        const latest = latestRef.current;
        if (latest && !runningRef.current && row.turnId === latest.turnId) {
          if (row.kind === 'markdown' || row.kind === 'reasoning' || row.kind === 'tool') {
            choices.push({ label: t('chat.menu.regenerate'), text: '', action: () => void live.send(latest.userText, { kind: 'retry', turnId: latest.turnId }) });
          } else if (row.kind === 'user') {
            choices.push({ label: t('chat.menu.edit'), text: '', action: () => setEditing({ turnId: latest.turnId, text: row.text, nonce: Date.now() }) });
          }
        }
        if (choices.length > 0) setMenu(choices);
      },
    }),
    [live],
  );
  const renderItem = useCallback(({ item }: { item: ChatRow }) => <Row row={item} actions={actions} />, [actions]);

  useRememberChat(botId, sessionId);
  useMarkSeen(botId, sessionId);
  const { alerts } = useServices();
  useFocusEffect(
    useCallback(() => {
      alerts.setViewing(botId, sessionId);
      return () => alerts.setViewing(null);
    }, [alerts, botId, sessionId]),
  );
  const { anchor, update: saveAnchor } = useReadingAnchor(botId, sessionId);
  const listRef = useRef<LegendListRef>(null);
  const atBottomRef = useRef(true);
  // When a run ends its live rows are replaced by saved history. A steered run
  // (CH-13) is saved in a different shape, which can move the list; a reader
  // who was following the reply stays at the newest message.
  const wasRunning = useRef(running);
  const followUntil = useRef(0);
  const refreshAfterRun = history.refresh;
  useEffect(() => {
    if (wasRunning.current && !running) {
      if (atBottomRef.current) followUntil.current = Date.now() + 3_000;
      // Swap the finished live copy for the saved turns (a steered or replaced
      // turn is saved in another shape), so later actions target real turns.
      void refreshAfterRun();
    }
    wasRunning.current = running;
    if (Date.now() > followUntil.current) return;
    const timer = setTimeout(() => void listRef.current?.scrollToEnd({ animated: false }), 150);
    return () => clearTimeout(timer);
  }, [running, rows, refreshAfterRun]);

  // Decided once, when the list first mounts: later rows must not move the reader.
  // Opened from a home "needs you" item: the decision is at the newest message.
  const initialScroll = useRef<{ initialScrollAtEnd: true } | { initialScrollIndex: { index: number; viewOffset: number } } | null>(null);
  if (initialScroll.current === null && anchor !== undefined && history.loaded && rows.length > 0) {
    const index = anchor && !anchor.atBottom && !focusLatest ? rows.findIndex((r) => r.key === anchor.rowKey) : -1;
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
    atBottomRef.current = state.isAtEnd || fromEnd < AT_BOTTOM_SLACK_PX;
    if (atBottomRef.current) {
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
    [snapshot, history.loaded, history.error, locale],
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
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('chat.empty')}</Text>
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

      <QueueBar
        view={queueView}
        running={running}
        mode={queueMode}
        onMode={setQueueMode}
        onCancel={(item) => void queue.cancel(item)}
        onPromote={(item) => void queue.promote(item)}
        onDismissNotice={() => queue.dismissNotice()}
      />
      <Composer
        botId={botId}
        draftKey={sessionId}
        running={running}
        busy={queueView.busy}
        prefill={editing ? { text: editing.text, nonce: editing.nonce } : undefined}
        editing={editing !== null}
        onCancelEdit={() => setEditing(null)}
        onSend={(text) => {
          const toEnd = () => requestAnimationFrame(() => void listRef.current?.scrollToEnd({ animated: true }));
          if (editing) {
            void live.send(text, { kind: 'edit', turnId: editing.turnId });
            setEditing(null);
            toEnd();
            return;
          }
          // While the Bot replies, a new message goes through the server queue (CH-13) when it has one.
          if (running && queueView.support !== 'no') {
            return queue.submit(queueMode, text).then((outcome) => {
              if (outcome.kind === 'returned') return 'restore' as const;
              if (outcome.kind === 'send_now') void live.send(text);
              toEnd();
              return 'sent' as const;
            });
          }
          void live.send(text);
          // Sending means "take me to the newest message", even when reading older history.
          toEnd();
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
