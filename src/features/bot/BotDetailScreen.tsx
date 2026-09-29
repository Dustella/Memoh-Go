import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NeedsSignInError } from '../../application/access/connectService';
import { useAccessState, useServices } from '../../bootstrap/AppServices';
import type { MessageKey } from '../../core/i18n';
import { loadBots, loadSessions, type BotRecord } from '../../data/local/conversationStore';
import { MemohClient, type BotCheck, type BotDetail } from '../../data/remote/memohClient';
import { useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { formatDateTime, InfoRow, styles as shared } from '../management/ManagementScreen';

type Counts = Readonly<{ memory: number | null; schedules: number | null; workdirs: number | null }>;

type Detail = Readonly<{
  bot: BotDetail | null;
  checks: readonly BotCheck[] | null;
  counts: Counts;
}>;

const NO_COUNTS: Counts = { memory: null, schedules: null, workdirs: null };

/** A count that failed (older server, no permission) shows as unknown instead of failing the page. */
async function optional<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof NeedsSignInError) throw e;
    return null;
  }
}

function statusKey(bot: BotDetail | BotRecord): MessageKey {
  if (bot.is_active === false) return 'bot.status.disabled';
  if (bot.status === 'creating') return 'bot.status.creating';
  if (bot.status === 'deleting') return 'bot.status.deleting';
  return 'bot.status.ready';
}

function checkTone(status: string) {
  if (status === 'ok') return 'ok' as const;
  if (status === 'warn' || status === 'warning' || status === 'unknown') return 'warn' as const;
  return 'error' as const;
}

/**
 * AD-01: one Bot at a glance. Overview and health checks come from the server
 * (`GET /bots/:id`, `/checks`); the content rows show counts from the memory,
 * schedule and workdir endpoints and open their pages once those exist (M4).
 * Cached Bot fields render first, so the page works offline.
 */
