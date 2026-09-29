import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, spacing, useTheme } from '../../../ui/theme';
import { useDraft } from '../useLiveSession';

/**
 * Message input with a persisted draft. While a run is active and the input
 * is empty, the send button becomes a stop button.
 */
export function Composer({
  botId,
  draftKey,
  running = false,
  autoFocus = false,
  placeholder = '发消息…',
  onSend,
  onStop,
}: {
  botId: string;
  /** Session id, or a sentinel for a chat that does not exist yet. */
  draftKey: string;
  running?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  onStop?: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const draft = useDraft(botId, draftKey);
  const canSend = draft.text.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    const text = draft.text;
    draft.clear();
    onSend(text);
  };

  return (
    <View
      style={[
        styles.composer,
        { borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      <TextInput
        value={draft.text}
        onChangeText={draft.update}
        editable={draft.ready}
        autoFocus={autoFocus}
        placeholder={placeholder}
        placeholderTextColor={colors.textSubtle}
        multiline
        accessibilityLabel="消息输入框"
        style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
      />
      {running && !canSend && onStop ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="停止回复"
          onPress={onStop}
          style={[styles.sendButton, { backgroundColor: colors.text }]}
        >
          <Ionicons name="stop" size={16} color={colors.background} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发送"
          disabled={!canSend}
          onPress={send}
          style={[styles.sendButton, { backgroundColor: canSend ? colors.accent : colors.surfaceMuted }]}
        >
          <Ionicons name="arrow-up" size={18} color={canSend ? colors.accentText : colors.textSubtle} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  input: {
    flex: 1,
    maxHeight: 140,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: spacing.lg,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: fontSize.body,
  },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
