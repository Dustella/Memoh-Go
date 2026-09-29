import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { failureState } from '../../core/resources/environment';
import { describePattern } from '../../core/resources/schedule';
import type { Schedule, ScheduleLog } from '../../data/remote/memohClient';
import { useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { relativeTime } from '../../ui/time';
import { styles as manage } from '../management/ManagementScreen';
import { EnvBadge, Placeholder, Section } from './components';
import { useRemote, useServerCall } from './useRemote';

function statusLabel(status: string, t: ReturnType<typeof useT>['t']) {
  const s = status.toLowerCase();
  if (s === 'success' || s === 'succeeded' || s === 'completed' || s === 'ok') return t('schedule.status.success');
  if (s === 'failed' || s === 'error' || s === 'errored') return t('schedule.status.failed');
  if (s === 'running' || s === 'pending') return t('schedule.status.running');
  return status;
}

function LogRow({ log, botId, first }: { log: ScheduleLog; botId: string; first: boolean }) {
  const { colors } = useTheme();
  const { t } = useT();
  const failed = /fail|error/i.test(log.status);
  return (
    <View style={[styles.log, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
      <Ionicons name={failed ? 'close-circle' : 'checkmark-circle'} size={16} color={failed ? colors.danger : colors.success} />
      <View style={styles.flex}>
        <Text style={[styles.logTitle, { color: colors.text }]}>
          {relativeTime(log.started_at)} · {statusLabel(log.status, t)}
        </Text>
        {log.error_message || log.result_text ? (
          <Text numberOfLines={3} style={[styles.logText, { color: failed ? colors.danger : colors.textMuted }]}>
            {log.error_message || log.result_text}
          </Text>
        ) : null}
      </View>
      {log.session_id ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push({ pathname: '/chat/[botId]/[sessionId]', params: { botId, sessionId: log.session_id!, focus: 'latest' } })}
        >
          <Text style={[styles.link, { color: colors.accent }]}>{t('schedule.openSession')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ScheduleCard({ schedule, logs, botId, onToggled }: { schedule: Schedule; logs: readonly ScheduleLog[]; botId: string; onToggled: () => void }) {
  const { colors } = useTheme();
  const { t } = useT();
  const call = useServerCall();
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [open, setOpen] = useState(false);
  const last = logs[0];

  const toggle = async (next: boolean) => {
    setEnabled(next);
    try {
      await call((c, token) => c.updateSchedule(token, botId, schedule.id, { enabled: next }));
      onToggled();
    } catch (e) {
      setEnabled(!next);
      Alert.alert(t('schedule.toggleFailed', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={styles.head}>
        <View style={styles.flex}>
          <Text style={[styles.name, { color: colors.text }]}>{schedule.name}</Text>
          <Text style={[styles.meta, { color: colors.textMuted }]}>{describePattern(schedule.pattern, t)}</Text>
          <Text style={[styles.meta, { color: colors.textSubtle }]}>
            {last ? t('schedule.lastRun', { time: relativeTime(last.started_at), status: statusLabel(last.status, t) }) : t('schedule.neverRun')}
          </Text>
        </View>
        <Switch
          accessibilityLabel={`${schedule.name}, ${enabled ? t('schedule.enabled') : t('schedule.disabled')}`}
          value={enabled}
          onValueChange={(v) => void toggle(v)}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor="#FFFFFF"
        />
      </Pressable>
      {open ? (
        <View style={[styles.detail, { borderTopColor: colors.border }]}>
          {schedule.description ? <Text style={[styles.body, { color: colors.textMuted }]}>{schedule.description}</Text> : null}
          <Text style={[styles.label, { color: colors.textSubtle }]}>{t('schedule.command')}</Text>
          <Text selectable style={[styles.body, { color: colors.text }]}>{schedule.command}</Text>
          <Text style={[styles.label, { color: colors.textSubtle }]}>{t('schedule.runs')}</Text>
          {logs.length === 0 ? (
            <Text style={[styles.body, { color: colors.textMuted }]}>{t('schedule.noRuns')}</Text>
          ) : (
            logs.slice(0, 10).map((log, i) => <LogRow key={log.id} log={log} botId={botId} first={i === 0} />)
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * SC-01..04: a Bot's scheduled tasks: frequency, on/off, the last run and
 * the run history, each run linked to the session it produced. The server
 * reports no next-run time, so none is shown.
 */
export function SchedulesScreen({ botId }: { botId: string }) {
  const { colors } = useTheme();
  const { t } = useT();
  const schedules = useRemote((c, token) => c.listSchedules(token, botId), [botId]);
  const logs = useRemote((c, token) => c.listScheduleLogs(token, botId, undefined, 100), [botId]);
  const byId = useMemo(() => {
    const map = new Map<string, ScheduleLog[]>();
    for (const log of [...(logs.data ?? [])].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))) {
      map.set(log.schedule_id, [...(map.get(log.schedule_id) ?? []), log]);
    }
    return map;
  }, [logs.data]);
  const refresh = () => Promise.all([schedules.refresh(), logs.refresh()]).then(() => undefined);
  // A schedule created on the next screen shows up on return.
  useFocusEffect(
    useCallback(() => {
      void schedules.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={manage.content}
      refreshControl={<RefreshControl refreshing={schedules.loading && schedules.data !== undefined} onRefresh={() => void refresh()} colors={[colors.accent]} />}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/bot/[botId]/schedule-new', params: { botId } })}
        style={[styles.newButton, { backgroundColor: colors.accent }]}
      >
        <Ionicons name="add" size={18} color={colors.accentText} />
        <Text style={[styles.newText, { color: colors.accentText }]}>{t('nav.newSchedule')}</Text>
      </Pressable>
      {schedules.error ? (
        <Section title={t('nav.schedules')}>
          <View style={styles.pad}>
            <EnvBadge state={failureState(schedules.error.status)} />
            <Text style={[styles.meta, { color: colors.textMuted }]}>{schedules.error.message}</Text>
          </View>
        </Section>
      ) : !schedules.data ? (
        <Placeholder loading />
      ) : schedules.data.length === 0 ? (
        <Placeholder text={t('schedule.empty')} />
      ) : (
        schedules.data.map((s) => <ScheduleCard key={s.id} schedule={s} logs={byId.get(s.id) ?? []} botId={botId} onToggled={() => void schedules.refresh()} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: spacing.md, gap: spacing.xs },
  newButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.md },
  newText: { fontSize: fontSize.body, fontWeight: '600' },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.md, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  name: { fontSize: fontSize.body, fontWeight: '600' },
  meta: { fontSize: fontSize.small, marginTop: 2 },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.xs },
  label: { fontSize: fontSize.caption, fontWeight: '600', marginTop: spacing.sm },
  body: { fontSize: fontSize.small, lineHeight: 20 },
  log: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm },
  logTitle: { fontSize: fontSize.small },
  logText: { fontSize: fontSize.caption, marginTop: 2 },
  link: { fontSize: fontSize.small, fontWeight: '600' },
});
