import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { formatEntry, type LogEntry, type LogLevel } from '../../core/diagnostics/log';
import { buildDiagnosticsReport } from '../../core/diagnostics/report';
import type { OutboxEntry } from '../../core/operations/outbox';
import { loadPendingOutbox } from '../../data/local/outboxStore';
import { fontSize, monoFont, radius, spacing, useTheme, type Palette } from '../../ui/theme';

function levelColor(colors: Palette, level: LogLevel) {
  return level === 'error' ? colors.danger : level === 'warn' ? colors.warning : level === 'info' ? colors.text : colors.textSubtle;
}

const KNOWN_LABEL = { yes: '：支持', no: '：不支持', unknown: '：尚未确认' } as const;

/** On screen: local wall-clock time; the copied report keeps UTC ISO timestamps. */
function screenLine(entry: LogEntry) {
  const d = new Date(entry.at);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  return `${time} ${formatEntry(entry).split(' ').slice(1).join(' ')}`;
}

/**
 * PF-04: redacted diagnostics a user can read and copy for support. Shows
 * versions, what the server has proven it supports, the send queue by status
 * and the event log (newest first). Nothing here contains message content.
 */
export function DiagnosticsLogScreen() {
  const { colors } = useTheme();
  const { log, db } = useServices();
  const state = useAccessState();
  const entries = useSyncExternalStore(log.subscribe, log.entries);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const scope = state.kind === 'signed_in' || state.kind === 'needs_sign_in' ? (state.kind === 'signed_in' ? state.session.scope : state.scope) : null;
  useEffect(() => {
    if (!scope) return;
    void loadPendingOutbox(db, scope).then(setOutbox);
  }, [db, scope, entries]);

  const report = useCallback(() => {
    const session = state.kind === 'signed_in' ? state.session : null;
    const connection = state.kind === 'signed_in' ? state.session.connection : state.kind === 'needs_sign_in' ? state.connection : null;
    return buildDiagnosticsReport({
      generatedAt: Date.now(),
      app: {
        version: Constants.expoConfig?.version ?? 'unknown',
        build: __DEV__ ? 'dev' : 'release',
        platform: Platform.OS,
        osVersion: String(Platform.Version),
      },
      server: connection
        ? {
            deployment: connection.deployment,
            version: connection.serverVersion,
            commit: connection.serverCommit,
            invocationLookup: session?.capabilities.invocationLookup ?? 'unknown',
            admissionDedup: session?.capabilities.admissionDedup ?? 'unknown',
            session: state.kind === 'needs_sign_in' ? `needs_sign_in(${state.reason})` : state.kind,
          }
        : null,
      outbox,
      entries,
    });
  }, [state, outbox, entries]);

  const copy = async () => {
    await Clipboard.setStringAsync(report());
    if (Platform.OS === 'android' && Number(Platform.Version) < 33) ToastAndroid.show('已复制诊断信息', ToastAndroid.SHORT);
  };

  const visible = useMemo(
    () => [...entries].reverse().filter((e) => showDebug || e.level !== 'debug'),
    [entries, showDebug],
  );
  const summary = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const e of outbox) byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
    return [...byStatus].map(([s, n]) => `${s} ${n}`).join(' · ') || '无';
  }, [outbox]);

  const renderItem = useCallback(
    ({ item }: { item: LogEntry }) => (
      <Text style={[styles.entry, { color: levelColor(colors, item.level), borderBottomColor: colors.border }]}>{screenLine(item)}</Text>
    ),
    [colors],
  );

  const capabilities = state.kind === 'signed_in' ? state.session.capabilities : null;
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          应用 {Constants.expoConfig?.version ?? '?'} · {__DEV__ ? '开发版' : '正式版'} · {Platform.OS} {String(Platform.Version)}
        </Text>
        {capabilities ? (
          <Text style={[styles.meta, { color: colors.textMuted }]}>
            发送结果查询{KNOWN_LABEL[capabilities.invocationLookup]} · 重复发送去重{KNOWN_LABEL[capabilities.admissionDedup]}
          </Text>
        ) : null}
        <Text style={[styles.meta, { color: colors.textMuted }]}>待发送队列：{summary}</Text>
        <Text style={[styles.note, { color: colors.textSubtle }]}>日志只记录状态与编号，不含登录凭据和消息内容；重启应用后清空。</Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => void copy()} style={[styles.button, { backgroundColor: colors.accent }]}>
            <Ionicons name="copy-outline" size={16} color={colors.accentText} />
            <Text style={[styles.buttonText, { color: colors.accentText }]}>复制诊断信息</Text>
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: showDebug }}
            onPress={() => setShowDebug((v) => !v)}
            style={[styles.button, { backgroundColor: colors.surfaceMuted }]}
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>{showDebug ? '隐藏调试事件' : '显示调试事件'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={log.clear} hitSlop={8} style={styles.clear}>
            <Text style={[styles.buttonText, { color: colors.textMuted }]}>清空</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        data={visible}
        keyExtractor={(item, index) => `${item.at}:${index}`}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={[styles.empty, { color: colors.textMuted }]}>暂无事件</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { margin: spacing.lg, padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.xs },
  meta: { fontSize: fontSize.small },
  note: { fontSize: fontSize.caption, marginTop: spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  button: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  buttonText: { fontSize: fontSize.small, fontWeight: '600' },
  clear: { marginLeft: 'auto', paddingHorizontal: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  entry: { fontFamily: monoFont, fontSize: 11, lineHeight: 16, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  empty: { textAlign: 'center', paddingVertical: spacing.xl, fontSize: fontSize.small },
});
