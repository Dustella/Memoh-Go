import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PendingQueueItem, QueueMode, QueueView } from '../../../application/conversation/sessionQueue';
import { useT } from '../../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../../ui/theme';

/**
 * CH-13, above the composer while the Bot is replying: how a new message is
 * delivered (after this reply, or steering the running task when the server
 * allows it), the items still waiting on the server, and the last notice.
 */
export function QueueBar({
  view,
  running,
  mode,
  onMode,
  onCancel,
  onPromote,
  onDismissNotice,
}: {
  view: QueueView;
  running: boolean;
  mode: QueueMode;
  onMode: (mode: QueueMode) => void;
  onCancel: (item: PendingQueueItem) => void;
  onPromote: (item: PendingQueueItem) => void;
  onDismissNotice: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useT();
  const showModes = running && view.support !== 'no';
  if (!showModes && view.items.length === 0 && !view.notice) return null;
  const effective: QueueMode = mode === 'steer' && view.steerSupported ? 'steer' : 'follow_up';

  const chip = (value: QueueMode, label: string, disabled: boolean) => {
    const selected = effective === value;
    return (
      <Pressable
        key={value}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, disabled }}
        disabled={disabled}
        onPress={() => onMode(value)}
        style={[
          styles.chip,
          { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface, opacity: disabled ? 0.45 : 1 },
        ]}
      >
        <Text style={[styles.chipText, { color: selected ? colors.accent : colors.textMuted }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
      {view.items.map((item) => (
        <View key={`${item.kind}:${item.item_id}`} style={styles.item}>
          <Ionicons name={item.kind === 'steer' ? 'git-merge-outline' : 'time-outline'} size={14} color={colors.textMuted} />
          <Text numberOfLines={1} style={[styles.itemText, { color: colors.text }]}>
            <Text style={{ color: colors.textMuted }}>{item.kind === 'steer' ? t('queue.pendingSteer') : t('queue.pendingFollowUp')} · </Text>
            {item.text}
          </Text>
          {item.kind === 'follow_up' && view.steerSupported ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onPromote(item)}>
              <Text style={[styles.action, { color: colors.accent }]}>{t('queue.promote')}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onCancel(item)}>
            <Text style={[styles.action, { color: colors.textMuted }]}>{t('queue.cancel')}</Text>
          </Pressable>
        </View>
      ))}
      {view.notice ? (
        <Pressable accessibilityRole="button" accessibilityLabel={view.notice} onPress={onDismissNotice} style={styles.item}>
          <Ionicons name="information-circle-outline" size={14} color={colors.warning} />
          <Text style={[styles.itemText, { color: colors.warning }]}>{view.notice}</Text>
          <Ionicons name="close" size={14} color={colors.textSubtle} />
        </Pressable>
      ) : null}
      {showModes ? (
        <>
          <View accessibilityRole="radiogroup" style={styles.modes}>
            {chip('follow_up', t('queue.mode.followUp'), false)}
            {chip('steer', t('queue.mode.steer'), !view.steerSupported)}
          </View>
          <Text style={[styles.hint, { color: colors.textSubtle }]}>
            {effective === 'steer' ? t('queue.modeHint.steer') : t('queue.modeHint.followUp')}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  itemText: { flex: 1, fontSize: fontSize.small },
  action: { fontSize: fontSize.small, fontWeight: '600' },
  modes: { flexDirection: 'row', gap: spacing.sm },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  chipText: { fontSize: fontSize.small },
  hint: { fontSize: fontSize.caption, lineHeight: 16 },
});
