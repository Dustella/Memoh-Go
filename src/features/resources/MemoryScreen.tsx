import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { failureState } from '../../core/resources/environment';
import type { MemoryItem } from '../../data/remote/memohClient';
import { useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { relativeTime } from '../../ui/time';
import { formatDateTime } from '../management/ManagementScreen';
import { EnvBadge, Placeholder } from './components';
import { useRemote } from './useRemote';

const SEARCH_DEBOUNCE_MS = 400;

function MemoryRow({ item }: { item: MemoryItem }) {
  const { colors } = useTheme();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const updated = item.updated_at || item.created_at;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((v) => !v)}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderColor: colors.border }]}
    >
      <Text selectable={open} numberOfLines={open ? undefined : 3} style={[styles.text, { color: colors.text }]}>{item.memory}</Text>
      {open ? (
        <View style={styles.detail}>
          {item.created_at ? <Text style={[styles.meta, { color: colors.textSubtle }]}>{t('memory.created')} {formatDateTime(Date.parse(item.created_at))}</Text> : null}
          {item.updated_at && item.updated_at !== item.created_at ? (
            <Text style={[styles.meta, { color: colors.textSubtle }]}>{t('memory.updated')} {formatDateTime(Date.parse(item.updated_at))}</Text>
          ) : null}
        </View>
      ) : updated ? (
        <Text style={[styles.meta, { color: colors.textSubtle }]}>{relativeTime(updated)}</Text>
      ) : null}
    </Pressable>
  );
}

/**
 * MM-01/02: a Bot's memory entries, newest first, with server-side search
 * (`POST /memory/search`). Tap an entry for its full text and dates.
 * Read-only here; editing is MM-04 (M5).
 */
export function MemoryScreen({ botId }: { botId: string }) {
  const { colors } = useTheme();
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const all = useRemote((c, token) => c.listMemory(token, botId), [botId]);
  const found = useRemote((c, token) => (debounced ? c.searchMemory(token, botId, debounced) : Promise.resolve(null)), [botId, debounced]);
  const searching = debounced.length > 0;
  const source = searching ? found : all;
  const items = useMemo(() => {
    const list = (searching ? found.data : all.data) ?? [];
    return searching ? list : [...list].sort((a, b) => Date.parse(b.updated_at || b.created_at || '') - Date.parse(a.updated_at || a.created_at || ''));
  }, [searching, found.data, all.data]);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(m) => m.id}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={source.loading && source.data !== undefined} onRefresh={() => void source.refresh()} colors={[colors.accent]} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search" size={16} color={colors.textSubtle} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('memory.search')}
              placeholderTextColor={colors.textSubtle}
              accessibilityLabel={t('memory.search')}
              returnKeyType="search"
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
          {!searching && all.data ? <Text style={[styles.meta, { color: colors.textSubtle }]}>{t('memory.count', { count: all.data.length })}</Text> : null}
          {source.error ? <EnvBadge state={failureState(source.error.status)} /> : null}
        </View>
      }
      renderItem={({ item }) => <MemoryRow item={item} />}
      ListEmptyComponent={source.loading ? <Placeholder loading /> : !source.error ? <Placeholder text={searching ? t('memory.noResults') : t('memory.empty')} /> : null}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg },
  header: { gap: spacing.sm, marginBottom: spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, fontSize: fontSize.body, minHeight: 44 },
  row: { padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.xs },
  text: { fontSize: fontSize.body, lineHeight: 22 },
  detail: { gap: 2 },
  meta: { fontSize: fontSize.caption },
});
