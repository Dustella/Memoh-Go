import Ionicons from '@expo/vector-icons/Ionicons';
import { LegendList } from '@legendapp/list/react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MarkdownBlockView } from '../../ui/markdown/MarkdownBlockView';
import { fontSize, monoFont, radius, spacing, useTheme } from '../../ui/theme';
import { historyRows, type ChatRow } from './turnRows';
import { useHistory } from './useConversation';

const TOOL_LABEL = { running: '运行中', done: '已完成', failed: '失败', awaiting: '等待确认' } as const;

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

const Row = memo(function Row({ row }: { row: ChatRow }) {
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

export function ChatScreen({ botId, sessionId }: { botId: string; sessionId: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const history = useHistory(botId, sessionId);
  const rows = useMemo(() => {
    const body = historyRows(history.turns);
    if (body.length === 0) return body;
    const state = !history.checkpoint?.hasOlder ? 'beginning' : history.loadingOlder ? 'loading' : 'more';
    return [{ kind: 'edge', key: 'edge', turnId: '', state } as const, ...body];
  }, [history.turns, history.checkpoint?.hasOlder, history.loadingOlder]);
  const renderItem = useCallback(({ item }: { item: ChatRow }) => <Row row={item} />, []);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {history.error ? (
        <View style={[styles.banner, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="cloud-offline-outline" size={14} color={colors.warning} />
          <Text numberOfLines={2} style={[styles.bannerText, { color: colors.warning }]}>
            无法同步，显示的是本机保存的内容。
          </Text>
        </View>
      ) : null}

      {history.loaded && rows.length === 0 && !history.syncing ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>这个会话还没有消息。</Text>
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
          estimatedItemSize={80}
          recycleItems
          alignItemsAtEnd
          initialScrollAtEnd
          maintainScrollAtEnd
          maintainVisibleContentPosition
          onStartReached={() => void history.loadOlder()}
          onStartReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: spacing.lg }}
        />
      )}

      {/* Placeholder composer (read-only milestone): sending arrives with the Outbox worker. */}
      <View
        style={[
          styles.composer,
          { borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.sm },
        ]}
      >
        <View style={[styles.fakeInput, { backgroundColor: colors.surfaceMuted }]}>
          <Text style={[styles.fakeInputText, { color: colors.textSubtle }]}>只读预览 · 发送功能即将开放</Text>
        </View>
      </View>
    </View>
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
  assistant: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  turnStart: { paddingTop: spacing.lg },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  chipText: { fontSize: fontSize.small },
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
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  fakeInput: { borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  fakeInputText: { fontSize: fontSize.body },
});
