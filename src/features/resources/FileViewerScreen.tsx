import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, useWindowDimensions, View } from 'react-native';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { failureState } from '../../core/resources/environment';
import { baseName, fileKind, formatBytes, TEXT_PREVIEW_MAX_BYTES } from '../../core/resources/files';
import { MemohClient } from '../../data/remote/memohClient';
import { downloadAndShare, downloadToCache } from '../../platform/shareFile';
import { MarkdownBlockView } from '../../ui/markdown/MarkdownBlockView';
import { splitBlocks } from '../../ui/markdown/blocks';
import { useT } from '../../ui/preferences';
import { fontSize, monoFont, radius, spacing, useTheme } from '../../ui/theme';
import { relativeTime } from '../../ui/time';
import { EnvBadge, Placeholder } from './components';
import { useRemote } from './useRemote';

const MIME: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  // text/markdown has almost no Android handlers; plain text reaches notes and messaging apps.
  md: 'text/plain', txt: 'text/plain', json: 'application/json', csv: 'text/csv', html: 'text/html', zip: 'application/zip',
};
const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''];

function ImagePreview({ uri, token, name, revision }: { uri: string; token: string; name: string; revision: string }) {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const { t } = useT();
  const [ratio, setRatio] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLocal(null);
    // The modification time in the name keeps an edited image from showing its old cached copy.
    void downloadToCache(uri, token, `${revision}-${name}`).then(
      (file) => alive && setLocal(file),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [uri, token, name, revision]);
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={[styles.note, { color: colors.textMuted }]}>{t('files.loadFailed', { error })}</Text>
      </View>
    );
  }
  if (!local) return <Placeholder loading />;
  return (
    <ScrollView maximumZoomScale={4} minimumZoomScale={1} contentContainerStyle={styles.imageBox} centerContent>
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: local }}
        onLoad={(e) => {
          const { width: w, height: h } = e.nativeEvent.source;
          if (w && h) setRatio(w / h);
        }}
        onError={(e) => setError(e.nativeEvent.error ?? 'image')}
        resizeMode="contain"
        style={{ width: width - spacing.lg * 2, aspectRatio: ratio }}
      />
    </ScrollView>
  );
}

/**
 * FL-02/03: view a workspace file. Markdown renders like a chat reply;
 * text and code are monospace and selectable; images load with the token
 * as a header. Files over TEXT_PREVIEW_MAX_BYTES and other types are only
 * offered for sharing. Read-only by design (FL-07 is deferred).
 */
export function FileViewerScreen({ botId, path }: { botId: string; path: string }) {
  const { colors } = useTheme();
  const { t } = useT();
  const { access, fetchFn } = useServices();
  const accessState = useAccessState();
  const deployment = accessState.kind === 'signed_in' ? accessState.session.connection.deployment : '';
  const name = baseName(path);
  const kind = fileKind(name);
  const stat = useRemote((c, token) => c.statFile(token, botId, path), [botId, path]);
  const [token, setToken] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    void access.ensureFresh().then((s) => setToken(s.credential.accessToken), () => undefined);
  }, [access]);

  const size = stat.data?.size ?? 0;
  const previewText = (kind === 'markdown' || kind === 'text' || kind === 'code') && stat.data !== undefined && size <= TEXT_PREVIEW_MAX_BYTES;
  const content = useRemote((c, tk) => (previewText ? c.readFile(tk, botId, path) : Promise.resolve(null)), [botId, path, previewText]);
  const blocks = useMemo(() => (kind === 'markdown' && content.data ? splitBlocks(content.data.content).blocks : []), [kind, content.data]);

  const share = async () => {
    setSharing(true);
    try {
      const session = await access.ensureFresh();
      const url = new MemohClient(session.connection.deployment, fetchFn).downloadUrl(botId, path);
      if (Platform.OS === 'android') ToastAndroid.show(t('files.preparing'), ToastAndroid.SHORT);
      const result = await downloadAndShare(url, session.credential.accessToken, name, mimeOf(name));
      if (result === 'unavailable') Alert.alert(t('files.shareUnavailable'));
    } catch (e) {
      Alert.alert(t('files.shareFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSharing(false);
    }
  };

  const header = (
    <Stack.Screen
      options={{
        title: name,
        headerRight: () =>
          sharing ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={t('files.share')} hitSlop={12} onPress={() => void share()}>
              <Ionicons name="share-outline" size={22} color={colors.accent} />
            </Pressable>
          ),
      }}
    />
  );
  const info = stat.data ? t('files.info', { size: formatBytes(size), time: stat.data.modTime ? relativeTime(stat.data.modTime) : '' }) : '';
  const failure = stat.error ?? content.error;

  let body;
  if (failure) {
    body = (
      <View style={styles.center}>
        <EnvBadge state={failureState(failure.status)} />
        <Text style={[styles.note, { color: colors.textMuted }]}>{t('files.loadFailed', { error: failure.message })}</Text>
      </View>
    );
  } else if (kind === 'image' && token && deployment && stat.data) {
    body = (
      <ImagePreview
        uri={new MemohClient(deployment, fetchFn).downloadUrl(botId, path)}
        token={token}
        name={name}
        revision={String(Date.parse(stat.data.modTime ?? '') || size)}
      />
    );;
  } else if (!stat.data || (previewText && !content.data)) {
    body = <Placeholder loading />;
  } else if (!previewText && kind !== 'image') {
    body = (
      <View style={styles.center}>
        <Ionicons name="document-attach-outline" size={40} color={colors.textSubtle} />
        <Text style={[styles.note, { color: colors.textMuted }]}>
          {size > TEXT_PREVIEW_MAX_BYTES && kind !== 'other' ? t('files.tooLarge', { size: formatBytes(size) }) : t('files.binary')}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void share()} style={[styles.button, { backgroundColor: colors.accent }]}>
          <Text style={[styles.buttonText, { color: colors.accentText }]}>{t('files.share')}</Text>
        </Pressable>
      </View>
    );
  } else if (kind === 'markdown') {
    body = (
      <FlatList
        data={blocks}
        keyExtractor={(b) => String(b.key)}
        renderItem={({ item }) => (
          <View style={styles.mdBlock}>
            <MarkdownBlockView source={item.source} />
          </View>
        )}
        contentContainerStyle={styles.mdList}
      />
    );
  } else {
    body = (
      <ScrollView contentContainerStyle={styles.textBox}>
        <ScrollView horizontal>
          <Text selectable style={[styles.code, { color: colors.text, fontFamily: monoFont }]}>{content.data?.content ?? ''}</Text>
        </ScrollView>
      </ScrollView>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: kind === 'image' ? colors.surfaceMuted : colors.background }]}>
      {header}
      {info ? <Text style={[styles.info, { color: colors.textSubtle, borderBottomColor: colors.border }]}>{info}</Text> : null}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  info: { fontSize: fontSize.caption, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  note: { fontSize: fontSize.small, textAlign: 'center' },
  button: { borderRadius: radius.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  buttonText: { fontSize: fontSize.body, fontWeight: '600' },
  mdList: { paddingVertical: spacing.md },
  mdBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  textBox: { padding: spacing.lg },
  code: { fontSize: fontSize.small, lineHeight: 20 },
  imageBox: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
});
