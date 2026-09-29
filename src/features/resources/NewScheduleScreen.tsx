import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { MessageKey } from '../../core/i18n';
import { clock, looksLikeCron, toPattern, type Frequency } from '../../core/resources/schedule';
import { KeyboardAware } from '../../ui/components/KeyboardAware';
import { useT } from '../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';
import { styles as manage } from '../management/ManagementScreen';
import { useServerCall } from './useRemote';

type Kind = Frequency['kind'];
const KINDS: readonly Kind[] = ['daily', 'weekdays', 'weekly', 'hourly', 'custom'];

function Stepper({ label, value, min, max, step = 1, format, onChange }: { label: string; value: number; min: number; max: number; step?: number; format?: (n: number) => string; onChange: (n: number) => void }) {
  const { colors } = useTheme();
  const wrap = (n: number) => (n > max ? min : n < min ? max : n);
  return (
    <View style={styles.stepper} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: format ? format(value) : String(value) }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} -`} hitSlop={8} onPress={() => onChange(wrap(value - step))} style={[styles.stepButton, { borderColor: colors.border }]}>
        <Text style={[styles.stepGlyph, { color: colors.text }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, { color: colors.text }]}>{format ? format(value) : value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} +`} hitSlop={8} onPress={() => onChange(wrap(value + step))} style={[styles.stepButton, { borderColor: colors.border }]}>
        <Text style={[styles.stepGlyph, { color: colors.text }]}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * SC-03: create a scheduled task step by step: name, what to send, how
 * often. Presets cover the common cases; "custom" takes a raw cron
 * expression (SC-05). The time is the Bot's local time.
 */
