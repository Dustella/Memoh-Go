import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Animated, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import type { HomeSnapshot } from '../../application/conversation/homeService';
import { useServices } from '../../bootstrap/AppServices';
import type { HomeItem, NeedsReason } from '../../core/home/home';
import { t, type MessageKey } from '../../core/i18n';
import { useLocale, useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme, type Palette } from '../../ui/theme';
import { relativeTime } from '../../ui/time';

type Kind = 'continue' | 'needs' | 'running' | 'new' | 'recent';
type Section = Readonly<{ kind: Kind; title: string; data: HomeItem[] }>;

const NEEDS_LABEL: Record<NeedsReason, MessageKey> = {
  approval: 'home.reason.approval',
  question: 'home.reason.question',
  send_unsure: 'home.reason.send_unsure',
  send_failed: 'home.reason.send_failed',
  run_failed: 'home.reason.run_failed',
};

const PHASE_LABEL: Record<string, MessageKey> = {
  admitting: 'phase.admitting',
  running: 'phase.running',
  waiting_decision: 'phase.waiting_decision',
  aborting: 'phase.aborting',
  finishing: 'phase.finishing',
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
  if (kind === 'needs' && item.reason) return t(NEEDS_LABEL[item.reason]);
  if (kind === 'running') return t((item.phase && PHASE_LABEL[item.phase]) || 'phase.generic');
  if (kind === 'new') return t('home.hasNewReply');
  return null;
}

const Row = memo(function Row({ kind, item }: { kind: Kind; item: HomeItem }) {
  const { colors } = useTheme();
  useT();
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
          {item.title || t('common.untitledSession')}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, { color: colors.textSubtle }]}>
          {item.botName}
          {label ? <Text style={{ color: tone }}>{` · ${label}`}</Text> : null}
          {item.cached && kind === 'running' ? t('home.lastKnown') : ''}
          {time ? ` · ${time}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
    </Pressable>
  );
});

function useHome(): HomeSnapshot {
  const { home } = useServices();
  useFocusEffect(useCallback(() => home.retain(), [home]));
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
  const locale = useLocale();
  const { sections: s } = snap;

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    if (s.needsYou.length) out.push({ kind: 'needs', title: t('home.section.needs', { count: s.needsYou.length }), data: s.needsYou });
    if (s.running.length) out.push({ kind: 'running', title: t('home.section.running', { count: s.running.length }), data: s.running });
    if (s.continueWith) out.push({ kind: 'continue', title: t('home.section.continue'), data: [s.continueWith] });
    if (s.newResults.length) out.push({ kind: 'new', title: t('home.section.new', { count: s.newResults.length }), data: s.newResults });
    if (s.recent.length) out.push({ kind: 'recent', title: t('home.section.recent'), data: s.recent });
    return out;
    // Section titles are re-read when the language changes.
  }, [s, locale]);

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
          {snap.error ? <Text style={[styles.error, { color: colors.warning }]}>{t('common.cachedError', { error: snap.error })}</Text> : null}
          {snap.loaded && calm && !empty ? (
            <View style={[styles.calm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
              <Text style={[styles.calmText, { color: colors.textMuted }]}>{t('home.calm')}</Text>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        empty ? (
          <View style={styles.emptyBox}>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('home.empty')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate('/sessions')}
              style={[styles.emptyButton, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.emptyButtonText, { color: colors.accentText }]}>{t('home.pickBot')}</Text>
            </Pressable>
          </View>
        ) : null
      }
      ListFooterComponent={
        snap.loaded && !empty ? (
          <Text style={[styles.footer, { color: colors.textSubtle }]}>
            {t('home.watching', { watching: snap.watching, limit: snap.watchLimit })}
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
