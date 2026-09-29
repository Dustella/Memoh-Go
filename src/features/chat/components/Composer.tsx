import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardVisible } from '../../../ui/components/KeyboardAware';
import { useT } from '../../../ui/preferences';
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
  placeholder,
  busy = false,
  prefill,
  editing = false,
  onCancelEdit,
  onSend,
  onStop,
}: {
  botId: string;
  /** Session id, or a sentinel for a chat that does not exist yet. */
  draftKey: string;
  running?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  /** A send is being handed over (e.g. queueing): the button waits. */
  busy?: boolean;
  /** Replace the input text (e.g. the message being edited); a new nonce applies it again. */
  prefill?: Readonly<{ text: string; nonce: number }>;
  /** CH-14: the next send replaces the latest turn. */
  editing?: boolean;
  onCancelEdit?: () => void;
  /** Resolve to 'restore' to put the text back into the input. */
  onSend: (text: string) => void | 'sent' | 'restore' | Promise<'sent' | 'restore'>;
  onStop?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const draft = useDraft(botId, draftKey);
  const canSend = draft.text.trim().length > 0;
  const prefillNonce = prefill?.nonce;
  useEffect(() => {
    if (prefill && draft.ready) draft.update(prefill.text);
    // Only a new nonce (a new "edit" request) replaces the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce, draft.ready]);

  const send = () => {
    if (!canSend || busy) return;
    const text = draft.text;
    const result = onSend(text);
    if (!(result instanceof Promise)) {
      if (result === 'restore') return;
      draft.clear();
      return;
    }
    // Async hand-over (queueing): the saved draft stays until the server has taken the text.
    draft.hold();
    void result.then(
      (r) => (r === 'restore' ? draft.restore(text) : draft.commit()),
      () => draft.restore(text),
    );
  };

  return (
    <View style={{ backgroundColor: colors.surface }}>
      {editing ? (
        <View style={[styles.editBar, { borderTopColor: colors.border }]}>
          <Ionicons name="create-outline" size={14} color={colors.accent} />
          <Text style={[styles.editText, { color: colors.textMuted }]}>{t('chat.composer.editing')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('chat.composer.cancelEdit')} hitSlop={10} onPress={onCancelEdit}>
            <Ionicons name="close" size={16} color={colors.textSubtle} />
          </Pressable>
        </View>
      ) : null}
    <View
      style={[
        styles.composer,
        { borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: keyboard ? spacing.sm : Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      <TextInput
        value={draft.text}
        onChangeText={draft.update}
        editable={draft.ready}
        autoFocus={autoFocus}
        placeholder={placeholder ?? t('chat.composer.placeholder')}
        placeholderTextColor={colors.textSubtle}
        multiline
        accessibilityLabel={t('chat.composer.input')}
        style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
      />
      {running && !canSend && onStop ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.composer.stop')}
          onPress={onStop}
          style={[styles.sendButton, { backgroundColor: colors.text }]}
        >
          <Ionicons name="stop" size={16} color={colors.background} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.composer.send')}
          disabled={!canSend || busy}
          onPress={send}
          style={[styles.sendButton, { backgroundColor: canSend ? colors.accent : colors.surfaceMuted }]}
        >
          <Ionicons name="arrow-up" size={18} color={canSend ? colors.accentText : colors.textSubtle} />
        </Pressable>
      )}
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  editText: { flex: 1, fontSize: fontSize.small },
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
