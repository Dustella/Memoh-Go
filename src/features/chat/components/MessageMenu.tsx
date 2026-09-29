import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../../ui/preferences';
import { fontSize, radius, spacing, useTheme } from '../../../ui/theme';
import type { CopyChoice } from '../turnRows';

/**
 * CH-12: long-press menu for a message. Copy choices come from
 * `copyChoices`; "选择文本" opens the first choice as plain selectable text,
 * since the chat rows themselves are not selectable (it would steal the
 * long-press on Android).
 */
export function MessageMenu({ choices, onClose }: { choices: readonly CopyChoice[] | null; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const [selecting, setSelecting] = useState<string | null>(null);
  useEffect(() => {
    if (!choices) setSelecting(null);
  }, [choices]);

  const copy = async (choice: CopyChoice) => {
    if (choice.action) {
      onClose();
      choice.action();
      return;
    }
    await Clipboard.setStringAsync(choice.text);
    // Android 13+ shows its own clipboard confirmation; older versions and iOS get none.
    if (Platform.OS === 'android' && Number(Platform.Version) < 33) ToastAndroid.show(t('common.copied'), ToastAndroid.SHORT);
    onClose();
  };

  const open = choices !== null && choices.length > 0;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={selecting ? () => setSelecting(null) : onClose} statusBarTranslucent>
      {selecting !== null ? (
        <View style={[styles.selectRoot, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={[styles.selectBar, { borderBottomColor: colors.border }]}>
            <Text style={[styles.selectTitle, { color: colors.text }]}>{t('chat.menu.selectText')}</Text>
            <Pressable accessibilityRole="button" hitSlop={12} onPress={onClose}>
              <Text style={[styles.done, { color: colors.accent }]}>{t('common.done')}</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.selectBody}>
            <Text selectable style={[styles.selectText, { color: colors.text }]}>
              {selecting}
            </Text>
          </ScrollView>
        </View>
      ) : (
        <Pressable style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.32)' }]} onPress={onClose} accessibilityLabel={t('chat.menu.close')}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.sm }]}
            onPress={() => undefined}
          >
            {(choices ?? []).map((choice) => (
              <Pressable
                key={choice.label}
                accessibilityRole="button"
                onPress={() => void copy(choice)}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceMuted }]}
              >
                <Text style={[styles.itemText, { color: colors.text }]}>{choice.label}</Text>
              </Pressable>
            ))}
            {choices && choices[0] ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelecting(choices[0]!.text)}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceMuted }]}
              >
                <Text style={[styles.itemText, { color: colors.text }]}>{t('chat.menu.selectText')}</Text>
              </Pressable>
            ) : null}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceMuted }]}
            >
              <Text style={[styles.itemText, { color: colors.textMuted }]}>{t('common.cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.sm },
  item: { paddingHorizontal: spacing.xl, paddingVertical: 14 },
  itemText: { fontSize: fontSize.body },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  selectRoot: { flex: 1 },
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectTitle: { fontSize: fontSize.lead, fontWeight: '600' },
  done: { fontSize: fontSize.body, fontWeight: '600' },
  selectBody: { padding: spacing.lg },
  selectText: { fontSize: fontSize.body, lineHeight: 24 },
});
