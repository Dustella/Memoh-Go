import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';

import {
  clearStorageProbe,
  createStorageProbe,
  readStorageProbeSnapshot,
  recordStorageProbeLifecycle,
  type StorageProbeSnapshot,
} from '../../application/diagnostics/storageProbe';

type Phase = 'loading' | 'ready' | 'working' | 'error';

function formatTimestamp(timestamp: number | undefined): string {
  return timestamp === undefined ? '—' : new Date(timestamp).toLocaleString();
}

export function StorageDiagnosticsScreen() {
  const isDark = useColorScheme() === 'dark';
  const mountedRef = useRef(true);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [phase, setPhase] = useState<Phase>('loading');
  const [snapshot, setSnapshot] = useState<StorageProbeSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const colors = isDark
    ? {
        background: '#151718',
        border: '#48515A',
        button: '#DCEBFF',
        buttonText: '#0B4F9C',
        foreground: '#F2F4F5',
        muted: '#B0B8BE',
        panel: '#202426',
      }
    : {
        background: '#F8FAFC',
        border: '#CBD5E1',
        button: '#DBEAFE',
        buttonText: '#1D4ED8',
        foreground: '#18212B',
        muted: '#536171',
        panel: '#FFFFFF',
      };

  const commitSnapshot = useCallback((nextSnapshot: StorageProbeSnapshot) => {
    if (!mountedRef.current) {
      return;
    }
    setSnapshot(nextSnapshot);
    setErrorMessage(null);
    setPhase('ready');
  }, []);

  const reportError = useCallback((error: unknown) => {
    if (!mountedRef.current) {
      return;
    }
    setErrorMessage(error instanceof Error ? error.message : String(error));
    setPhase('error');
  }, []);

  const runAction = useCallback(
    async (action: () => Promise<StorageProbeSnapshot>) => {
      setPhase('working');
      try {
        commitSnapshot(await action());
      } catch (error) {
        reportError(error);
      }
    },
    [commitSnapshot, reportError],
  );

  useEffect(() => {
    mountedRef.current = true;
    void recordStorageProbeLifecycle('mount', AppState.currentState ?? 'unknown')
      .then(commitSnapshot)
      .catch(reportError);

    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
      void recordStorageProbeLifecycle('change', nextState)
        .then(commitSnapshot)
        .catch(reportError);
    });

    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, [commitSnapshot, reportError]);

  const isWorking = phase === 'loading' || phase === 'working';

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>存储与生命周期诊断</Text>
      <Text style={[styles.description, { color: colors.muted }]}>创建探针后终止 App 进程并重新打开，用于确认 SQLite、SecureStore 和生命周期记录能否恢复。</Text>

      <View style={[styles.panel, { backgroundColor: colors.panel, borderColor: colors.border }]}>
        <StatusRow label="页面状态" value={phase} colors={colors} />
        <StatusRow label="AppState" value={appState} colors={colors} />
        <StatusRow label="SQLite 探针数" value={String(snapshot?.probeCount ?? 0)} colors={colors} />
        <StatusRow label="最新探针 ID" value={snapshot?.latestProbe?.probeId ?? '—'} colors={colors} />
        <StatusRow label="探针创建时间" value={formatTimestamp(snapshot?.latestProbe?.createdAt)} colors={colors} />
        <StatusRow label="SecureStore 可用" value={snapshot?.secureStoreAvailable ? '是' : '否'} colors={colors} />
        <StatusRow label="安全记录存在" value={snapshot?.secureRecordPresent ? '是' : '否'} colors={colors} />
        <StatusRow label="安全记录匹配 SQLite" value={snapshot?.secureRecordMatchesSqlite ? '是' : '否'} colors={colors} />
        <StatusRow label="秘密值出现在 SQLite" value={snapshot?.secureValueFoundInSqlite ? '是（失败）' : '否'} colors={colors} />
        <StatusRow label="生命周期记录数" value={String(snapshot?.lifecycleCount ?? 0)} colors={colors} />
        <StatusRow
          label="最新生命周期事件"
          value={
            snapshot?.latestLifecycle
              ? `${snapshot.latestLifecycle.kind} · ${snapshot.latestLifecycle.appState}`
              : '—'
          }
          colors={colors}
        />
        <StatusRow
          label="事件记录时间"
          value={formatTimestamp(snapshot?.latestLifecycle?.recordedAt)}
          colors={colors}
        />
      </View>

      {errorMessage ? <Text style={styles.error}>错误：{errorMessage}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={isWorking}
        onPress={() => void runAction(createStorageProbe)}
        style={[styles.button, { backgroundColor: colors.button }, isWorking && styles.disabled]}
      >
        <Text style={[styles.buttonText, { color: colors.buttonText }]}>创建持久化探针</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={isWorking}
        onPress={() => void runAction(readStorageProbeSnapshot)}
        style={[styles.secondaryButton, { borderColor: colors.border }, isWorking && styles.disabled]}
      >
        <Text style={[styles.buttonText, { color: colors.foreground }]}>重新读取</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={isWorking}
        onPress={() => void runAction(clearStorageProbe)}
        style={[styles.secondaryButton, { borderColor: colors.border }, isWorking && styles.disabled]}
      >
        <Text style={[styles.buttonText, { color: colors.foreground }]}>清除诊断数据</Text>
      </Pressable>
    </ScrollView>
  );
}

type StatusColors = Readonly<{
  foreground: string;
  muted: string;
}>;

function StatusRow({
  label,
  value,
  colors,
}: Readonly<{ label: string; value: string; colors: StatusColors }>) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.muted }]}>{label}</Text>
      <Text selectable style={[styles.rowValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
    marginTop: 8,
  },
  panel: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  row: {
    borderBottomColor: '#94A3B833',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  rowLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  rowValue: {
    fontSize: 15,
    lineHeight: 21,
  },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    marginTop: 20,
    padding: 14,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  error: {
    color: '#B91C1C',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 16,
  },
});
