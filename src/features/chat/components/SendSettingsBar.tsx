import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MessageKey } from '../../../core/i18n';
import { targetState } from '../../../core/resources/environment';
import type { ModelOption, WorkspaceTarget } from '../../../data/remote/memohClient';
import { useT } from '../../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../../ui/theme';
import type { SendSettings } from '../useSendSettings';

function Option({ label, sub, selected, disabled, onPress }: { label: string; sub?: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surfaceMuted }, disabled && { opacity: 0.45 }]}
    >
      <View style={styles.flex}>
        <Text style={[styles.optionText, { color: colors.text }]}>{label}</Text>
        {sub ? <Text style={[styles.sub, { color: colors.textSubtle }]}>{sub}</Text> : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
    </Pressable>
  );
}

/**
 * CH-17/18: a one-line summary above the composer ("Default · Server
 * workspace"); tapping it opens the choices. Visible before sending, so a
 * message never goes somewhere the user did not see.
 */
export function SendSettingsBar({
  settings,
  models,
  targets,
  model,
  target,
  onChange,
}: {
  settings: SendSettings;
  models: readonly ModelOption[];
  targets: readonly WorkspaceTarget[];
  model?: ModelOption;
  target?: WorkspaceTarget;
  onChange: (patch: Partial<SendSettings>) => void;
}) {
  const { colors } = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const primary = targets.find((x) => x.primary);
  const modelLabel = model ? model.name || model.model_id : t('picker.default');
  const effort = model?.reasoning?.supported && settings.reasoningEffort ? ` · ${settings.reasoningEffort}` : '';
  const locationLabel = (target ?? primary)?.name ?? t('picker.default');
  const efforts = model?.reasoning?.supported ? model.reasoning.efforts ?? [] : [];

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('picker.title')}: ${modelLabel}${effort}, ${locationLabel}`}
        onPress={() => setOpen(true)}
        style={[styles.bar, { borderTopColor: colors.border, backgroundColor: colors.surface }]}
      >
        <Ionicons name="options-outline" size={14} color={colors.textSubtle} />
        <Text numberOfLines={1} style={[styles.barText, { color: colors.textMuted }]}>
          {t('picker.summary', { model: `${modelLabel}${effort}`, location: locationLabel })}
        </Text>
        <Ionicons name="chevron-up" size={14} color={colors.textSubtle} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel={t('common.done')}>
          <Pressable onPress={() => undefined} style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.sheetHead}>
              <Text style={[styles.title, { color: colors.text }]}>{t('picker.title')}</Text>
              <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setOpen(false)}>
                <Text style={[styles.done, { color: colors.accent }]}>{t('common.done')}</Text>
              </Pressable>
            </View>
            <Text style={[styles.sub, styles.hint, { color: colors.textSubtle }]}>{t('picker.hint')}</Text>
            <ScrollView>
              <Text style={[styles.group, { color: colors.textMuted }]}>{t('picker.model')}</Text>
              <Option label={t('picker.default')} selected={!settings.modelId} onPress={() => onChange({ modelId: '' })} />
              {models.map((m) => (
                <Option key={m.id} label={m.name || m.model_id} sub={m.name ? m.model_id : undefined} selected={settings.modelId === m.id} onPress={() => onChange({ modelId: m.id })} />
              ))}
              {efforts.length > 0 ? (
                <>
                  <Text style={[styles.group, { color: colors.textMuted }]}>{t('picker.effort')}</Text>
                  <Option label={t('picker.default')} sub={model?.reasoning?.default_effort} selected={!settings.reasoningEffort} onPress={() => onChange({ reasoningEffort: '' })} />
                  {efforts.map((e) => (
                    <Option key={e} label={e} selected={settings.reasoningEffort === e} onPress={() => onChange({ reasoningEffort: e })} />
                  ))}
                </>
              ) : null}
              <Text style={[styles.group, { color: colors.textMuted }]}>{t('picker.location')}</Text>
              <Option label={t('picker.default')} sub={primary?.name} selected={!settings.workspaceTargetId} onPress={() => onChange({ workspaceTargetId: '' })} />
              {targets.map((x) => {
                const state = targetState(x);
                return (
                  <Option
                    key={x.target_id}
                    label={x.name}
                    sub={t(`env.${state}` as MessageKey)}
                    selected={settings.workspaceTargetId === x.target_id}
                    // An offline or revoked runtime would refuse the message; it can be picked again once online.
                    disabled={state !== 'online'}
                    onPress={() => onChange({ workspaceTargetId: x.target_id })}
                  />
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
  barText: { flex: 1, fontSize: fontSize.caption },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: { maxHeight: '75%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.md },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl },
  title: { fontSize: fontSize.lead, fontWeight: '600' },
  done: { fontSize: fontSize.body, fontWeight: '600' },
  hint: { paddingHorizontal: spacing.xl, marginTop: 2 },
  group: { fontSize: fontSize.small, fontWeight: '600', paddingHorizontal: spacing.xl, marginTop: spacing.lg, marginBottom: spacing.xs },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12 },
  optionText: { fontSize: fontSize.body },
  sub: { fontSize: fontSize.caption, marginTop: 2 },
});
