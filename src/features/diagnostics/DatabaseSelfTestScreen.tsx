import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { runAppDatabaseSelfTest, type SelfTestCheck } from '../../application/diagnostics/appDatabaseSelfTest';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';

/** Development-only: runs the local-store self-test once on open and on demand. */
export function DatabaseSelfTestScreen() {
  const { colors } = useTheme();
  const [checks, setChecks] = useState<SelfTestCheck[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      setChecks(await runAppDatabaseSelfTest());
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    void run();
  }, []);

  const failed = checks?.filter((c) => !c.ok).length ?? 0;
  const summary = checks === null ? '运行中…' : failed === 0 ? `全部通过（${checks.length} 项）` : `${failed} 项失败`;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>本地数据库自检</Text>
      <Text style={[styles.description, { color: colors.textMuted }]}>
        在独立的自检库中验证 schema、事务、历史与发送队列。第一次运行后强制停止 App 再打开，可验证跨进程恢复。
      </Text>
      <Text
        accessibilityLabel={`selftest-summary ${failed === 0 && checks ? 'pass' : checks ? 'fail' : 'running'}`}
        style={[styles.summary, { color: checks === null ? colors.textMuted : failed === 0 ? colors.success : colors.danger }]}
      >
        {summary}
      </Text>

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {(checks ?? []).map((c) => (
          <View key={c.name} style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={[styles.mark, { color: c.ok ? colors.success : colors.danger }]}>{c.ok ? '✓' : '✕'}</Text>
            <View style={styles.rowText}>
              <Text style={[styles.name, { color: colors.text }]}>{c.name}</Text>
              <Text selectable style={[styles.detail, { color: colors.textMuted }]}>{c.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={running}
        onPress={() => void run()}
        style={[styles.button, { backgroundColor: colors.accentSoft }, running && styles.disabled]}
      >
        <Text style={[styles.buttonText, { color: colors.accent }]}>重新运行</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { fontSize: fontSize.title, fontWeight: '600' },
  description: { fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.sm },
  summary: { fontSize: fontSize.body, fontWeight: '600', marginVertical: spacing.md },
  panel: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  mark: { fontSize: fontSize.body, fontWeight: '700', width: 18 },
  rowText: { flex: 1 },
  name: { fontSize: fontSize.body, fontWeight: '500' },
  detail: { fontSize: fontSize.small, marginTop: 2 },
  button: { alignItems: 'center', borderRadius: radius.md, marginTop: spacing.lg, padding: spacing.md },
  buttonText: { fontSize: fontSize.body, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
