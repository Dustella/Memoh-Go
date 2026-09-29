import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatLimit, MAX_UPLOAD_BYTES, safeFileName, uniqueName } from '../../core/resources/attachments';
import { breadcrumbs, fileKind, formatBytes, isSymlink, joinPath, normalisePath, sortEntries } from '../../core/resources/files';
import { ApiError, type FsEntry } from '../../data/remote/memohClient';
import { pickFiles, uploadToWorkspace, type PickSource } from '../../platform/pickFiles';
import { PickSourceSheet } from '../../ui/components/PickSourceSheet';
import { useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { relativeTime } from '../../ui/time';
import { EnvBadge, Placeholder } from './components';
import { useRemote, useServerCall } from './useRemote';
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
  const insets = useSafeAreaInsets();
  const call = useServerCall();
  const current = normalisePath(path);
  const listing = useRemote((c, token) => c.listFiles(token, botId, current), [botId, current]);
  const entries = useMemo(() => sortEntries(listing.data ?? []), [listing.data]);
  const crumbs = breadcrumbs(current, root, rootLabel || root);
  const [pickOpen, setPickOpen] = useState(false);
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);

  /** FL-04: upload picked files into this folder, asking before replacing a file of the same name. */
  const uploadPicked = async (source: PickSource) => {
    let picked;
    try {
      picked = await pickFiles(source);
    } catch (e) {
      Alert.alert(t('attach.pickFailed'), e instanceof Error ? e.message : String(e));
      return;
    }
    if (picked === 'denied') return void Alert.alert(t('attach.cameraDenied'));
    const taken = new Set(entries.map((e) => e.name));
    let done = 0;
    for (const file of picked) {
      if (file.size > MAX_UPLOAD_BYTES) {
        Alert.alert(t('attach.rejectedTitle'), t('attach.tooLarge', { names: file.name, limit: formatLimit(MAX_UPLOAD_BYTES) }));
        continue;
      }
      const wanted = safeFileName(file.name);
      let name = wanted;
      if (taken.has(wanted)) {
        const choice = await new Promise<'replace' | 'keep' | 'skip'>((resolve) =>
          Alert.alert(t('upload.existsTitle'), t('upload.exists', { name: wanted }), [
            { text: t('common.cancel'), style: 'cancel', onPress: () => resolve('skip') },
            { text: t('upload.keepBoth'), onPress: () => resolve('keep') },
            { text: t('upload.replace'), style: 'destructive', onPress: () => resolve('replace') },
          ], { cancelable: true, onDismiss: () => resolve('skip') }),
        );
        if (choice === 'skip') continue;
        if (choice === 'keep') name = uniqueName(wanted, taken);
      }
      setUpload({ name, progress: 0 });
      try {
        await call((client, token) =>
          uploadToWorkspace(client.uploadUrl(botId), token, file, joinPath(current, name), (progress) => setUpload({ name, progress })),
        );
        taken.add(name);
        done += 1;
      } catch (e) {
        const status = e instanceof ApiError ? e.status : undefined;
        Alert.alert(t('upload.failed', { name }), status === 403 ? t('env.forbidden') : e instanceof Error ? e.message : String(e));
      }
    }
    setUpload(null);
    if (done) void listing.refresh();
  };

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
      {upload ? (
        <View style={[styles.progress, { borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.sm }]}>
          <ActivityIndicator size="small" color={colors.accent} />
          <View style={styles.flex}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>{t('upload.uploading', { name: upload.name })}</Text>
            <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
              <View style={[styles.fill, { backgroundColor: colors.accent, width: `${Math.round(upload.progress * 100)}%` }]} />
            </View>
          </View>
        </View>
      ) : !listing.error || listing.data ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('upload.here')}
          onPress={() => setPickOpen(true)}
          style={({ pressed }) => [styles.fab, { backgroundColor: colors.accent, bottom: insets.bottom + spacing.xl, opacity: pressed ? 0.85 : 1 }]}
        >
          <Ionicons name="cloud-upload-outline" size={20} color={colors.accentText} />
          <Text style={[styles.fabText, { color: colors.accentText }]}>{t('upload.button')}</Text>
        </Pressable>
      ) : null}
      <PickSourceSheet visible={pickOpen} title={t('upload.here')} onClose={() => setPickOpen(false)} onPick={(s) => void uploadPicked(s)} />
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
  list: { paddingTop: spacing.sm, paddingBottom: 96 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: spacing.lg + 20 + spacing.md },
  name: { fontSize: fontSize.body },
  meta: { fontSize: fontSize.caption, marginTop: 2 },
  error: { margin: spacing.lg, padding: spacing.md, gap: spacing.xs, borderRadius: radius.md },
  errorText: { fontSize: fontSize.small },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 24,
    paddingHorizontal: spacing.lg,
    height: 48,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  fabText: { fontSize: fontSize.body, fontWeight: '600' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  track: { height: 4, borderRadius: 2, marginTop: spacing.xs, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
