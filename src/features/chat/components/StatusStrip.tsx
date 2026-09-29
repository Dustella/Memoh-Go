import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t, type MessageKey } from '../../../core/i18n';
import { fontSize, spacing, useTheme, type Palette } from '../../../ui/theme';
import type { StatusAction, StatusLine } from '../chatStatus';

const ICON: Record<StatusLine['kind'], keyof typeof Ionicons.glyphMap> = {
  connection: 'cloud-offline-outline',
  sync: 'sync-outline',
  operations: 'paper-plane-outline',
};

const ACTION_LABEL: Record<StatusAction, MessageKey> = { retry_sync: 'common.retry' };

function toneColor(colors: Palette, tone: StatusLine['tone']) {
  return tone === 'error' ? colors.danger : tone === 'warning' ? colors.warning : colors.textMuted;
}

/** CH-08: one line per abnormal state category; renders nothing when all is well. */
export function StatusStrip({ lines, onAction }: { lines: readonly StatusLine[]; onAction: (a: StatusAction) => void }) {
  const { colors } = useTheme();
  if (lines.length === 0) return null;
  return (
    <View style={[styles.strip, { backgroundColor: colors.surfaceMuted, borderBottomColor: colors.border }]} accessibilityLiveRegion="polite">
      {lines.map((line) => {
        const color = toneColor(colors, line.tone);
        const icon = line.kind === 'connection' && line.tone === 'info' ? 'sync-outline' : ICON[line.kind];
        return (
          <View key={line.kind} style={styles.line}>
            <Ionicons name={icon} size={14} color={color} />
            <Text numberOfLines={2} style={[styles.text, { color }]}>
              {line.text}
            </Text>
            {line.action ? (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onAction(line.action!)}>
                <Text style={[styles.action, { color: colors.accent }]}>{t(ACTION_LABEL[line.action])}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  text: { flex: 1, fontSize: fontSize.small },
  action: { fontSize: fontSize.small, fontWeight: '600' },
});
