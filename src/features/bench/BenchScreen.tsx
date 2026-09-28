import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MessageRow } from '../chat/components/MessageRow';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { BenchList, LIST_IMPLS, type BenchListHandle, type ListImpl } from './BenchList';
import { runScenario, type BenchResult } from './runBenchmark';
import { SCENARIOS, scenarioById, type ChatRow, type ScenarioId } from './scenarios';
import { StreamingRowsStore } from './streamingRowsStore';

const FLUSH_WINDOW_MS = 33;

export function BenchScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ list?: string; scenario?: string; auto?: string }>();
  const [impl, setImpl] = useState<ListImpl>(
    LIST_IMPLS.some((option) => option.id === params.list) ? (params.list as ListImpl) : 'flash',
  );
  const [scenarioId, setScenarioId] = useState<ScenarioId>(scenarioById(params.scenario).id);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BenchResult[]>([]);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [store, setStore] = useState(() => new StreamingRowsStore(FLUSH_WINDOW_MS));
  const [runId, setRunId] = useState(0);

  const rows = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const listRef = useRef<BenchListHandle>(null);
  const commits = useRef<number[]>([]);
  const anchor = useRef<{ key: string | null; view: View | null }>({ key: null, view: null });
  const cancelled = useRef(false);

  useLayoutEffect(() => {
    commits.current.push(performance.now());
  }, [rows]);

  useEffect(() => () => store.dispose(), [store]);

  const renderRow = useCallback(
    (row: ChatRow) => (
      <MessageRow
        row={row}
        anchorRef={row.key === anchorKey ? (view) => { anchor.current.view = view; } : undefined}
      />
    ),
    [anchorKey],
  );

  const run = useCallback(async () => {
    if (running) return;
    cancelled.current = false;
    anchor.current = { key: null, view: null };
    setAnchorKey(null);
    const fresh = new StreamingRowsStore(FLUSH_WINDOW_MS);
    setStore(fresh);
    setRunId((id) => id + 1);
    setRunning(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      const result = await runScenario({
        scenario: scenarioById(scenarioId),
        impl,
        store: fresh,
        list: () => listRef.current,
        commits: commits.current,
        anchor: anchor.current,
        setAnchorKey,
        isCancelled: () => cancelled.current,
      });
      console.log(`[bench-result] ${JSON.stringify(result)}`);
      setResults((previous) => [result, ...previous].slice(0, 6));
    } finally {
      setRunning(false);
    }
  }, [impl, running, scenarioId]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (params.auto === '1' && !autoStarted.current) {
      autoStarted.current = true;
      void run();
    }
  }, [params.auto, run]);

  const latest = results[0];
  const summary = useMemo(() => (latest ? formatResult(latest) : '选择列表实现与场景后运行。'), [latest]);

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>渲染基准</Text>
        <ChipRow
          options={LIST_IMPLS.map((option) => ({ id: option.id, label: option.label }))}
          value={impl}
          disabled={running}
          onChange={(id) => setImpl(id as ListImpl)}
        />
        <ChipRow
          options={SCENARIOS.map((scenario) => ({ id: scenario.id, label: scenario.label }))}
          value={scenarioId}
          disabled={running}
          onChange={(id) => setScenarioId(id as ScenarioId)}
        />
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={running ? () => (cancelled.current = true) : run}
            style={[styles.button, { backgroundColor: running ? colors.surfaceMuted : colors.accent }]}
          >
            <Text style={[styles.buttonText, { color: running ? colors.text : colors.accentText }]}>
              {running ? '停止' : '运行'}
            </Text>
          </Pressable>
          <Text style={[styles.meta, { color: colors.textMuted }]}>{`${rows.length} 行 · ${__DEV__ ? 'dev' : 'release'}`}</Text>
        </View>
        <Text selectable style={[styles.summary, { color: colors.textMuted }]}>
          {summary}
        </Text>
      </View>
      <View style={styles.list}>
        <BenchList key={`${impl}:${runId}`} ref={listRef} impl={impl} rows={rows} renderRow={renderRow} extraData={anchorKey} />
      </View>
    </SafeAreaView>
  );
}

function formatResult(result: BenchResult): string {
  const parts = [`${result.impl} · ${result.scenario}`, `挂载 ${result.mountMs}ms`];
  if (result.frames) parts.push(`JS 掉帧 ${result.frames.droppedPct}% · p95 ${result.frames.p95IntervalMs}ms`);
  if (result.latency) parts.push(`可见延迟 p50 ${result.latency.p50} / p95 ${result.latency.p95}ms`);
  if (result.anchorDriftPx !== null) parts.push(result.anchorDriftPx < 0 ? '锚点丢失' : `锚点偏移 ${result.anchorDriftPx}px`);
  if (result.heapMb.end !== null) parts.push(`堆 ${result.heapMb.start}→${result.heapMb.end}MB`);
  return parts.join('\n');
}

type ChipRowProps = Readonly<{
  options: readonly { id: string; label: string }[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}>;

function ChipRow({ options, value, disabled, onChange }: ChipRowProps) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.id)}
            style={[
              styles.chip,
              { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface },
            ]}
          >
            <Text style={[styles.chipText, { color: selected ? colors.accent : colors.textMuted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  panel: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: fontSize.title, fontWeight: '600', paddingTop: spacing.sm },
  chips: { gap: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: fontSize.small, fontWeight: '500' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  button: { borderRadius: radius.pill, paddingHorizontal: 20, paddingVertical: 8 },
  buttonText: { fontSize: fontSize.small, fontWeight: '600' },
  meta: { fontSize: fontSize.caption },
  summary: { fontSize: fontSize.caption, lineHeight: 18 },
  list: { flex: 1 },
});
