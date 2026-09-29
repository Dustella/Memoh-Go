import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Animated, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import type { HomeSnapshot } from '../../application/conversation/homeService';
import { useServices } from '../../bootstrap/AppServices';
import type { HomeItem, NeedsReason } from '../../core/home/home';
import { fontSize, radius, spacing, useTheme, type Palette } from '../../ui/theme';
import { relativeTime } from '../../ui/time';

type Kind = 'continue' | 'needs' | 'running' | 'new' | 'recent';
type Section = Readonly<{ kind: Kind; title: string; data: HomeItem[] }>;

const NEEDS_LABEL: Record<NeedsReason, string> = {
  approval: '等你批准',
  question: '等你回答',
  send_unsure: '消息可能未送达',
  send_failed: '消息发送失败',
  run_failed: '任务出错',
};

const PHASE_LABEL: Record<string, string> = {
  admitting: '准备中',
  running: '正在回复',
  waiting_decision: '等待确认',
  aborting: '正在停止',
  finishing: '收尾中',
};

function Pulse({ color }: { color: string }) {
  const value = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);
  return <Animated.View style={[styles.pulse, { backgroundColor: color, opacity: value }]} />;
}

function leading(kind: Kind, item: HomeItem, colors: Palette) {
  switch (kind) {
    case 'needs': {
      const error = item.reason === 'send_failed' || item.reason === 'run_failed';
      const icon = item.reason === 'approval' ? 'shield-checkmark-outline' : item.reason === 'question' ? 'help-circle-outline' : 'alert-circle-outline';
      const tint = error ? colors.danger : colors.warning;
      return (
        <View style={[styles.badge, { backgroundColor: tint + '22' }]}>
          <Ionicons name={icon} size={18} color={tint} />
        </View>
      );
    }
    case 'running':
      return (
        <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
          <Pulse color={colors.accent} />
        </View>
      );
    case 'continue':
      return (
        <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="return-down-forward" size={18} color={colors.accent} />
        </View>
      );
    case 'new':
      return (
        <View style={[styles.badge, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.text} />
          <View style={[styles.dot, { backgroundColor: colors.accent, borderColor: colors.surface }]} />
        </View>
      );
    default:
      return (
        <View style={[styles.badge, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
        </View>
      );
  }
}

function status(kind: Kind, item: HomeItem): string | null {
  if (kind === 'needs' && item.reason) return NEEDS_LABEL[item.reason];
  if (kind === 'running') return (item.phase && PHASE_LABEL[item.phase]) || '运行中';
  if (kind === 'new') return '有新回复';
  return null;
}

const Row = memo(function Row({ kind, item }: { kind: Kind; item: HomeItem }) {
  const { colors } = useTheme();
  const label = status(kind, item);
  const tone = kind === 'needs' ? (item.reason === 'send_failed' || item.reason === 'run_failed' ? colors.danger : colors.warning) : kind === 'running' ? colors.accent : colors.textMuted;
  const open = () =>
    router.push({
      pathname: '/chat/[botId]/[sessionId]',
      // Needs-you and running items open at the newest message, where the decision or live reply is.
      params: { botId: item.botId, sessionId: item.sessionId, ...(kind === 'needs' || kind === 'running' ? { focus: 'latest' } : {}) },
    });
  // A running session's updated_at is its last persisted message, not the live reply: leave it out.
  const time = item.updatedAt && kind !== 'running' ? relativeTime(item.updatedAt) : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.title, item.botName, label, time].filter(Boolean).join('，')}
      onPress={open}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderColor: colors.border }]}
    >
      {leading(kind, item, colors)}
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.text }, kind === 'new' && styles.bold]}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, { color: colors.textSubtle }]}>
          {item.botName}
          {label ? <Text style={{ color: tone }}>{` · ${label}`}</Text> : null}
          {item.cached && kind === 'running' ? ' · 上次状态' : ''}
          {time ? ` · ${time}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
    </Pressable>
  );
});

function useHome(): HomeSnapshot {
  const { home } = useServices();
  useFocusEffect(
    useCallback(() => {
      void home.activate();
      return () => home.deactivate();
    }, [home]),
  );
  return useSyncExternalStore(home.subscribe, home.getSnapshot);
}

/**
 * M3 home: what needs you, what is running, new results and recent chats
 * across every Bot. Live state comes from a capped set of watched sessions
 * (see HomeService); the footer says so when some rows are from cache.
 */
export function HomeScreen() {
  const { home } = useServices();
  const snap = useHome();
  return <HomeView snap={snap} onRefresh={() => void home.refresh()} />;
}

/** The home list for a snapshot; shared by the real screen and the dev preview. */
export function HomeView({ snap, onRefresh }: { snap: HomeSnapshot; onRefresh: () => void }) {
  const { colors } = useTheme();
  const { sections: s } = snap;

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    if (s.needsYou.length) out.push({ kind: 'needs', title: `等你处理 · ${s.needsYou.length}`, data: s.needsYou });
    if (s.running.length) out.push({ kind: 'running', title: `正在运行 · ${s.running.length}`, data: s.running });
    if (s.continueWith) out.push({ kind: 'continue', title: '继续上次的会话', data: [s.continueWith] });
    if (s.newResults.length) out.push({ kind: 'new', title: `新结果 · ${s.newResults.length}`, data: s.newResults });
    if (s.recent.length) out.push({ kind: 'recent', title: '最近会话', data: s.recent });
    return out;
  }, [s]);

  const calm = s.needsYou.length === 0 && s.running.length === 0;
  const empty = snap.loaded && sections.length === 0 && !snap.refreshing;

  return (
    <SectionList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      sections={sections}
      keyExtractor={(item, index) => `${item.key}:${index}`}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.section, { color: section.kind === 'needs' ? colors.warning : colors.textMuted }]}>{section.title}</Text>
      )}
      renderItem={({ item, section }) => <Row kind={section.kind} item={item} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      SectionSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
      refreshControl={<RefreshControl refreshing={snap.refreshing} onRefresh={onRefresh} colors={[colors.accent]} />}
      ListHeaderComponent={
        <View style={styles.header}>
          {snap.error ? <Text style={[styles.error, { color: colors.warning }]}>无法刷新，显示的是本机缓存：{snap.error}</Text> : null}
          {snap.loaded && calm && !empty ? (
            <View style={[styles.calm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
              <Text style={[styles.calmText, { color: colors.textMuted }]}>没有需要你处理的事，也没有正在运行的任务。</Text>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        empty ? (
          <View style={styles.emptyBox}>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>还没有会话。到“会话”里选一个 Bot 开始吧。</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate('/sessions')}
              style={[styles.emptyButton, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.emptyButtonText, { color: colors.accentText }]}>去选择 Bot</Text>
            </Pressable>
          </View>
        ) : null
      }
      ListFooterComponent={
        snap.loaded && !empty ? (
          <Text style={[styles.footer, { color: colors.textSubtle }]}>
            实时跟踪最近活跃的 {snap.watching} 个会话（上限 {snap.watchLimit}），其余显示本机保存的状态。
          </Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { gap: spacing.sm },
  section: {
    fontSize: fontSize.small,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 2, right: 2, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  pulse: { width: 10, height: 10, borderRadius: 5 },
  title: { fontSize: fontSize.body, fontWeight: '500', lineHeight: 22 },
  bold: { fontWeight: '700' },
  meta: { fontSize: fontSize.caption, marginTop: 2 },
  error: { fontSize: fontSize.small },
  calm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  calmText: { flex: 1, fontSize: fontSize.small },
  footer: { fontSize: fontSize.caption, textAlign: 'center', marginTop: spacing.xl, lineHeight: 18 },
  emptyBox: { alignItems: 'center', gap: spacing.lg, marginTop: spacing.xxl },
  emptyText: { fontSize: fontSize.body, textAlign: 'center' },
  emptyButton: { borderRadius: radius.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  emptyButtonText: { fontSize: fontSize.body, fontWeight: '600' },
});
