import { router } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { failureState, targetViews, type EnvState } from '../../core/resources/environment';
import { formatBytes } from '../../core/resources/files';
import { useT } from '../../ui/preferences';
import { fontSize, spacing, useTheme } from '../../ui/theme';
import { InfoRow, styles as manage } from '../management/ManagementScreen';
import { EnvBadge, ListRow, Placeholder, Section } from './components';
import { useRemote } from './useRemote';

const DEFAULT_ROOT = '/data';

const clockTime = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * EN-01..03 and FL-01 entry points for one Bot: its execution environments
 * (workspace targets, the built-in container and its metrics), its folders
 * (workdirs) and the whole file tree from the container's home.
 */
export function BotResourcesScreen({ botId }: { botId: string }) {
  const { colors } = useTheme();
  const { t } = useT();
  const targets = useRemote((c, token) => c.listWorkspaceTargets(token, botId), [botId]);
  const container = useRemote((c, token) => c.getContainer(token, botId), [botId]);
  const metrics = useRemote((c, token) => c.getContainerMetrics(token, botId), [botId]);
  const workdirs = useRemote((c, token) => c.listWorkdirs(token, botId), [botId]);

  const root = container.data?.container_path || DEFAULT_ROOT;
  const refreshAll = () => Promise.all([targets.refresh(), container.refresh(), metrics.refresh(), workdirs.refresh()]).then(() => undefined);
  const refreshing = targets.loading && targets.data !== undefined;
  const views = targets.data ? targetViews(targets.data) : [];
  const listState: EnvState | null = targets.error ? failureState(targets.error.status) : null;

  const m = metrics.data;
  const openFiles = (path: string, label?: string) =>
    router.push({ pathname: '/files/[botId]', params: { botId, path, root: path, label: label ?? '' } });

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={manage.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} colors={[colors.accent]} />}
    >
      <Section
        title={t('resources.environments')}
        right={targets.fetchedAt ? <Text style={[styles.meta, { color: colors.textSubtle }]}>{t('resources.checkedAt', { time: clockTime(targets.fetchedAt) })}</Text> : null}
      >
        {listState ? (
          <View style={styles.pad}>
            <EnvBadge state={listState} />
          </View>
        ) : views.length === 0 ? (
          <Placeholder loading={targets.loading} text={t('env.unknown')} />
        ) : (
          views.map((v, i) => (
            <ListRow
              key={v.id}
              first={i === 0}
              icon={v.kind === 'native' ? 'server-outline' : 'laptop-outline'}
              title={v.name}
              subtitle={[v.kind === 'native' ? t('env.native') : t('env.remote'), v.primary ? t('env.primary') : ''].filter(Boolean).join(' · ')}
              right={<EnvBadge state={v.state} />}
            />
          ))
        )}
      </Section>

      <Section title={t('env.container')}>
        {container.error ? (
          <View style={styles.pad}>
            <EnvBadge state={failureState(container.error.status)} />
          </View>
        ) : !container.data ? (
          <Placeholder loading />
        ) : (
          <View style={styles.inner}>
            <InfoRow label={t('env.agent')} value={container.data.task_running ? t('env.running') : t('env.stopped')} />
            {container.data.image ? <InfoRow label={t('env.image')} value={container.data.image} /> : null}
            {m && !m.supported ? (
              <Text style={[styles.note, { color: colors.textMuted }]}>{m.unsupported_reason || t('env.metricsUnsupported')}</Text>
            ) : m?.metrics ? (
              <>
                {typeof m.metrics.cpu?.usage_percent === 'number' ? (
                  <InfoRow label={t('env.cpu')} value={`${m.metrics.cpu.usage_percent.toFixed(1)}%`} />
                ) : null}
                {typeof m.metrics.memory?.usage_bytes === 'number' ? (
                  <InfoRow
                    label={t('env.memory')}
                    value={
                      m.metrics.memory.limit_bytes
                        ? `${formatBytes(m.metrics.memory.usage_bytes)} / ${formatBytes(m.metrics.memory.limit_bytes)}`
                        : formatBytes(m.metrics.memory.usage_bytes)
                    }
                  />
                ) : null}
                {typeof m.metrics.storage?.used_bytes === 'number' ? <InfoRow label={t('env.storage')} value={formatBytes(m.metrics.storage.used_bytes)} /> : null}
              </>
            ) : null}
          </View>
        )}
      </Section>

      <Section title={t('resources.files')}>
        <ListRow first icon="folder-open-outline" title={t('resources.allFiles')} subtitle={root} onPress={() => openFiles(root)} />
        {(workdirs.data ?? [])
          .filter((w) => !w.archived)
          .map((w) => (
            <ListRow key={w.id} icon="folder-outline" title={w.name} subtitle={w.path} onPress={() => openFiles(w.path, w.name)} />
          ))}
      </Section>
      {workdirs.data && workdirs.data.length === 0 ? <Text style={[styles.meta, styles.hint, { color: colors.textSubtle }]}>{t('resources.noFolders')}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.md },
  inner: { paddingHorizontal: spacing.md },
  meta: { fontSize: fontSize.caption },
  hint: { marginTop: spacing.xs },
  note: { fontSize: fontSize.small, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
