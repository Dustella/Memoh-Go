import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { breadcrumbs, fileKind, formatBytes, isSymlink, normalisePath, sortEntries } from '../../core/resources/files';
import type { FsEntry } from '../../data/remote/memohClient';
import { useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { relativeTime } from '../../ui/time';
import { EnvBadge, Placeholder } from './components';
import { useRemote } from './useRemote';
import { failureState } from '../../core/resources/environment';

const ICON = { markdown: 'document-text-outline', text: 'document-outline', code: 'code-slash-outline', image: 'image-outline', other: 'document-attach-outline' } as const;

/**
 * FL-01: one folder of a Bot's workspace. Folders push another screen, so
 * back walks up the path; the breadcrumb jumps straight to any ancestor.
 * Listing is server-only (not cached): offline shows "can't connect".
 */
export function FileBrowserScreen({ botId, path, root, rootLabel }: { botId: string; path: string; root: string; rootLabel?: string }) {
  const { colors } = useTheme();
  const { t } = useT();
  const current = normalisePath(path);
  const listing = useRemote((c, token) => c.listFiles(token, botId, current), [botId, current]);
  const entries = useMemo(() => sortEntries(listing.data ?? []), [listing.data]);
  const crumbs = breadcrumbs(current, root, rootLabel || root);

  const open = (entry: FsEntry) => {
    if (entry.isDir || (isSymlink(entry.mode) && !entry.name.includes('.'))) {
      router.push({ pathname: '/files/[botId]', params: { botId, path: entry.path, root, label: rootLabel ?? '' } });
    } else {
      router.push({ pathname: '/file/[botId]', params: { botId, path: entry.path } });
    }
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.crumbBar, { borderBottomColor: colors.border }]} contentContainerStyle={styles.crumbs}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <View key={c.path} style={styles.crumbItem}>
              {i > 0 ? <Ionicons name="chevron-forward" size={12} color={colors.textSubtle} /> : null}
              <Pressable
                accessibilityRole="button"
                disabled={last}
                onPress={() => router.push({ pathname: '/files/[botId]', params: { botId, path: c.path, root, label: rootLabel ?? '' } })}
              >
                <Text style={[styles.crumb, { color: last ? colors.text : colors.accent }, last && styles.bold]}>{c.label}</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.path}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={listing.loading && listing.data !== undefined} onRefresh={() => void listing.refresh()} colors={[colors.accent]} />}
        ListHeaderComponent={
          listing.error ? (
            <View style={styles.error}>
              <EnvBadge state={failureState(listing.error.status)} />
              <Text style={[styles.errorText, { color: colors.textMuted }]}>{t('files.loadFailed', { error: listing.error.message })}</Text>
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: colors.border }]} />}
        renderItem={({ item }) => {
          const kind = item.isDir ? null : fileKind(item.name);
          const meta = item.isDir
            ? item.modTime
              ? relativeTime(item.modTime)
              : ''
            : [formatBytes(item.size), item.modTime ? relativeTime(item.modTime) : ''].filter(Boolean).join(' · ');
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => open(item)}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : colors.surface }]}
            >
              <Ionicons
                name={item.isDir ? 'folder' : isSymlink(item.mode) ? 'link-outline' : ICON[kind ?? 'other']}
                size={20}
                color={item.isDir ? colors.accent : colors.textMuted}
              />
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[styles.name, { color: item.name.startsWith('.') ? colors.textMuted : colors.text }]}>{item.name}</Text>
                {meta ? <Text style={[styles.meta, { color: colors.textSubtle }]}>{meta}</Text> : null}
              </View>
              {item.isDir ? <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} /> : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={listing.loading ? <Placeholder loading /> : !listing.error ? <Placeholder text={t('files.empty')} /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '600' },
  crumbBar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  crumbs: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.xs },
  crumbItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  crumb: { fontSize: fontSize.small },
  list: { paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: spacing.lg + 20 + spacing.md },
  name: { fontSize: fontSize.body },
  meta: { fontSize: fontSize.caption, marginTop: 2 },
  error: { margin: spacing.lg, padding: spacing.md, gap: spacing.xs, borderRadius: radius.md },
  errorText: { fontSize: fontSize.small },
});
