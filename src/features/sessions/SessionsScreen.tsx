import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import type { HomeSession } from '../../core/home/home';
import { searchBots, searchSessions, searchTerms } from '../../core/search/sessionSearch';
import type { BotRecord } from '../../data/local/conversationStore';
import { loadHomeSessions } from '../../data/local/homeStore';
import { useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { relativeTime } from '../../ui/time';
import { useBots } from './useBots';

function initials(name: string) {
  const trimmed = name.trim();
  return (trimmed.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
}

const botName = (bot: BotRecord) => bot.display_name || bot.name || bot.id;

function BotRow({ bot }: { bot: BotRecord }) {
  const { colors } = useTheme();
  const { t } = useT();
  const name = botName(bot);
  const ready = bot.is_active !== false && (bot.status ?? 'ready') === 'ready';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('sessions.openBot', { name })}
      onPress={() => router.push({ pathname: '/bot/[botId]', params: { botId: bot.id } })}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
        <Text style={[styles.avatarText, { color: colors.accent }]}>{initials(name)}</Text>
      </View>
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>{name}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: ready ? colors.success : colors.textSubtle }]} />
          <Text style={[styles.status, { color: colors.textMuted }]}>
            {bot.is_active === false ? t('sessions.botDisabled') : ready ? t('sessions.botReady') : bot.status}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
    </Pressable>
  );
}

function SessionHit({ session }: { session: HomeSession }) {
  const { colors } = useTheme();
  const { t } = useT();
  const title = session.title || t('common.untitledSession');
  const time = relativeTime(session.updatedAt);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, session.botName, time].filter(Boolean).join(', ')}
      onPress={() => router.push({ pathname: '/chat/[botId]/[sessionId]', params: { botId: session.botId, sessionId: session.sessionId } })}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderColor: colors.border }]}
    >
      <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
      <View style={styles.flex}>
        <Text numberOfLines={2} style={[styles.hitTitle, { color: colors.text }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.status, { color: colors.textSubtle }]}>
          {session.botName}
          {time ? ` · ${time}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
    </Pressable>
  );
}

type Item = Readonly<{ kind: 'bot'; bot: BotRecord } | { kind: 'session'; session: HomeSession } | { kind: 'label'; text: string }>;

/** Bots, plus search across every session synced to this device (SS-04). */
export function SessionsScreen() {
  const { colors } = useTheme();
  const { t } = useT();
  const { db, home } = useServices();
  const state = useAccessState();
  const scope = state.kind === 'signed_in' ? state.session.scope : null;
  const { bots, loaded, refreshing, error, refresh } = useBots();
  const [query, setQuery] = useState('');
  const [botFilter, setBotFilter] = useState<string | null>(null);
  const [sessions, setSessions] = useState<HomeSession[]>([]);
  const [pulling, setPulling] = useState(false);

  const readSessions = useCallback(async () => {
    if (scope) setSessions(await loadHomeSessions(db, scope));
  }, [db, scope]);
  useFocusEffect(
    useCallback(() => {
      void readSessions();
    }, [readSessions]),
  );

  const searching = searchTerms(query).length > 0 || botFilter !== null;
  const items = useMemo<Item[]>(() => {
    if (!searching) return bots.map((bot) => ({ kind: 'bot', bot }));
    const out: Item[] = [];
    const matchedBots = botFilter ? [] : searchBots(bots, query);
    if (matchedBots.length) {
      out.push({ kind: 'label', text: t('sessions.searchBots') });
      for (const bot of matchedBots) out.push({ kind: 'bot', bot });
    }
    const hits = searchSessions({ sessions, query, botId: botFilter });
    if (hits.length) {
      out.push({ kind: 'label', text: t('sessions.searchSessions') });
      for (const session of hits) out.push({ kind: 'session', session });
    }
    return out;
  }, [searching, bots, botFilter, query, sessions, t]);

  const onRefresh = async () => {
    if (!searching) return refresh();
    // Searching: pull every Bot's newest sessions so the local index is current.
    setPulling(true);
    try {
      await home.refresh();
      await readSessions();
    } finally {
      setPulling(false);
    }
  };

  const chip = (id: string | null, label: string) => {
    const selected = botFilter === id;
    return (
      <Pressable
        key={id ?? 'all'}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        onPress={() => setBotFilter(id)}
        style={[styles.chip, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}
      >
        <Text numberOfLines={1} style={[styles.chipText, { color: selected ? colors.accent : colors.textMuted }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={items}
        keyExtractor={(item, i) => (item.kind === 'bot' ? `b:${item.bot.id}` : item.kind === 'session' ? `s:${item.session.botId}/${item.session.sessionId}` : `l:${i}`)}
        renderItem={({ item }) =>
          item.kind === 'bot' ? (
            <BotRow bot={item.bot} />
          ) : item.kind === 'session' ? (
            <SessionHit session={item.session} />
          ) : (
            <Text style={[styles.section, styles.label, { color: colors.textMuted }]}>{item.text}</Text>
          )
        }
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        refreshControl={<RefreshControl refreshing={refreshing || pulling} onRefresh={() => void onRefresh()} colors={[colors.accent]} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="search" size={16} color={colors.textSubtle} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('sessions.searchPlaceholder')}
                placeholderTextColor={colors.textSubtle}
                accessibilityLabel={t('sessions.searchPlaceholder')}
                returnKeyType="search"
                autoCorrect={false}
                style={[styles.searchInput, { color: colors.text }]}
              />
              {query ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} hitSlop={10} onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={16} color={colors.textSubtle} />
                </Pressable>
              ) : null}
            </View>
            {bots.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                {chip(null, t('sessions.searchAllBots'))}
                {bots.map((b) => chip(b.id, botName(b)))}
              </ScrollView>
            ) : null}
            {searching ? (
              <Text style={[styles.scope, { color: colors.textSubtle }]}>{t('sessions.searchScope', { count: sessions.length })}</Text>
            ) : (
              <Text style={[styles.section, { color: colors.textMuted }]}>Bots</Text>
            )}
            {error ? <Text style={[styles.error, { color: colors.warning }]}>{t('common.cachedError', { error })}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          searching ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>{t('sessions.searchEmpty')}</Text>
          ) : loaded && !refreshing ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>{t('sessions.noBots')}</Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { marginBottom: spacing.sm, gap: spacing.sm },
  section: { fontSize: fontSize.small, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { marginTop: spacing.sm },
  scope: { fontSize: fontSize.caption },
  error: { fontSize: fontSize.small, marginTop: spacing.xs },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, fontSize: fontSize.body, paddingVertical: spacing.sm, minHeight: 44 },
  chips: { gap: spacing.sm, paddingVertical: 2 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, maxWidth: 160 },
  chipText: { fontSize: fontSize.small },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.lead, fontWeight: '700' },
  name: { fontSize: fontSize.body, fontWeight: '600' },
  hitTitle: { fontSize: fontSize.body, fontWeight: '500', lineHeight: 22 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  status: { fontSize: fontSize.small },
  empty: { fontSize: fontSize.body, textAlign: 'center', marginTop: spacing.xxl },
});