export function NewScheduleScreen({ botId }: { botId: string }) {
  const { colors } = useTheme();
  const { t } = useT();
  const call = useServerCall();
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [kind, setKind] = useState<Kind>('daily');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [weekday, setWeekday] = useState(1);
  const [custom, setCustom] = useState('');
  const [enable, setEnable] = useState(true);
  const [saving, setSaving] = useState(false);

  const frequency: Frequency =
    kind === 'hourly' ? { kind, minute } : kind === 'weekly' ? { kind, weekday, hour, minute } : kind === 'custom' ? { kind, pattern: custom } : { kind, hour, minute };
  const pattern = toPattern(frequency);
  const valid = name.trim() && command.trim() && (kind !== 'custom' || looksLikeCron(custom));

  const save = async () => {
    if (!name.trim() || !command.trim()) return Alert.alert(t('schedule.missing'));
    if (kind === 'custom' && !looksLikeCron(custom)) return Alert.alert(t('schedule.invalidCron'));
    setSaving(true);
    try {
      await call((c, token) =>
        c.createSchedule(token, botId, { name: name.trim(), command: command.trim(), pattern, enabled: enable, run_target: 'new_session' }),
      );
      router.back();
    } catch (e) {
      Alert.alert(t('schedule.createFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  };

  const input = { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border };
  return (
    <KeyboardAware style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={manage.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: colors.textMuted }]}>{t('schedule.name')}</Text>
        <TextInput value={name} onChangeText={setName} placeholder={t('schedule.namePlaceholder')} placeholderTextColor={colors.textSubtle} style={[styles.input, input]} accessibilityLabel={t('schedule.name')} />

        <Text style={[styles.label, { color: colors.textMuted }]}>{t('schedule.command')}</Text>
        <TextInput
          value={command}
          onChangeText={setCommand}
          placeholder={t('schedule.commandPlaceholder')}
          placeholderTextColor={colors.textSubtle}
          multiline
          style={[styles.input, styles.multi, input]}
          accessibilityLabel={t('schedule.command')}
        />

        <Text style={[styles.label, { color: colors.textMuted }]}>{t('schedule.frequency')}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {KINDS.map((k) => {
            const selected = k === kind;
            return (
              <Pressable
                key={k}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setKind(k)}
                style={[styles.chip, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}
              >
                <Text style={[styles.chipText, { color: selected ? colors.accent : colors.textMuted }]}>{t(`schedule.freq.${k}` as MessageKey)}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {kind === 'custom' ? (
            <>
              <Text style={[styles.small, { color: colors.textMuted }]}>{t('schedule.cron')}</Text>
              <TextInput
                value={custom}
                onChangeText={setCustom}
                placeholder="*/30 * * * *"
                placeholderTextColor={colors.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, input, styles.mono]}
                accessibilityLabel={t('schedule.cron')}
              />
              {custom && !looksLikeCron(custom) ? <Text style={[styles.small, { color: colors.danger }]}>{t('schedule.invalidCron')}</Text> : null}
            </>
          ) : (
            <>
              {kind === 'weekly' ? (
                <View style={styles.line}>
                  <Text style={[styles.small, { color: colors.textMuted }]}>{t('schedule.weekday')}</Text>
                  <Stepper label={t('schedule.weekday')} value={weekday} min={0} max={6} format={(n) => t(`weekday.${n}` as MessageKey)} onChange={setWeekday} />
                </View>
              ) : null}
              {kind === 'hourly' ? (
                <View style={styles.line}>
                  <Text style={[styles.small, { color: colors.textMuted }]}>{t('schedule.minuteOfHour')}</Text>
                  <Stepper label={t('schedule.minuteOfHour')} value={minute} min={0} max={55} step={5} format={(n) => `:${String(n).padStart(2, '0')}`} onChange={setMinute} />
                </View>
              ) : (
                <View style={styles.line}>
                  <Text style={[styles.small, { color: colors.textMuted }]}>{t('schedule.time')}</Text>
                  <View style={styles.time}>
                    <Stepper label={t('schedule.time')} value={hour} min={0} max={23} format={(n) => String(n).padStart(2, '0')} onChange={setHour} />
                    <Text style={[styles.stepValue, { color: colors.text }]}>:</Text>
                    <Stepper label={t('schedule.minuteOfHour')} value={minute} min={0} max={55} step={5} format={(n) => String(n).padStart(2, '0')} onChange={setMinute} />
                  </View>
                </View>
              )}
            </>
          )}
          <Text style={[styles.small, { color: colors.textSubtle }]}>
            {kind === 'custom' ? '' : `${clock(hour, minute)} · `}
            <Text style={styles.mono}>{pattern || '—'}</Text> · {t('schedule.timezoneHint')}
          </Text>
        </View>

        <View style={[styles.panel, styles.line, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.body, { color: colors.text }]}>{t('schedule.enableNow')}</Text>
          <Switch value={enable} onValueChange={setEnable} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#FFFFFF" accessibilityLabel={t('schedule.enableNow')} />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !valid || saving }}
          disabled={!valid || saving}
          onPress={() => void save()}
          style={[styles.save, { backgroundColor: valid ? colors.accent : colors.surfaceMuted, opacity: saving ? 0.6 : 1 }]}
        >
          <Text style={[styles.saveText, { color: valid ? colors.accentText : colors.textSubtle }]}>{t('schedule.create')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAware>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { fontSize: fontSize.small, fontWeight: '600', marginTop: spacing.lg, marginBottom: spacing.sm },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.body, minHeight: 44 },
  multi: { minHeight: 88, textAlignVertical: 'top' },
  mono: { fontFamily: 'monospace' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipText: { fontSize: fontSize.small },
  panel: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  time: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  small: { fontSize: fontSize.small },
  body: { fontSize: fontSize.body, flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepButton: { width: 32, height: 32, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  stepGlyph: { fontSize: fontSize.lead },
  stepValue: { fontSize: fontSize.lead, fontWeight: '600', minWidth: 36, textAlign: 'center' },
  save: { marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.lg, alignItems: 'center' },
  saveText: { fontSize: fontSize.body, fontWeight: '600' },
});
