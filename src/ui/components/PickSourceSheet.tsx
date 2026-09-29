import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PickSource } from '../../platform/pickFiles';
import { useT } from '../preferences';
import { fontSize, radius, spacing, useTheme } from '../theme';

const SOURCES: readonly { source: PickSource; icon: keyof typeof Ionicons.glyphMap }[] = [
  { source: 'photos', icon: 'images-outline' },
  { source: 'camera', icon: 'camera-outline' },
  { source: 'files', icon: 'folder-open-outline' },
];

/** Where to pick a file from (CH-16 attachments, FL-04 upload). */
export function PickSourceSheet({ visible, title, onPick, onClose }: { visible: boolean; title: string; onPick: (source: PickSource) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.cancel')}>
        <Pressable onPress={() => undefined} style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {SOURCES.map(({ source, icon }) => (
            <Pressable
              key={source}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                onPick(source);
              }}
              style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surfaceMuted }]}
            >
              <Ionicons name={icon} size={20} color={colors.accent} />
              <Text style={[styles.optionText, { color: colors.text }]}>{t(`attach.source.${source}`)}</Text>
            </Pressable>
          ))}
          <View style={[styles.sep, { backgroundColor: colors.border }]} />
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surfaceMuted }]}>
            <Text style={[styles.optionText, styles.cancel, { color: colors.textMuted }]}>{t('common.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.lg },
  title: { fontSize: fontSize.lead, fontWeight: '600', paddingHorizontal: spacing.xl, marginBottom: spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: 14 },
  optionText: { fontSize: fontSize.body },
  cancel: { flex: 1, textAlign: 'center' },
  sep: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
});
