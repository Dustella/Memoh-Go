import { router } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { failureState, summaryState, targetViews } from '../../core/resources/environment';
import type { BotRecord } from '../../data/local/conversationStore';
import { useT } from '../../ui/preferences';
import { fontSize, spacing, useTheme } from '../../ui/theme';
import { useBots } from '../sessions/useBots';
import { EnvBadge, ListRow } from './components';
import { useRemote } from './useRemote';

function BotResourceRow({ bot, first }: { bot: BotRecord; first: boolean }) {
  const targets = useRemote((c, token) => c.listWorkspaceTargets(token, bot.id), [bot.id]);
  const state = targets.error ? failureState(targets.error.status) : targets.data ? summaryState(targetViews(targets.data)) : null;
  return (
    <ListRow
      first={first}
      icon="cube-outline"
      title={bot.display_name || bot.name || bot.id}
      right={state ? <EnvBadge state={state} /> : null}
      onPress={() => router.push({ pathname: '/resources/[botId]', params: { botId: bot.id } })}
    />
  );
}

/** M4 Resources tab: each Bot's files and execution environments. */
export function ResourcesScreen() {
  const { colors } = useTheme();
  const { t } = useT();
  const { bots, loaded, refreshing, error, refresh } = useBots();
  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={bots}
      keyExtractor={(b) => b.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.accent]} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[styles.hint, { color: colors.textMuted }]}>{t('resources.botsHint')}</Text>
          {error ? <Text style={[styles.hint, { color: colors.warning }]}>{t('common.cachedError', { error })}</Text> : null}
        </View>
      }
      renderItem={({ item, index }) => (
        <View
          style={[
            { backgroundColor: colors.surface, borderColor: colors.border },
            styles.item,
            index === 0 && styles.top,
            index === bots.length - 1 && styles.bottom,
          ]}
        >
          <BotResourceRow bot={item} first={index === 0} />
        </View>
      )}
      ListEmptyComponent={loaded && !refreshing ? <Text style={[styles.hint, { color: colors.textMuted }]}>{t('sessions.noBots')}</Text> : null}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg },
  header: { gap: spacing.xs, marginBottom: spacing.md },
  hint: { fontSize: fontSize.small },
  item: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  top: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  bottom: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
});