export function BotDetailScreen({ botId }: { botId: string }) {
  const { colors } = useTheme();
  const { t } = useT();
  const { db, access, fetchFn } = useServices();
  const state = useAccessState();
  const scope = state.kind === 'signed_in' ? state.session.scope : null;
  const [cached, setCached] = useState<BotRecord | null>(null);
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail>({ bot: null, checks: null, counts: NO_COUNTS });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!scope) return;
    setCached((await loadBots(db, scope)).find((b) => b.id === botId) ?? null);
    setSessionCount((await loadSessions(db, scope, botId, 500)).length);
    setLoading(true);
    try {
      const result = await access.withToken(async (token, session) => {
        const client = new MemohClient(session.connection.deployment, fetchFn);
        const [bot, checks, memory, schedules, workdirs] = await Promise.all([
          client.getBot(token, botId),
          optional(() => client.listBotChecks(token, botId)),
          optional(() => client.memoryUsage(token, botId)),
          optional(() => client.countSchedules(token, botId)),
          optional(() => client.countWorkdirs(token, botId)),
        ]);
        return { bot, checks, counts: { memory: memory?.count ?? null, schedules, workdirs } };
      });
      setDetail(result);
      setError(null);
    } catch (e) {
      if (!(e instanceof NeedsSignInError)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [db, scope, access, fetchFn, botId]);

  useEffect(() => {
    void load();
  }, [load]);

  const bot = detail.bot ?? cached;
  const name = bot ? bot.display_name || bot.name || bot.id : botId;
  const count = (n: number | null) => (n === null ? t('bot.countUnavailable') : String(n));

  const contentRow = (icon: keyof typeof Ionicons.glyphMap, label: string, value: string, onPress?: () => void) => (
    <Pressable
      key={label}
      accessibilityRole={onPress ? 'button' : 'text'}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [shared.row, { borderTopColor: colors.border, alignItems: 'center' }, pressed && shared.pressed]}
    >
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={[shared.rowLabel, { color: colors.text, flex: 1 }]}>{label}</Text>
      <Text style={[shared.rowValue, { color: colors.textMuted }]}>{value}</Text>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} /> : null}
    </Pressable>
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={shared.content}
      refreshControl={<RefreshControl refreshing={loading && detail.bot !== null} onRefresh={() => void load()} colors={[colors.accent]} />}
    >
      <View style={[shared.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={shared.identity}>
          <View style={[shared.avatar, { backgroundColor: colors.accentSoft }]}>
            <Text style={[styles.initial, { color: colors.accent }]}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
          </View>
          <View style={shared.flex}>
            <Text style={[shared.name, { color: colors.text }]}>{name}</Text>
            {bot ? (
              <View style={styles.statusRow}>
                <View style={[styles.dot, { backgroundColor: statusKey(bot) === 'bot.status.ready' ? colors.success : colors.textSubtle }]} />
                <Text style={[shared.sub, { color: colors.textMuted, marginTop: 0 }]}>{t(statusKey(bot))}</Text>
              </View>
            ) : null}
          </View>
          {loading && !detail.bot ? <ActivityIndicator color={colors.textMuted} /> : null}
        </View>
        {bot?.name ? <InfoRow label={t('bot.handle')} value={bot.name} /> : null}
        {detail.bot?.timezone ? <InfoRow label={t('bot.timezone')} value={detail.bot.timezone} /> : null}
        {detail.bot?.created_at ? <InfoRow label={t('bot.created')} value={formatDateTime(Date.parse(detail.bot.created_at))} /> : null}
        {detail.bot?.current_user_permissions?.length ? (
          <InfoRow wrap label={t('bot.permissions')} value={detail.bot.current_user_permissions.join(', ')} />
        ) : null}
      </View>
      {error ? <Text style={[styles.error, { color: colors.warning }]}>{t('bot.loadFailed', { error })}</Text> : null}

      <Text style={[shared.section, styles.sectionGap, { color: colors.textMuted }]}>{t('bot.resources')}</Text>
      <View style={[shared.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {contentRow('chatbubbles-outline', t('bot.sessions'), count(sessionCount), () =>
          router.push({ pathname: '/bot/[botId]', params: { botId } }),
        )}
        {contentRow('library-outline', t('bot.memory'), count(detail.counts.memory), () => router.push({ pathname: '/bot/[botId]/memory', params: { botId } }))}
        {contentRow('alarm-outline', t('bot.schedules'), count(detail.counts.schedules), () => router.push({ pathname: '/bot/[botId]/schedules', params: { botId } }))}
        {contentRow('folder-outline', t('bot.workdirs'), count(detail.counts.workdirs), () => router.push({ pathname: '/resources/[botId]', params: { botId } }))}
      </View>

      <Text style={[shared.section, styles.sectionGap, { color: colors.textMuted }]}>{t('bot.checks')}</Text>
      <View style={[shared.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {detail.checks === null ? (
          <Text style={[styles.empty, { color: colors.textMuted }]}>{loading ? ' ' : t('bot.countUnavailable')}</Text>
        ) : detail.checks.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textMuted }]}>{t('bot.checksNone')}</Text>
        ) : (
          detail.checks.map((check, i) => {
            const tone = checkTone(check.status);
            const color = tone === 'ok' ? colors.success : tone === 'warn' ? colors.warning : colors.danger;
            return (
              <View key={check.id} style={[styles.check, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <Ionicons name={tone === 'ok' ? 'checkmark-circle' : 'alert-circle'} size={16} color={color} />
                <View style={shared.flex}>
                  <Text style={[styles.checkTitle, { color: colors.text }]}>{check.type || check.id}</Text>
                  {check.summary ? <Text style={[styles.checkSummary, { color: colors.textMuted }]}>{check.summary}</Text> : null}
                </View>
                <Text style={[styles.checkStatus, { color }]}>{t(`bot.check.${tone}` as MessageKey)}</Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: spacing.xl },
  initial: { fontSize: fontSize.lead, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  error: { fontSize: fontSize.small, marginTop: spacing.sm },
  hint: { fontSize: fontSize.caption, marginTop: spacing.xs },
  empty: { fontSize: fontSize.small, paddingVertical: spacing.md },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.md },
  checkTitle: { fontSize: fontSize.body },
  checkSummary: { fontSize: fontSize.small, marginTop: 2 },
  checkStatus: { fontSize: fontSize.small, fontWeight: '600' },
  radius: { borderRadius: radius.md },
});
